/**
 * Instrument and specimen (issue #35).
 *
 * The judge's prompt is an INSTRUMENT (role, caveats, rubric, output shape —
 * what must hold still for two evaluations to be comparable) with the
 * SPECIMEN (the example's request, views, spec, checklist) injected through
 * named slots. Production's two instruments are templates like any other; an
 * experiment run may carry its own.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  renderInstrument,
  validateInstrumentTemplate,
  buildSpecimen,
  SPECIMEN_SLOTS,
} from "../services/visual-eval-instrument.service.js";
import {
  LEGACY_INSTRUMENT_TEMPLATE,
  EVAL_PLAN_INSTRUMENT_TEMPLATE,
} from "../services/visual-eval-instrument-templates.js";
import { buildEvaluationSystemPrompt } from "../services/visual-eval-prompt.service.js";
import { JUDGE_PROMPT_FIXTURES } from "./support/judge-prompt-fixtures.js";

const golden = (name: string): string =>
  readFileSync(new URL(`./support/judge-prompt-goldens/${name}.txt`, import.meta.url), "utf8");

const emptySpecimen = () =>
  Object.fromEntries(Object.keys(SPECIMEN_SLOTS).map((k) => [k, ""])) as ReturnType<typeof buildSpecimen>;

// ── renderInstrument ─────────────────────────────────────────────────

describe("renderInstrument", () => {
  it("substitutes slots in place", () => {
    const s = { ...emptySpecimen(), user_prompt: "a bracket", view_count: "3" };
    expect(renderInstrument('Request: "{{user_prompt}}" seen in {{view_count}} views.', s))
      .toBe('Request: "a bracket" seen in 3 views.');
  });

  it("drops a paragraph that is exactly one slot when that slot is empty, and keeps it otherwise", () => {
    const tpl = "{{model_preamble}}\n\nRole line.\n\n{{construction_spec_block}}\n\n{{checklist_block}}";
    expect(renderInstrument(tpl, { ...emptySpecimen(), checklist_block: "1. q" })).toBe("Role line.\n\n1. q");
    expect(renderInstrument(tpl, { ...emptySpecimen(), model_preamble: "PRE", checklist_block: "1. q" }))
      .toBe("PRE\n\nRole line.\n\n1. q");
  });

  it("does not drop a paragraph that mixes a slot with other text, even when the slot is empty", () => {
    expect(renderInstrument("Spec: {{construction_spec}}", emptySpecimen())).toBe("Spec: ");
  });

  it("preserves blank lines inside a substituted value", () => {
    const s = { ...emptySpecimen(), eval_plan: "First.\n\nSecond." };
    expect(renderInstrument("A\n\n{{eval_plan}}\n\nB", s)).toBe("A\n\nFirst.\n\nSecond.\n\nB");
  });

  it("refuses an unknown slot instead of leaving it in the prompt", () => {
    expect(() => renderInstrument("Hi {{nope}}", emptySpecimen())).toThrow(/nope/);
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

  it("rejects unknown and malformed slot tokens", () => {
    expect(validateInstrumentTemplate(`${ok} {{foo}}`).join(" ")).toMatch(/foo/);
    expect(validateInstrumentTemplate(`${ok} {{ user_prompt }}`).join(" ")).toMatch(/user_prompt/);
  });

  it("rejects an empty template", () => {
    expect(validateInstrumentTemplate("   ").length).toBeGreaterThan(0);
  });

  it("accepts both production instruments", () => {
    expect(validateInstrumentTemplate(LEGACY_INSTRUMENT_TEMPLATE)).toEqual([]);
    expect(validateInstrumentTemplate(EVAL_PLAN_INSTRUMENT_TEMPLATE)).toEqual([]);
  });
});

// ── production instruments are ordinary templates ────────────────────

describe("production instruments as templates", () => {
  for (const [name, opts] of Object.entries(JUDGE_PROMPT_FIXTURES)) {
    const template = name.startsWith("dynamic") ? EVAL_PLAN_INSTRUMENT_TEMPLATE : LEGACY_INSTRUMENT_TEMPLATE;
    it(`renders ${name} byte for byte through renderInstrument`, () => {
      expect(renderInstrument(template, buildSpecimen(opts))).toBe(golden(name));
    });
  }
});

// ── a variant replaces the instrument, the specimen still lands ──────

describe("buildEvaluationSystemPrompt with an instrument template", () => {
  const variant = [
    "You are a strict inspector. Default to fail unless a feature is clearly visible.",
    'Request: "{{user_prompt}}"',
    "{{view_description}}",
    "Answer each item pass or fail:",
    "{{checklist_items}}",
    'Return JSON: {"score": 1-10, "issues": [], "suggestions": [], "checklist": [{"question","pass","detail"}]}',
  ].join("\n\n");

  it("uses the variant instead of either production instrument, whatever the eval plan says", () => {
    for (const name of ["legacy-full", "dynamic-full"]) {
      const text = buildEvaluationSystemPrompt({ ...JUDGE_PROMPT_FIXTURES[name], instrumentTemplate: variant });
      expect(text).toContain("You are a strict inspector.");
      expect(text).not.toContain("You are a 3D model quality evaluator");
      expect(text).not.toContain("Inspect the long leg"); // the eval plan is not injected unless the variant asks
    }
  });

  it("injects the example's specimen without the variant restating it", () => {
    const text = buildEvaluationSystemPrompt({ ...JUDGE_PROMPT_FIXTURES["legacy-full"], instrumentTemplate: variant });
    expect(text).toContain('Request: "A wall bracket with two "keyhole" slots and a 45° gusset"');
    expect(text).toContain("You are provided 3 labeled views: front, top, a 45° down view.");
    expect(text).toContain("1. Does the bracket have two keyhole slots?\n2. Is the gusset at 45°?\n3. Are both mounting faces flat?");
  });

  it("leaves the per-model preamble out unless the variant has a slot for it", () => {
    const text = buildEvaluationSystemPrompt({ ...JUDGE_PROMPT_FIXTURES["legacy-full"], instrumentTemplate: variant });
    expect(text).not.toContain("You are calibrated to be strict");
    const withPreamble = buildEvaluationSystemPrompt({
      ...JUDGE_PROMPT_FIXTURES["legacy-full"], instrumentTemplate: `{{model_preamble}}\n\n${variant}`,
    });
    expect(withPreamble.startsWith("You are calibrated to be strict about missing features.\n\nYou are a strict inspector.")).toBe(true);
  });

  it("drops blank checklist entries from the items slot as production does", () => {
    const text = buildEvaluationSystemPrompt({ ...JUDGE_PROMPT_FIXTURES["legacy-blank-items"], instrumentTemplate: variant });
    expect(text).toContain("Answer each item pass or fail:\n\n1. Is the gusset at 45°?\n\nReturn JSON");
  });
});
