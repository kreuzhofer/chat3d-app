/**
 * Visual Evaluation Response Parser
 *
 * Three-level fallback parsing for VLM evaluation responses:
 * 1. JSON from code fence
 * 2. Direct JSON.parse
 * 3. Regex extraction from unstructured text
 */

// ── Result types ─────────────────────────────────────────────────────

export interface ChecklistResult {
  question: string;
  /** true = pass, false = fail, null = uncertain (cannot resolve at this resolution) */
  pass: boolean | null;
  detail: string;
}

/** Check if a checklist result is uncertain (VLM could not resolve the feature). */
export function isUncertain(result: ChecklistResult): boolean {
  return result.pass === null;
}

export interface ParsedEvaluation {
  score: number;
  issues: string[];
  suggestions: string[];
}

// ── Score helpers ────────────────────────────────────────────────────

function clampScore(score: number): number {
  if (typeof score !== "number" || isNaN(score)) return 1;
  return Math.max(1, Math.min(10, Math.round(score)));
}

function buildResultFromParsed(parsed: ParsedEvaluation): ParsedEvaluation {
  return {
    score: clampScore(parsed.score),
    issues: Array.isArray(parsed.issues)
      ? parsed.issues.filter((i): i is string => typeof i === "string")
      : [],
    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s): s is string => typeof s === "string")
      : [],
  };
}

// ── Bullet extraction ────────────────────────────────────────────────

/**
 * Extract bullet items from a markdown section.
 * Handles plain bullets (- item) and markdown bold bullets (* **label**: text).
 */
function extractBulletItems(text: string): string[] {
  const items: string[] = [];
  const bulletMatches = text.match(/^[\t ]*[-•*]\s+.+/gm);
  if (bulletMatches) {
    for (const m of bulletMatches) {
      let cleaned = m.replace(/^[\t ]*[-•*]\s+/, "").trim();
      cleaned = cleaned.replace(/^\*\*([^*]+)\*\*/, "$1");
      if (cleaned.length > 0) {
        items.push(cleaned);
      }
    }
  }
  return items;
}

// ── Text extraction fallback ─────────────────────────────────────────

function extractFromText(content: string): ParsedEvaluation {
  const scoreMatch = content.match(/["']?score["']?\s*[:=]\s*(\d+)/i);
  const score = scoreMatch ? clampScore(parseInt(scoreMatch[1], 10)) : 1;

  const issues: string[] = [];
  const issuesSection = content.match(/issues[:\s]*\n?([\s\S]*?)(?=\n\s*(?:suggestions|checklist)[:\s]*\n|$)/i);
  if (issuesSection) {
    issues.push(...extractBulletItems(issuesSection[1]));
  }

  const suggestions: string[] = [];
  const suggestionsSection = content.match(/suggestions[:\s]*\n?([\s\S]*?)(?=\n\s*checklist[:\s]*\n|$)/i);
  if (suggestionsSection) {
    suggestions.push(...extractBulletItems(suggestionsSection[1]));
  }

  if (!scoreMatch && issues.length === 0 && suggestions.length === 0) {
    return { score: 1, issues: ["Failed to parse evaluation response"], suggestions: [] };
  }

  return { score, issues, suggestions };
}

// ── Main parser (three-level fallback) ───────────────────────────────

export function parseEvaluationResponse(content: string): ParsedEvaluation {
  if (!content || typeof content !== "string") {
    return { score: 1, issues: ["Empty response"], suggestions: [] };
  }

  // Level 1: Extract JSON from code fence
  let jsonStr = content;
  const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim();
  }

  // Level 2: Direct JSON.parse
  try {
    const parsed = JSON.parse(jsonStr) as ParsedEvaluation;
    return buildResultFromParsed(parsed);
  } catch {
    // fall through
  }

  // Level 3: Regex extraction from unstructured text
  return extractFromText(content);
}

// ── Checklist parsing ────────────────────────────────────────────────

export function parseChecklistResults(content: string): ChecklistResult[] {
  // Level 1: Try JSON extraction
  try {
    let jsonStr = content;
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as { checklist?: Array<{ question?: string; pass?: boolean | null | string; detail?: string }> };
    if (parsed.checklist && Array.isArray(parsed.checklist)) {
      return parsed.checklist
        .filter((c) => typeof c.question === "string")
        .map((c) => ({
          question: c.question!,
          // null or "uncertain" string → null (uncertain). Otherwise boolean.
          pass: c.pass === null || c.pass === "uncertain" ? null : c.pass === true,
          detail: typeof c.detail === "string" ? c.detail : "",
        }));
    }
  } catch {
    // fall through to markdown extraction
  }

  // Level 2: Extract from markdown checklist section
  const checklistSection = content.match(/checklist[:\s]*\n?([\s\S]*?)(?=\n\s*(?:score|issues|suggestions)[:\s]*\n|$)/i);
  if (checklistSection) {
    const results: ChecklistResult[] = [];
    const lines = checklistSection[1].split("\n");
    for (const line of lines) {
      const trimmed = line.replace(/^[\t ]*[-•*]\s*/, "").trim();
      if (!trimmed) continue;
      const passMatch = /;\s*(pass|fail|uncertain)\.?\s*$/i.exec(trimmed);
      const pass = passMatch
        ? (passMatch[1].toLowerCase() === "uncertain" ? null : passMatch[1].toLowerCase() === "pass")
        : (/(uncertain|cannot determine|cannot resolve)/i.test(trimmed) ? null : !/(fail|incorrect|wrong|missing)/i.test(trimmed));
      const boldMatch = trimmed.match(/^\*\*([^*]+)\*\*\s*[—–-]\s*(.*)/);
      if (boldMatch) {
        results.push({
          question: boldMatch[1].trim(),
          pass,
          detail: boldMatch[2].replace(/;\s*(pass|fail)\.?\s*$/i, "").trim(),
        });
      } else if (trimmed.length > 10) {
        results.push({
          question: trimmed.replace(/;\s*(pass|fail)\.?\s*$/i, "").trim(),
          pass,
          detail: "",
        });
      }
    }
    if (results.length > 0) return results;
  }

  return [];
}
