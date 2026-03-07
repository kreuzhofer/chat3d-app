/**
 * Edit-based fix response parsing and application.
 *
 * Instead of regenerating the entire script on every fix iteration,
 * the LLM can return search-and-replace blocks that target specific
 * lines. This saves tokens and reduces the risk of introducing new bugs.
 *
 * Format:
 *   <<<SEARCH
 *   exact code to find
 *   ===
 *   replacement code
 *   >>>SEARCH
 *
 * Full rewrite escape hatch:
 *   <<<FULL_REWRITE
 *   ```python
 *   {complete code}
 *   ```
 *   >>>FULL_REWRITE
 */

import { RenderErrorCategory } from "./render-errors.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SearchReplaceEdit {
  searchBlock: string;
  replaceBlock: string;
}

export interface EditParseResult {
  edits: SearchReplaceEdit[];
  isFullRewrite: boolean;
  fullRewriteCode?: string;
}

export interface EditApplyResult {
  success: boolean;
  resultCode: string;
  appliedCount: number;
  failedSearches: string[];
}

// ── Edit-friendly error categories ───────────────────────────────────────────

/** Categories where edit mode is appropriate (targeted fixes). */
const EDIT_FRIENDLY_CATEGORIES = new Set<RenderErrorCategory>([
  RenderErrorCategory.API_MISUSE,
  RenderErrorCategory.TYPE_ERROR,
  RenderErrorCategory.GEOMETRY,
  RenderErrorCategory.SYNTAX,
  RenderErrorCategory.KERNEL_ERROR,
  RenderErrorCategory.UNKNOWN,
]);

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse an LLM response for search-and-replace edit blocks or a full rewrite.
 *
 * Returns `{ edits, isFullRewrite, fullRewriteCode }`:
 * - If `<<<FULL_REWRITE` is found, extracts the code and returns it.
 * - If `<<<SEARCH` blocks are found, extracts each search/replace pair.
 * - If neither is found, returns empty edits (caller should fall back to
 *   extractExecutableCode for backward compatibility).
 */
export function parseEditResponse(raw: string): EditParseResult {
  // Check for full rewrite first
  const fullRewriteMatch = raw.match(
    /<<<FULL_REWRITE\s*\n([\s\S]*?)\n\s*>>>FULL_REWRITE/,
  );
  if (fullRewriteMatch) {
    // Extract code from within the full rewrite block (may have a code fence)
    let code = fullRewriteMatch[1];
    const fenceMatch = code.match(/```(?:python)?\s*\n([\s\S]*?)```/);
    if (fenceMatch) {
      code = fenceMatch[1];
    }
    return {
      edits: [],
      isFullRewrite: true,
      fullRewriteCode: code.trim(),
    };
  }

  // Extract <<<SEARCH ... === ... >>>SEARCH blocks
  const edits: SearchReplaceEdit[] = [];
  const editPattern = /<<<SEARCH\s*\n([\s\S]*?)\n===\n([\s\S]*?)\n>>>SEARCH/g;
  let match: RegExpExecArray | null;

  while ((match = editPattern.exec(raw)) !== null) {
    edits.push({
      searchBlock: match[1],
      replaceBlock: match[2],
    });
  }

  return { edits, isFullRewrite: false };
}

// ── Application ──────────────────────────────────────────────────────────────

/**
 * Normalize trailing whitespace on each line for matching purposes.
 * Trims trailing spaces/tabs from each line to handle whitespace-only
 * differences between the LLM output and the original code.
 */
function normalizeTrailingWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

/**
 * Apply search-and-replace edits to original code.
 *
 * Each edit must match exactly once in the code (after trailing whitespace
 * normalization). Edits are applied sequentially — later edits operate on
 * the result of earlier ones.
 *
 * Returns the modified code, count of applied edits, and any search blocks
 * that failed to find exactly one match.
 */
