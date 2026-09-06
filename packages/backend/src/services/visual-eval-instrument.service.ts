/**
 * Instrument and specimen for the visual judge (issues #35, #36; ADR 0003).
 *
 * The system prompt the judge receives is two things interleaved. The
 * INSTRUMENT — role, caveats, rubric, output shape — is the part that must
 * hold still for two evaluations to be comparable. The SPECIMEN — the user's
 * request, the category, the construction spec, the checklist items — is the
 * part that varies per example by design. The views are neither: every entry
 * point sends the same eight (`visual-eval-views.ts`).
 *
 * An instrument is a template with named slots for the specimen. Production
 * ships one (`visual-eval-instrument-templates.ts`); an experiment run may
 * carry its own, and then every example in that run is judged under one
 * instrument with its own specimen injected — the loop that lets the judge's
 * instructions be changed and measured instead of edited in source (#35).
 */

// ── Slots ────────────────────────────────────────────────────────────

/** Every slot an instrument may name, with what it renders to. */
export const SPECIMEN_SLOTS = {
  user_prompt: "The user's request, verbatim.",
  category: "The workbench category name.",
  complexity: "The category complexity, 1–10.",
  construction_spec: "The construction spec text, or empty.",
  construction_spec_block: "The construction spec under its heading and framing, or empty.",
  checklist_items: "The checklist as a numbered list, or empty.",
  checklist_block: "The numbered list plus production's pass/fail/uncertain instructions, the evidence clause and the JSON checklist shape, or empty.",
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
 * Substitute named values into a template.
 *
 * Paragraphs (blank-line separated) are the unit: a paragraph that is exactly
 * one slot disappears when that slot's value is empty, so optional blocks —
 * spec, checklist — leave no gap behind. Every other paragraph is kept
 * verbatim with its slots substituted. A slot the values do not name is an
 * error, never left in the prompt.
 */
export function renderSlots(template: string, values: Record<string, string>): string {
  const out: string[] = [];
  for (const paragraph of template.split(PARAGRAPH)) {
    const lone = paragraph.match(LONE_SLOT);
    if (lone) {
      const value = slotValue(lone[1], values);
      if (value !== "") out.push(value);
      continue;
    }
    out.push(paragraph.replace(SLOT_TOKEN, (_, name: string) => slotValue(name, values)));
  }
  return out.join(PARAGRAPH);
}

function slotValue(name: string, values: Record<string, string>): string {
  if (!Object.prototype.hasOwnProperty.call(values, name)) {
    throw new InstrumentTemplateError(`Unknown specimen slot {{${name}}}`);
  }
  return values[name];
}

/** The instrument with this example's specimen in its slots. */
export function renderInstrument(template: string, specimen: Specimen): string {
  return renderSlots(template, specimen);
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

export interface SpecimenInput {
  userPrompt: string;
  categoryName: string;
  complexity: number;
  /** The checklist items to ask; blank entries are dropped. */
  checklist: string[];
  constructionSpec: string;
}

/** The example's side of the prompt, one string per slot. */
export function buildSpecimen(input: SpecimenInput): Specimen {
  return {
    user_prompt: input.userPrompt,
    category: input.categoryName,
    complexity: String(input.complexity),
    construction_spec: input.constructionSpec,
    construction_spec_block: input.constructionSpec ? constructionSpecBlock(input.constructionSpec) : "",
    checklist_items: checklistItems(input.checklist),
    checklist_block: checklistBlock(input.checklist),
  };
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
 * Production's checklist block: the items, how to answer them, and the
 * evidence clause (issue #50: each detail names the views checked and what
 * was seen, which makes a disagreement inspectable). Empty when there is
 * nothing real to ask — a numbered list of "undefined" is worse than no
 * checklist, because it looks to the judge like questions it must answer
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

CRITICAL — evidence per item:
In "detail", name the view or views you checked (front, back, left, right, top, bottom, 45° down,
45° up) and state in one sentence what those views show at that location: the count you see, the
shape you see, where it sits. A detail that names no view is not an answer.

Include in your JSON response:
"checklist": [
  { "question": "...", "pass": true|false|null, "detail": "<view(s) checked>: <what was seen>" },
  ...
]`;
}
