/**
 * What the visual judge was actually shown (issue #34).
 *
 * Before #33, enrichment turned every verification criterion into the literal
 * string "undefined", and that placeholder list unconditionally replaced the
 * real checklist. 1,333 production examples — 1,210 of them auto-approved into
 * the fine-tuning set — carry scores produced that way. They are not
 * comparable with rows scored against a real checklist, so every row records
 * which kind of checklist produced it.
 *
 * "placeholder" is a historical value only: `toAnnotatedCriteria` now drops
 * textless criteria, so the write path cannot produce one. It is still
 * detected rather than assumed away, because silently reclassifying a
 * recurrence as "real" is how the original defect stayed hidden for months.
 */

export type ChecklistState = "real" | "empty" | "placeholder";

/** The literal text a textless criterion used to render as. */
const PLACEHOLDER_ITEM = "undefined";

/**
 * The numbered-list rendering of a placeholder item ("1. undefined").
 *
 * Anchoring on the list marker matters: the bare word appears legitimately in
 * prompt prose ("do NOT flag them as undefined"), and matching that would
 * mark ~every bd_warehouse example as defective.
 */
const PLACEHOLDER_IN_PROMPT = /(^|\n)\s*\d+\.\s*undefined\s*(\n|$)/;

/** The same rule for SQL backfills, kept beside the regex so the two agree. */
export const PLACEHOLDER_CHECKLIST_SQL_PATTERN = "%. undefined%";

/** Marks the start of the rendered checklist block in a stored judge prompt. */
const CHECKLIST_HEADING = /verification checklist/i;

/** Classify the checklist a judge is about to be given. */
export function classifyChecklist(checklist: string[] | undefined | null): ChecklistState {
  const items = (checklist ?? []).filter(
    (q) => typeof q === "string" && q.trim().length > 0,
  );
  if (items.length === 0) return "empty";
  if (items.every((q) => q.trim() === PLACEHOLDER_ITEM)) return "placeholder";
  return "real";
}

/**
 * Classify a historical row from the judge prompt that was stored with it.
 * Returns null when there is no prompt to read, which is not the same as
 * "no checklist" and must not be recorded as such.
 */
export function classifyStoredPrompt(prompt: string | null | undefined): ChecklistState | null {
  if (!prompt) return null;
  if (PLACEHOLDER_IN_PROMPT.test(prompt)) return "placeholder";
  return CHECKLIST_HEADING.test(prompt) ? "real" : "empty";
}
