/**
 * Instrument and specimen (issues #35, #36; ADR 0003).
 *
 * The judge's prompt is an INSTRUMENT (role, caveats, rubric, output shape —
 * what must hold still for two evaluations to be comparable) with the
 * SPECIMEN (the example's request, category, spec, checklist) injected
 * through named slots. Production's instrument is a template like any other;
 * an experiment run may carry its own. The views are not a slot.
 */
import { describe, it, expect } from "vitest";
import {
  renderInstrument,
  renderSlots,
  validateInstrumentTemplate,
  buildSpecimen,
  SPECIMEN_SLOTS,
  type Specimen,
} from "../services/visual-eval-instrument.service.js";
import { PRODUCTION_INSTRUMENT_TEMPLATE } from "../services/visual-eval-instrument-templates.js";
import { buildEvaluationSystemPrompt } from "../services/visual-eval-prompt.service.js";
import { JUDGE_PROMPT_FIXTURES } from "./support/judge-prompt-fixtures.js";

const emptySpecimen = (): Specimen =>
  Object.fromEntries(Object.keys(SPECIMEN_SLOTS).map((k) => [k, ""])) as Specimen;

// ── renderInstrument ─────────────────────────────────────────────────

describe("renderInstrument", () => {
  it("substitutes slots in place", () => {
    const s = { ...emptySpecimen(), user_prompt: "a bracket", complexity: "3" };
    expect(renderInstrument('Request: "{{user_prompt}}" at level {{complexity}}.', s))
      .toBe('Request: "a bracket" at level 3.');
  });

  it("drops a paragraph that is exactly one slot when that slot is empty, and keeps it otherwise", () => {
    const tpl = "Role line.\n\n{{construction_spec_block}}\n\n{{checklist_block}}";
    expect(renderInstrument(tpl, { ...emptySpecimen(), checklist_block: "1. q" })).toBe("Role line.\n\n1. q");
    expect(renderInstrument(tpl, { ...emptySpecimen(), construction_spec_block: "SPEC", checklist_block: "1. q" }))
      .toBe("Role line.\n\nSPEC\n\n1. q");
  });

  it("does not drop a paragraph that mixes a slot with other text, even when the slot is empty", () => {
    expect(renderInstrument("Spec: {{construction_spec}}", emptySpecimen())).toBe("Spec: ");
  });

  it("preserves blank lines inside a substituted value", () => {
    const s = { ...emptySpecimen(), construction_spec: "First.\n\nSecond." };
    expect(renderInstrument("A\n\n{{construction_spec}}\n\nB", s)).toBe("A\n\nFirst.\n\nSecond.\n\nB");
  });

  it("refuses an unknown slot instead of leaving it in the prompt", () => {
    expect(() => renderInstrument("Hi {{nope}}", emptySpecimen())).toThrow(/nope/);
    expect(() => renderInstrument("{{model_preamble}}\n\nHi", emptySpecimen())).toThrow(/model_preamble/);
  });

  it("renderSlots takes any slot set — the follow-up's, for one", () => {
    expect(renderSlots("Q: {{question}}\n\n{{ref}}", { question: "why", ref: "" })).toBe("Q: why");
  });
});

// ── validateInstrumentTemplate ───────────────────────────────────────

describe("validateInstrumentTemplate", () => {
  const ok = 'Judge this.\n\nThe user requested: "{{user_prompt}}"\n\n{{checklist_block}}';

  it("accepts a template that names the request and a checklist slot", () => {
    expect(validateInstrumentTemplate(ok)).toEqual([]);
    expect(validateInstrumentTemplate(ok.replace("{{checklist_block}}", "Items:\n{{checklist_items}}"))).toEqual([]);
  });

  it("requires the user's request", () => {
    expect(validateInstrumentTemplate("{{checklist_block}}").join(" ")).toMatch(/user_prompt/);
  });

  it("requires a checklist slot", () => {
    expect(validateInstrumentTemplate('"{{user_prompt}}"').join(" ")).toMatch(/checklist_items.*checklist_block|checklist_block.*checklist_items/);
  });

  it("rejects unknown and malformed slot tokens, the retired slots included", () => {
    expect(validateInstrumentTemplate(`${ok} {{foo}}`).join(" ")).toMatch(/foo/);
    expect(validateInstrumentTemplate(`${ok} {{ user_prompt }}`).join(" ")).toMatch(/user_prompt/);
    for (const retired of ["model_preamble", "eval_plan", "zoom_tool_block", "view_description", "view_count"]) {
      expect(validateInstrumentTemplate(`${ok} {{${retired}}}`).join(" ")).toMatch(new RegExp(retired));
    }
  });

  it("rejects an empty template", () => {
    expect(validateInstrumentTemplate("   ").length).toBeGreaterThan(0);
  });

  it("accepts the production instrument", () => {
    expect(validateInstrumentTemplate(PRODUCTION_INSTRUMENT_TEMPLATE)).toEqual([]);
  });
});

