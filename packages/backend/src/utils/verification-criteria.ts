/**
 * One home for the shape of verification criteria (issue #33).
 *
 * Spec generation emits `{ text, visibility }`. Spec enrichment returns bare
 * strings. Consumers mapped `.text` over whichever arrived, so after enrichment
 * every checklist item became `undefined` — and since neither the visibility
 * filter nor the dimension filter rejects `undefined`, the placeholders sailed
 * through and replaced the plain checklist that was already correct. 58% of
 * stored judge prompts ended up reading "1. undefined".
 *
 * Both shapes are accepted here, and nothing that cannot yield real text is
 * allowed out.
 */
import { createLogger } from "./logger.js";
import { ChecklistVisibilityEnum, type ChecklistVisibility } from "./component-checklist.js";
import type { AnnotatedCriterion } from "../services/spec-generation.service.js";

const logger = createLogger("verification-criteria");

/**
 * Visibility assumed for a criterion that arrives without one — currently the
 * case for everything enrichment produces.
 *
 * "both" rather than "visual": it keeps the criterion in front of the judge
 * (the reason enrichment writes them) while leaving it available to code
 * review, and it matches the default spec generation already applies when it
 * derives criteria from a plain checklist. Stated explicitly because guessing
 * this silently is how the original defect arose.
 */
const DEFAULT_VISIBILITY: ChecklistVisibility = "both";

/**
 * A criterion naming a specific measurement is routed away from the judge: it
 * cannot measure millimetres or degrees from a screenshot, and asking it to
 * invites a confident wrong answer. Code review handles these.
 */
const DIMENSION_PATTERN = /\b\d+(\.\d+)?\s*(mm|cm|m\b|°|degrees?|radius|diameter)\b/i;

function usableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalise either shape into annotated criteria, dropping anything that cannot
 * produce real text. Never returns an entry whose text is empty or absent.
 */
export function toAnnotatedCriteria(value: unknown): AnnotatedCriterion[] {
  if (!Array.isArray(value)) return [];

  const out: AnnotatedCriterion[] = [];
  let dropped = 0;
  for (const entry of value) {
    const asString = usableText(entry);
    if (asString) {
      out.push({ text: asString, visibility: DEFAULT_VISIBILITY });
      continue;
    }
    if (typeof entry === "object" && entry !== null) {
      const text = usableText((entry as { text?: unknown }).text);
      if (!text) { dropped++; continue; }
      const parsedVisibility = ChecklistVisibilityEnum.safeParse(
        (entry as { visibility?: unknown }).visibility,
      );
      out.push({ text, visibility: parsedVisibility.success ? parsedVisibility.data : DEFAULT_VISIBILITY });
      continue;
    }
    dropped++;
  }
  if (dropped > 0) {
    logger.warn({ dropped, kept: out.length }, "dropped verification criteria with no usable text");
  }
  return out;
}

/**
 * The checklist put in front of the visual judge.
 *
 * Falls back to the plain checklist when the criteria yield nothing usable.
 * Replacing real questions with an empty list — or worse, with placeholders —
 * is strictly worse than ignoring the annotation, which is exactly what the
 * previous unconditional overwrite did.
 */
export function deriveVisualChecklist(
  criteria: unknown,
  fallbackChecklist: string[] | undefined,
): string[] {
  const derived = toAnnotatedCriteria(criteria)
    .filter(c => c.visibility !== "code" && !DIMENSION_PATTERN.test(c.text))
    .map(c => c.text);

  if (derived.length > 0) return derived;

  // The same dimension filter applies to the fallback: it exists to keep
  // unmeasurable questions away from the judge, and letting them through this
  // path would defeat it.
  const fallback = (fallbackChecklist ?? []).filter(
    q => typeof q === "string" && q.trim().length > 0 && !DIMENSION_PATTERN.test(q),
  );
  if (fallback.length > 0) {
    logger.info(
      { fallbackCount: fallback.length },
      "no visual criteria survived filtering — falling back to the plain checklist",
    );
  }
  return fallback;
}
