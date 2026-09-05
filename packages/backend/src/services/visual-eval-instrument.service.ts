/**
 * Instrument and specimen for the visual judge (issues #35, #36).
 *
 * The system prompt the judge receives is two things interleaved. The
 * INSTRUMENT — role, caveats, rubric, output shape — is the part that must
 * hold still for two evaluations to be comparable. The SPECIMEN — the user's
 * request, the views provided, the construction spec, the checklist items — is
 * the part that varies per example by design.
 *
 * An instrument is a template with named slots for the specimen. Production
 * ships two (`visual-eval-instrument-templates.ts`); an experiment run may
 * carry its own, and then every example in that run is judged under one
 * instrument with its own specimen injected — the loop that lets the judge's
 * instructions be changed and measured instead of edited in source (#35).
 */
import type { BuildEvalPromptOptions } from "./visual-eval-prompt.service.js";

// ── Slots ────────────────────────────────────────────────────────────

/** Every slot an instrument may name, with what it renders to. */
export const SPECIMEN_SLOTS = {
  model_preamble: "The judge model's calibration preamble (`vlm_eval_preamble`), or empty.",
  user_prompt: "The user's request, verbatim.",
  category: "The workbench category name.",
  complexity: "The category complexity, 1–10.",
  view_description: "The sentence naming the labelled views provided.",
  view_count: "The number of views provided (8 when unknown).",
  eval_plan: "The per-prompt eval plan's system prompt, or empty.",
  zoom_tool_block: "The detail-view tool instructions when the judge has the tool, else empty.",
  construction_spec: "The construction spec text, or empty.",
  construction_spec_block: "The construction spec under its heading and framing, or empty.",
  checklist_items: "The checklist as a numbered list, or empty.",
  checklist_block: "The numbered list plus production's pass/fail/uncertain instructions and the JSON checklist shape, or empty.",
} as const;

export type SpecimenSlot = keyof typeof SPECIMEN_SLOTS;
export type Specimen = Record<SpecimenSlot, string>;

const SLOT_NAMES = new Set<string>(Object.keys(SPECIMEN_SLOTS));
const SLOT_TOKEN = /\{\{([a-z_]+)\}\}/g;
const LONE_SLOT = /^\{\{([a-z_]+)\}\}$/;
const PARAGRAPH = "\n\n";

export class InstrumentTemplateError extends Error {}

// ── Rendering ────────────────────────────────────────────────────────

/**
 * Substitute the specimen into the instrument.
 *
 * Paragraphs (blank-line separated) are the unit: a paragraph that is exactly
 * one slot disappears when that slot is empty for this example, so optional
 * blocks — preamble, eval plan, spec, checklist — leave no gap behind. Every
 * other paragraph is kept verbatim with its slots substituted. An unknown slot
 * is an error, never left in the prompt.
 */
export function renderInstrument(template: string, specimen: Specimen): string {
  const out: string[] = [];
  for (const paragraph of template.split(PARAGRAPH)) {
    const lone = paragraph.match(LONE_SLOT);
    if (lone) {
      const value = slotValue(lone[1], specimen);
      if (value !== "") out.push(value);
      continue;
    }
    out.push(paragraph.replace(SLOT_TOKEN, (_, name: string) => slotValue(name, specimen)));
  }
  return out.join(PARAGRAPH);
}

function slotValue(name: string, specimen: Specimen): string {
  if (!SLOT_NAMES.has(name)) throw new InstrumentTemplateError(`Unknown specimen slot {{${name}}}`);
  return specimen[name as SpecimenSlot];
}

/**
 * Why a template cannot be used as an instrument; empty when it can. Checked
 * where a variant enters the system, so a typo fails the experiment's creation
 * rather than 125 evaluations later.
 */
