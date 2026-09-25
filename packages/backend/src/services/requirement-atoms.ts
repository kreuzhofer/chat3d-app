/**
 * The requirement-atoms contract (ADR 0002; issues #104 and #106), shared by
 * spec generation and spec enrichment so the two cannot drift.
 *
 * A spec emits one requirement per entry as `{ text, visibility }`. A reply of
 * bare strings, of entries without a visibility, or of bundled atoms (a
 * judge-facing entry that also names a measurement) is a failed reply:
 * refused here, retried once by the caller, then surfaced — never normalised
 * to `both` by default, which is how issue #33 stayed hidden for months.
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
export const REQUIREMENT_ATOMS_RULES = `- "verificationCriteria" is a list of REQUIREMENTS, one per entry, each {"text": ..., "visibility": ...}. NEVER a bare string.
- One fact per entry. Never bundle a visual fact with a measurement: "four standoffs near the corners" and "standoff offset is 5mm" are two entries, not one.
- "visibility": "visual" for what a 768px render shows — overall shape, openings, proportions, and the COUNT, PRESENCE, OPENNESS and PLACEMENT of parts the request states ("exactly four standoffs", "lid is separate", "open top", "holes near the corners"). These are mandatory when the request states them.
- "visibility": "code" for every measurement — lengths, thicknesses, radii, angles, spacings, tolerances — and for features too small to see. A "visual" or "both" entry must not contain a number with a unit.
- Where a measurement has a visible proportion (a wall clearly thin, a hole clearly near an edge), add a separate "visual" entry stating the proportion, without the number.
- "visibility": "both" only for medium-size structural features the render confirms AND code verifies, with no number in the text.
- Requirements come from the request and the reference material it names. Do not invent checks for choices the request left open, and never place a feature somewhere other than where the request puts it ("near each end" is never "in the middle").
- ORIENTATION: the render's front/back/left/right are the camera's, not the part's — a part turned 180° swaps them. Use those words ONLY when the request itself uses them for that feature (top/bottom are fine: the render's up is the part's up); otherwise locate features by the part's own geometry ("on one short end face", "on the face opposite the opening", "on the curved outer surface"). Never ask how a part lies on the build plate (upside down, face down, on the XY plane) unless the request demands it.
- No colour or material checks: renders carry no colour.
- A comparison of two sizes ("thicker than", "larger than") or a fine edge feature (chamfer, fillet, thread form, angle, taper, tangency) is "code", never "visual" — a render cannot settle it.
- One question per entry, in plain words: no "and"/"while" chains, no jargon without a plain description, no counts that depend on how the reader groups features ("four magnet holes" on a 2×2 base means per corner or in total — say which).`;

function usable(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/**
 * Words whose meaning the render frame does NOT fix: front/back/left/right are
 * arbitrary around the vertical axis (a part turned 180° swaps them), and a
 * pose on the plate (upside down, face down, on the XY plane) is layout, not
 * the part. Top/bottom are kept: the camera's up axis is the part's Z, so the
 * top and bottom views do fix them (the sample of 2026-09-25 dropped 20
 * sound "top/bottom face is flat" atoms before this narrowing).
 */
const FRAME_WORDS = /\b(front|back|rear|left|right|upside[- ]down|face[- ]?(?:up|down)|xy[- ]plane)\b/gi;
const COLOUR_WORDS = /\b(colou?r(?:ed)?|translucent|transparent|red|blue|green|yellow|black|white|grey|gray)\b/i;
const COMPARATIVE = /\b(thicker|thinner|larger|smaller|wider|narrower|taller|shorter|deeper|shallower)\b[^.]*\bthan\b/i;
const FINE_FEATURE = /\b(chamfer(?:ed)?|fillet(?:ed)?|thread (?:form|profile)|trapezoidal|acme|included angle|taper(?:ed)?|tangen(?:t|cy)|cusp|fade-?in|ogee|draft angle)\b/i;

export type ScreenReason = "orientation-not-in-request" | "colour";
export interface AtomScreen {
  kept: AnnotatedCriterion[];
  dropped: Array<{ atom: AnnotatedCriterion; reason: ScreenReason; word?: string }>;
  /** Visual atoms moved to code: comparisons and fine features a render cannot settle. */
  routed: AnnotatedCriterion[];
}

/**
 * Screen well-formed atoms for the wrong-question classes Daniel's sittings
 * measured (#113): orientation words the request does not use, colour, and
 * comparisons or fine features asked of the visual judge. Orientation and
 * colour atoms are dropped (logged by the caller); comparisons and fine
 * features are routed to code. Pure.
 */
export function screenAtoms(atoms: readonly AnnotatedCriterion[], requestText?: string): AtomScreen {
  const request = (requestText ?? "").toLowerCase();
  const out: AtomScreen = { kept: [], dropped: [], routed: [] };
  for (const atom of atoms) {
    if (atom.visibility !== "code") {
      if (COLOUR_WORDS.test(atom.text)) { out.dropped.push({ atom, reason: "colour" }); continue; }
      if (requestText) {
        const words = [...atom.text.matchAll(FRAME_WORDS)].map((m) => m[1].toLowerCase());
        const alien = words.find((w) => !request.includes(w.replace(/[- ]/g, " ").split(" ")[0]));
        if (alien) { out.dropped.push({ atom, reason: "orientation-not-in-request", word: alien }); continue; }
      }
      if (COMPARATIVE.test(atom.text) || FINE_FEATURE.test(atom.text)) {
        const moved = { ...atom, visibility: "code" as const };
        out.routed.push(moved); out.kept.push(moved); continue;
      }
    }
    out.kept.push(atom);
  }
  return out;
}

/** Refuse anything that is not a list of well-formed, unbundled atoms. */
export function parseRequirementAtoms(raw: unknown): AtomsParse {
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
