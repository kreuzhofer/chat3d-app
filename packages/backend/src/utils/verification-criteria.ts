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
import type { AnnotatedCriterion, AtomRole } from "../services/spec-generation.service.js";

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

/** True when the criterion names a specific measurement the visual judge may not be asked. */
export function namesAMeasurement(text: string): boolean {
  return DIMENSION_PATTERN.test(text);
}

/**
 * The routing rule, decided once (issue #38): a criterion naming a measurement
 * is the code reviewer's whatever its annotation says — "visual" or "both"
 * included, since the visual judge is never asked a question it cannot answer
 * from a render, and withholding a check from one judge must hand it to the
 * other, not drop it. An explicit "code" stays "code".
 */
export function routeVisibility(text: string, visibility: ChecklistVisibility): ChecklistVisibility {
  return namesAMeasurement(text) ? "code" : visibility;
}

/** An atom's role (#136), or null when absent or not one of the two. */
export function parseAtomRole(value: unknown): AtomRole | null {
  return value === "structural" || value === "feature" ? value : null;
}

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
  let invalidRoles = 0;
  for (const entry of value) {
    const asString = usableText(entry);
    if (asString) {
      out.push({ text: asString, visibility: routeVisibility(asString, DEFAULT_VISIBILITY) });
      continue;
    }
    if (typeof entry === "object" && entry !== null) {
      const text = usableText((entry as { text?: unknown }).text);
      if (!text) { dropped++; continue; }
      const parsedVisibility = ChecklistVisibilityEnum.safeParse(
        (entry as { visibility?: unknown }).visibility,
      );
      // A role is kept when stored and valid; criteria written before #136
      // carry none and load without one — never a guessed role.
      const rawRole = (entry as { role?: unknown }).role;
      const role = parseAtomRole(rawRole);
      if (rawRole !== undefined && !role) invalidRoles++;
      out.push({
        text,
        visibility: routeVisibility(text, parsedVisibility.success ? parsedVisibility.data : DEFAULT_VISIBILITY),
        ...(role ? { role } : {}),
      });
      continue;
    }
    dropped++;
  }
  if (dropped > 0) {
    logger.warn({ dropped, kept: out.length }, "dropped verification criteria with no usable text");
  }
  if (invalidRoles > 0) {
    logger.warn({ invalidRoles }, "criteria kept without their stored role: not structural or feature");
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
  // Measurements were routed to "code" by the normaliser; the filter here is
  // the one field both judges read.
  const derived = toAnnotatedCriteria(criteria)
    .filter(c => c.visibility !== "code")
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

/**
 * The criteria only the code reviewer verifies: annotated "code", or naming a
 * measurement the visual judge may not be asked (routed there by the
 * normaliser). The complement of what deriveVisualChecklist() puts in front of
 * the judge, so between them nothing is lost.
 */
export function codeOnlyCriteria(criteria: unknown): AnnotatedCriterion[] {
  return toAnnotatedCriteria(criteria).filter(c => c.visibility === "code");
}
