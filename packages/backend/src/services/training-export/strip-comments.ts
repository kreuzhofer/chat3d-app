export type CommentMode = "none" | "smart" | "smarter";

/**
 * Strip Python `#` comments from source code.
 *
 * Modes:
 *   none    — return input unchanged
 *   smart   — drop all whole-line `#` comments (lines whose first non-whitespace
 *             char is `#`). Keep inline comments (after code on same line).
 *   smarter — drop only top-level whole-line `#` comments (indent === 0).
 *             Keep indented whole-line comments (typically CoT inside blocks)
 *             and all inline comments.
 *
 * Inline comments are NEVER stripped because the Build123d parameter
 * extractor uses them as slider labels in the UI.
 *
 * String handling: tracks state line-by-line for `'`/`"` quotes (Python
 * forbids unterminated single-line strings) and across lines for `'''`/`"""`
 * triple-quoted strings.
 */
export function stripComments(code: string, mode: CommentMode): string {
  if (mode === "none") return code;

  const lines = code.split("\n");
  const out: string[] = [];
  let inTriple: '"""' | "'''" | null = null;

  for (const rawLine of lines) {
    if (inTriple) {
      out.push(rawLine);
      const closeIdx = rawLine.indexOf(inTriple);
      if (closeIdx !== -1) {
        inTriple = null;
      }
      continue;
    }

    let commentCol = -1;
    let strChar: '"' | "'" | null = null;
    let i = 0;
    while (i < rawLine.length) {
      const c = rawLine[i];
      if (strChar === null) {
        if (rawLine.startsWith('"""', i)) {
          const close = rawLine.indexOf('"""', i + 3);
          if (close === -1) {
            inTriple = '"""';
            i = rawLine.length;
          } else {
            i = close + 3;
          }
          continue;
        }
        if (rawLine.startsWith("'''", i)) {
          const close = rawLine.indexOf("'''", i + 3);
          if (close === -1) {
            inTriple = "'''";
            i = rawLine.length;
          } else {
            i = close + 3;
          }
          continue;
        }
        if (c === '"' || c === "'") {
          strChar = c;
          i++;
          continue;
        }
        if (c === "#") {
          commentCol = i;
          break;
        }
        i++;
      } else {
        if (c === "\\" && i + 1 < rawLine.length) {
          i += 2;
          continue;
        }
        if (c === strChar) {
          strChar = null;
        }
        i++;
      }
    }

    if (commentCol === -1) {
      out.push(rawLine);
      continue;
    }

    const before = rawLine.slice(0, commentCol);
    const isWholeLine = before.trim() === "";
    if (!isWholeLine) {
      out.push(rawLine);
      continue;
    }

    if (mode === "smart") {
      continue;
    }
    if (before.length > 0) {
      out.push(rawLine);
    }
  }

  let result = out.join("\n");
  while (result.includes("\n\n\n")) {
    result = result.replace(/\n\n\n/g, "\n\n");
  }
  return result;
}
