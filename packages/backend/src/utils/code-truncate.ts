/**
 * Shared code truncation utility.
 * Used by agent tools (search_examples display) and prompt builders (pre-retrieved examples).
 */

export function truncateCode(code: string, maxLines: number): string {
  const lines = code.split("\n");
  if (lines.length <= maxLines) return code;
  return lines.slice(0, maxLines).join("\n") + `\n# ... (${lines.length - maxLines} more lines)`;
}