// ── the production instrument is an ordinary template ────────────────

describe("the production instrument", () => {
  it("names no slot beyond the specimen's, and the views are not among them", () => {
    const slots = [...PRODUCTION_INSTRUMENT_TEMPLATE.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]);
    for (const s of slots) expect(Object.keys(SPECIMEN_SLOTS)).toContain(s);
    expect(PRODUCTION_INSTRUMENT_TEMPLATE).toContain("front, back, left, right, top, bottom, a 45° down view, and a 45° up view");
    expect(PRODUCTION_INSTRUMENT_TEMPLATE).toContain("You have\n8 views");
  });

  it("carries the evidence clause in the checklist block", () => {
    const text = buildEvaluationSystemPrompt(JUDGE_PROMPT_FIXTURES["production-full"]);
    expect(text).toContain("CRITICAL — evidence per item:");
    expect(text).toContain('"detail": "<view(s) checked>: <what was seen>"');
  });

  it("renders two specimens into prompts that differ only in the specimen slots", () => {
    // Render once with a marker per slot; each real prompt must be that
    // marker render with the markers replaced — nothing else may differ.
    const a = buildSpecimen(JUDGE_PROMPT_FIXTURES["production-full"]);
    const b = buildSpecimen({
      userPrompt: "A hinge with three knuckles", categoryName: "Hinges", complexity: 6,
      checklist: ["Are there three knuckles?"], constructionSpec: "- pin diameter 3 mm",
    });
    const markers = Object.fromEntries(Object.keys(SPECIMEN_SLOTS).map((k) => [k, `«${k}»`])) as Specimen;
    const skeleton = renderInstrument(PRODUCTION_INSTRUMENT_TEMPLATE, markers);
    const fill = (spec: Specimen) =>
      Object.entries(spec).reduce((text, [k, v]) => text.split(`«${k}»`).join(v), skeleton);
    expect(renderInstrument(PRODUCTION_INSTRUMENT_TEMPLATE, a)).toBe(fill(a));
    expect(renderInstrument(PRODUCTION_INSTRUMENT_TEMPLATE, b)).toBe(fill(b));
    expect(fill(a)).not.toBe(fill(b));
  });
});

// ── a variant replaces the instrument, the specimen still lands ──────

describe("buildEvaluationSystemPrompt with an instrument template", () => {
  const variant = [
    "You are a strict inspector. Default to fail unless a feature is clearly visible.",
    'Request: "{{user_prompt}}"',
    "Answer each item pass or fail:",
    "{{checklist_items}}",
    'Return JSON: {"score": 1-10, "issues": [], "suggestions": [], "checklist": [{"question","pass","detail"}]}',
  ].join("\n\n");

  it("uses the variant instead of the production instrument", () => {
    const text = buildEvaluationSystemPrompt({ ...JUDGE_PROMPT_FIXTURES["production-full"], instrumentTemplate: variant });
    expect(text).toContain("You are a strict inspector.");
    expect(text).not.toContain("You are a 3D model quality evaluator");
  });

  it("injects the example's specimen without the variant restating it", () => {
    const text = buildEvaluationSystemPrompt({ ...JUDGE_PROMPT_FIXTURES["production-full"], instrumentTemplate: variant });
    expect(text).toContain('Request: "A wall bracket with two "keyhole" slots and a 45° gusset"');
    expect(text).toContain("1. Does the bracket have two keyhole slots?\n2. Is the gusset at 45°?\n3. Are both mounting faces flat?");
  });

  it("drops blank checklist entries from the items slot as production does", () => {
    const text = buildEvaluationSystemPrompt({ ...JUDGE_PROMPT_FIXTURES["production-blank-items"], instrumentTemplate: variant });
    expect(text).toContain("Answer each item pass or fail:\n\n1. Is the gusset at 45°?\n\nReturn JSON");
  });
});
