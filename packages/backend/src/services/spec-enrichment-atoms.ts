/**
 * The atoms contract enrichment must meet (ADR 0002, issue #104).
 *
 * Enrichment emits one requirement per entry as `{ text, visibility }`, the
 * shape spec generation already uses. A reply of bare strings, of entries
 * without a visibility, or of bundled atoms (a judge-facing entry that also
 * names a measurement) is a failed enrichment: refused here, retried once by
 * the service, then surfaced — never normalised to `both` by default, which is
 * how issue #33 stayed hidden for months.
 *
 * Pure: input is whatever the model returned, output is atoms or a reason.
 */
import { ChecklistVisibilityEnum } from "../utils/component-checklist.js";
import { namesAMeasurement } from "../utils/verification-criteria.js";
import type { AnnotatedCriterion } from "./spec-generation.service.js";

export type AtomsFailureReason =
  | "unparseable"
  | "not-an-array"
  | "empty"
  | "bare-string"
  | "missing-visibility"
  | "empty-text"
  | "bundled";

export type AtomsParse =
  | { ok: true; atoms: AnnotatedCriterion[] }
  | { ok: false; reason: AtomsFailureReason; offending: unknown };

/** The rules in the words the prompt uses; kept beside the parser that enforces them. */
export const ATOMS_RULES = `- "verificationCriteria" is a list of REQUIREMENTS, one per entry, each {"text": ..., "visibility": ...}. NEVER a bare string.
- One fact per entry. Never bundle a visual fact with a measurement: "four standoffs near the corners" and "standoff offset is 5mm" are two entries, not one.
- "visibility": "visual" for what a 768px render shows — overall shape, openings, proportions, and the COUNT, PRESENCE, OPENNESS and PLACEMENT of parts the request states ("exactly four standoffs", "lid is separate", "open top", "holes near the corners"). These are mandatory when the request states them.
- "visibility": "code" for every measurement — lengths, thicknesses, radii, angles, spacings, tolerances — and for features too small to see. A "visual" or "both" entry must not contain a number with a unit.
- Where a measurement has a visible proportion (a wall clearly thin, a hole clearly near an edge), add a separate "visual" entry stating the proportion, without the number.
- "visibility": "both" only for medium-size structural features the render confirms AND code verifies, with no number in the text.
- Requirements come from the request and the reference material it names. Do not invent checks for choices the request left open.`;

function usable(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/** Refuse anything that is not a list of well-formed, unbundled atoms. */
export function parseEnrichmentAtoms(raw: unknown): AtomsParse {
  if (!Array.isArray(raw)) return { ok: false, reason: "not-an-array", offending: raw };
  if (raw.length === 0) return { ok: false, reason: "empty", offending: raw };
  const atoms: AnnotatedCriterion[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") return { ok: false, reason: "bare-string", offending: entry };
    if (typeof entry !== "object" || entry === null) return { ok: false, reason: "empty-text", offending: entry };
    const text = usable((entry as { text?: unknown }).text);
    if (!text) return { ok: false, reason: "empty-text", offending: entry };
    const vis = ChecklistVisibilityEnum.safeParse((entry as { visibility?: unknown }).visibility);
    if (!vis.success) return { ok: false, reason: "missing-visibility", offending: entry };
    if (vis.data !== "code" && namesAMeasurement(text)) return { ok: false, reason: "bundled", offending: entry };
    atoms.push({ text, visibility: vis.data });
  }
  return { ok: true, atoms };
}

/** The atoms the visual judge can be asked: everything not routed to code. */
export function judgeAskable(atoms: readonly AnnotatedCriterion[]): AnnotatedCriterion[] {
  return atoms.filter((a) => a.visibility !== "code");
}
