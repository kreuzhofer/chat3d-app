/**
 * The qualified judges (ADR 0004): the (Judge, Instrument id) pairs that
 * have cleared the bar, kept in code beside the instrument and changed by
 * reviewed diff. Each entry is the judge exactly as production stamps it
 * (`provider/model_name` in `vlm_model`, the effective thinking effort in
 * `vlm_thinking_effort`) so the export filter can match rows to it.
 */
import { describe, it, expect } from "vitest";
import { QUALIFIED_JUDGES } from "../services/visual-eval-qualified-judges.js";

describe("QUALIFIED_JUDGES", () => {
  it("records qwen3.8-27b-nvfp4 (thinking off) under production@22e0f10b0505 — qualified on the 125 (#57), provisional until #63", () => {
    expect(QUALIFIED_JUDGES).toContainEqual(expect.objectContaining({
      model: "vllm-dgx-14/qwen3.8-27b-nvfp4",
      thinkingEffort: "off",
      instrumentId: "production@22e0f10b0505",
    }));
  });

  it("names every judge as stamped, under a well-formed instrument id, with its qualification run and adjudication sheet linked", () => {
    expect(QUALIFIED_JUDGES.length).toBeGreaterThan(0);
    for (const judge of QUALIFIED_JUDGES) {
      expect(judge.model).toMatch(/^[^\s/]+\/\S+$/);
      expect(judge.thinkingEffort).toMatch(/^(off|low|medium|high|max)$/);
      expect(judge.instrumentId).toMatch(/^[a-z0-9-]+@[0-9a-f]{12}$/);
      expect(judge.qualifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(judge.evidence.length).toBeGreaterThanOrEqual(2);
    }
  });
});