export function applyEdits(
  originalCode: string,
  edits: SearchReplaceEdit[],
): EditApplyResult {
  let code = originalCode;
  let appliedCount = 0;
  const failedSearches: string[] = [];

  for (const edit of edits) {
    const normalizedCode = normalizeTrailingWhitespace(code);
    const normalizedSearch = normalizeTrailingWhitespace(edit.searchBlock);

    // Count occurrences
    let count = 0;
    let searchStart = 0;
    while (true) {
      const idx = normalizedCode.indexOf(normalizedSearch, searchStart);
      if (idx === -1) break;
      count++;
      searchStart = idx + 1;
    }

    if (count !== 1) {
      // Zero matches or multiple matches — skip this edit
      const snippet =
        edit.searchBlock.length > 80
          ? edit.searchBlock.slice(0, 80) + "..."
          : edit.searchBlock;
      failedSearches.push(
        `${count === 0 ? "no match" : `${count} matches`}: ${snippet}`,
      );
      continue;
    }

    // Apply the replacement using normalized search on normalized code,
    // but reconstruct using the original whitespace structure.
    // Since we normalize both, we find the index in normalized space and
    // replace the corresponding span in the original code.
    const idx = normalizedCode.indexOf(normalizedSearch);

    // Map normalized index back to original: the index positions are the
    // same because normalizeTrailingWhitespace only removes trailing
    // whitespace within lines (doesn't change line count or positions
    // within lines up to trailing spaces). However, the lengths may differ.
    // We need to find the original span length.
    const originalLines = code.split("\n");
    const normalizedLines = normalizedCode.split("\n");
    const searchLines = normalizedSearch.split("\n");

    // Find which line in normalizedCode the match starts on
    let charCount = 0;
    let startLine = 0;
    for (let i = 0; i < normalizedLines.length; i++) {
      if (charCount + normalizedLines[i].length >= idx) {
        startLine = i;
        break;
      }
      charCount += normalizedLines[i].length + 1; // +1 for \n
    }

    // The match spans searchLines.length lines starting at startLine
    const endLine = startLine + searchLines.length - 1;

    // Reconstruct: replace lines startLine..endLine with the replacement
    const before = originalLines.slice(0, startLine);
    const after = originalLines.slice(endLine + 1);
    const replacementLines = edit.replaceBlock.split("\n");

    code = [...before, ...replacementLines, ...after].join("\n");
    appliedCount++;
  }

  return {
    success: appliedCount > 0 && failedSearches.length === 0,
    resultCode: code,
    appliedCount,
    failedSearches,
  };
}

// ── Mode decision ────────────────────────────────────────────────────────────

/**
 * Decide whether to use edit mode for the current fix iteration.
 *
 * Edit mode is used when:
 * 1. The previous render succeeded (we have known-good code to edit)
 * 2. The error category is in the edit-friendly set
 * 3. The same error category hasn't repeated too many times consecutively
 *    (>= 3 consecutive same-category errors suggests edits aren't working)
 *
 * If iteration 1 fails to render, iteration 2 uses full regen (no baseline).
 */
export function shouldUseEditMode(params: {
  iteration: number;
  previousRenderSucceeded: boolean;
  errorCategory: RenderErrorCategory | null;
  consecutiveSameCategory: number;
}): boolean {
  const {
    iteration,
    previousRenderSucceeded,
    errorCategory,
    consecutiveSameCategory,
  } = params;

  // First iteration is always full generation
  if (iteration <= 1) return false;

  // Must have a successful prior render to have code worth editing
  if (!previousRenderSucceeded) return false;

  // VLM-only feedback (no render error) — use edit mode for visual tweaks
  if (errorCategory === null) return true;

  // Check if the error category is edit-friendly
  if (!EDIT_FRIENDLY_CATEGORIES.has(errorCategory)) return false;

  // If same error keeps repeating, switch to full regen
  // KERNEL_ERROR gets fewer chances (>= 2), others get 3
  const maxConsecutive =
    errorCategory === RenderErrorCategory.KERNEL_ERROR ? 2 : 3;
  if (consecutiveSameCategory >= maxConsecutive) return false;

  return true;
}