export function validateInstrumentTemplate(template: string): string[] {
  if (template.trim().length === 0) return ["Template is empty"];
  const errors: string[] = [];
  const found = new Set<string>();
  for (const m of template.matchAll(SLOT_TOKEN)) {
    if (SLOT_NAMES.has(m[1])) found.add(m[1]);
    else errors.push(`Unknown slot {{${m[1]}}}; known slots: ${[...SLOT_NAMES].join(", ")}`);
  }
  const stray = template.replace(SLOT_TOKEN, "").match(/\{\{[^}]*\}\}|\{\{/g);
  if (stray) errors.push(`Malformed slot token(s): ${[...new Set(stray)].join(", ")}`);
  if (!found.has("user_prompt")) {
    errors.push("Template must include {{user_prompt}} — the judge cannot work without the request");
  }
  if (!found.has("checklist_items") && !found.has("checklist_block")) {
    errors.push("Template must include {{checklist_items}} or {{checklist_block}} — items are the gate");
  }
  return errors;
}

// ── Specimen ─────────────────────────────────────────────────────────

/** The example's side of the prompt, one string per slot. */
export function buildSpecimen(opts: BuildEvalPromptOptions): Specimen {
  const angles = opts.providedAngles ?? [];
  return {
    model_preamble: opts.evalPreamble ?? "",
    user_prompt: opts.userPrompt,
    category: opts.categoryName,
    complexity: String(opts.complexity),
    view_description: buildViewDescription(angles),
    view_count: String(angles.length || 8),
    eval_plan: opts.evalPlan?.systemPrompt ?? "",
    zoom_tool_block: opts.hasZoomTool ? zoomToolBlock() : "",
    construction_spec: opts.constructionSpec ?? "",
    construction_spec_block: opts.constructionSpec ? constructionSpecBlock(opts.constructionSpec) : "",
    checklist_items: checklistItems(opts.checklist),
    checklist_block: checklistBlock(opts.checklist),
  };
}

const ANGLE_DISPLAY_NAMES: Record<string, string> = {
  front: "front",
  back: "back",
  left: "left",
  right: "right",
  top: "top",
  bottom: "bottom",
  ortho_45: "a 45° down view",
  ortho_45_bottom: "a 45° up view",
  isometric: "isometric",
};

function buildViewDescription(providedAngles: string[]): string {
  if (providedAngles.length === 0) {
    return "You are provided labeled views: front, back, left, right, top, bottom, a 45° down view, and a 45° up view.\nTogether these cover all six faces of the model plus two complementary 3D overviews (from above and below).";
  }
  const names = providedAngles.map(a => ANGLE_DISPLAY_NAMES[a] ?? a);
  return `You are provided ${names.length} labeled views: ${names.join(", ")}.\nThese views were selected to best show the key features of this model.`;
}

function zoomToolBlock(): string {
  return `DETAIL VIEW CAPABILITY:
You have a "request_detail_view" tool that renders a 1024px detail view with tight framing.
ONLY use this when you genuinely CANNOT determine whether a specific feature is present or absent
from the standard views. Most evaluations should NOT need detail views.

Valid reasons to request a detail view:
- Verifying thread pitch or gear tooth count on features smaller than ~5% of the model
- Confirming a tiny drive recess (Phillips, Torx) that is barely visible

Do NOT request detail views for:
- Overall shape or proportion verification — use standard views
- Feature presence that you can already see (even if small)
- Any feature you can describe from the standard views — if you can see it, you don't need zoom
- General "closer look" or "better inspection" — that is not a valid reason

You may request up to 2 detail views. Provide your evaluation directly unless a feature is truly unresolvable.`;
}

function constructionSpecBlock(constructionSpec: string): string {
  return `## Geometric Specification
The model should implement the following structural properties:
${constructionSpec}

Use this specification as your primary reference for evaluating correctness. Check whether
the visible geometry matches the structural properties listed above.`;
}

/** The asked questions as a numbered list. Blank entries are dropped (issue #33); nothing left → "". */
function checklistItems(checklist: string[]): string {
  const questions = checklist.filter(q => typeof q === "string" && q.trim().length > 0);
  return questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
}

/**
 * Production's checklist block: the items plus how to answer them. Empty when
 * there is nothing real to ask — a numbered list of "undefined" is worse than
 * no checklist, because it looks to the judge like questions it must answer
 * (issue #33).
 */
function checklistBlock(checklist: string[]): string {
  const items = checklistItems(checklist);
  if (!items) return "";

  return `Verification Checklist — answer each with pass, fail, or uncertain:
${items}

For each item, set "pass" to:
- true — feature is clearly present/correct in the images
- false — feature is clearly absent or wrong
- null — you CANNOT resolve this feature at the current image resolution (too small, too subtle, or occluded in ALL views)

CRITICAL — cross-view evidence:
If a feature is clearly visible in ANY single view, mark it pass — even if other views cannot
show it due to angle or occlusion. A through-hole visible from top and bottom is confirmed present
even if the front view cannot show it. Do NOT let one ambiguous angle override clear evidence from
another. Only mark uncertain (null) when NO view provides clear evidence either way.

Include in your JSON response:
"checklist": [
  { "question": "...", "pass": true|false|null, "detail": "brief explanation" },
  ...
]`;
}
