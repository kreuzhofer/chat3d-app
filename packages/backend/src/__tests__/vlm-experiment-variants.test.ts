/**
 * Judge-prompt variants on VLM experiment runs (issue #35).
 *
 * A run carries exactly one instrument; comparing two instruments means two
 * runs over the same examples. Without variants an experiment is one run per
 * model under production's instrument, exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const streamCalls: Array<Record<string, unknown>> = [];
vi.mock("../services/tracked-llm.service.js", () => ({
  trackedStreamText: vi.fn((options: Record<string, unknown>) => {
    streamCalls.push(options);
    async function* parts() {
      yield { type: "text-delta", text: '{"score": 7, "issues": [], "suggestions": [], "checklist": [{"question": "Is the gusset at 45°?", "pass": true, "detail": ""}]}' };
    }
    return { fullStream: parts(), usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }), finishReason: Promise.resolve("stop") };
  }),
}));
vi.mock("../services/llm-config.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/llm-config.service.js")>();
  return { ...actual, createProviderModel: vi.fn(() => ({ modelId: "fake" })) };
});
vi.mock("../services/generation-settings.service.js", () => ({
  getZoomSettings: vi.fn(async () => ({ enabled: true, resolutionPx: 1536, maxFollowUps: 3 })),
}));

import { planVlmRuns, validateJudgePromptVariants } from "../services/vlm-experiment-create.service.js";
import { evaluateModelWithConfig } from "../services/visual-eval.service.js";
import { ExperimentError } from "../services/experiment.service.js";
import { STANDARD_VIEWS } from "../services/visual-eval-views.js";
import type { LlmModelConfig } from "../services/llm-config.service.js";

const models = [
  { id: "m-glm", displayName: "glm-5.3-flash (thinking off)", provider: "vllm-dgx-14", modelName: "glm-5.3-flash" },
  { id: "m-sonnet", displayName: null, provider: "anthropic", modelName: "claude-sonnet-4-6" },
];
const tplA = 'Instrument A.\n\n"{{user_prompt}}"\n\n{{checklist_block}}';
const tplB = 'Instrument B — default to fail.\n\n"{{user_prompt}}"\n\n{{checklist_items}}';

describe("planVlmRuns", () => {
  it("without variants plans one run per model under production's instrument, as before", () => {
    const runs = planVlmRuns(models, undefined);
    expect(runs).toEqual([
      { modelId: "m-glm", modelLabel: "glm-5.3-flash (thinking off)", runOrder: 1, judgePromptVariantId: null, judgePromptTemplate: null },
      { modelId: "m-sonnet", modelLabel: "anthropic/claude-sonnet-4-6", runOrder: 2, judgePromptVariantId: null, judgePromptTemplate: null },
    ]);
  });

  it("with variants plans one run per model and variant, model-major, each carrying exactly one instrument", () => {
    const runs = planVlmRuns(models, [{ id: "a", template: tplA }, { id: "b", template: tplB }]);
    expect(runs.map((r) => [r.modelId, r.judgePromptVariantId, r.runOrder])).toEqual([
      ["m-glm", "a", 1], ["m-glm", "b", 2], ["m-sonnet", "a", 3], ["m-sonnet", "b", 4],
    ]);
    expect(runs[1].judgePromptTemplate).toBe(tplB);
    expect(runs[1].modelLabel).toBe("glm-5.3-flash (thinking off)");
  });
});

describe("validateJudgePromptVariants", () => {
  const reject = (variants: Array<{ id: string; template: string }>, re: RegExp) => {
    try { validateJudgePromptVariants(variants); }
    catch (err) {
      expect(err).toBeInstanceOf(ExperimentError);
      expect((err as ExperimentError).statusCode).toBe(400);
      expect((err as Error).message).toMatch(re);
      return;
    }
    throw new Error("expected rejection");
  };

  it("accepts distinct, well-formed variants", () => {
    expect(() => validateJudgePromptVariants([{ id: "v2.fail-default_1", template: tplA }])).not.toThrow();
  });
  it("rejects an empty list — omit the field for production's instrument", () => reject([], /at least one/i));
  it("rejects duplicate ids", () => reject([{ id: "a", template: tplA }, { id: "a", template: tplB }], /duplicate.*"a"/i));
  it("rejects ids that would not survive as a grouping key", () => {
    reject([{ id: "has space", template: tplA }], /id/i);
    reject([{ id: "x".repeat(65), template: tplA }], /id/i);
    reject([{ id: "", template: tplA }], /id/i);
  });
  it("rejects a template that fails instrument validation, naming the variant", () => {
    reject([{ id: "nospec", template: "No slots at all." }], /"nospec".*user_prompt/is);
    reject([{ id: "typo", template: `${tplA} {{checklst}}` }], /"typo".*checklst/is);
  });
});

describe("two runs over one example set with different variants", () => {
  const cfg: LlmModelConfig = {
    id: "m1", provider: "anthropic", providerType: null, modelName: "claude-sonnet-4-6", displayName: "Sonnet",
    label: "anthropic/claude-sonnet-4-6", costPer1mInput: 0, costPer1mOutput: 0, maxOutputTokens: null,
    maxContextTokens: null, supportsThinking: true, thinkingEffort: "off", supportsVision: true,
    supportsEmbeddings: false, streamingEnabled: true, vlmEvalPreamble: "PREAMBLE", endpointUrl: null, apiKey: "k", maxConcurrent: null,
  };
  const input = {
    userPrompt: "a bracket", categoryName: "Brackets", complexity: 4,
    images: STANDARD_VIEWS.map((angle) => ({ angle, base64: "AAA" })), verificationChecklist: ["Is the gusset at 45°?"],
  };
  beforeEach(() => { streamCalls.length = 0; });

  it("send different judge prompts, each carrying the same specimen, and record what they sent under the variant's id", async () => {
    const runs = planVlmRuns([models[1]], [{ id: "a", template: tplA }, { id: "b", template: tplB }]);
    const results = [];
    for (const run of runs) {
      results.push(await evaluateModelWithConfig({
        ...input, instrument: { name: run.judgePromptVariantId!, template: run.judgePromptTemplate! },
      }, cfg));
    }
    expect(runs.map((r) => r.judgePromptVariantId)).toEqual(["a", "b"]);
    const sent = streamCalls.map((c) => c.system as string);
    expect(sent[0]).not.toBe(sent[1]);
    expect(sent[0]).toContain("Instrument A.");
    expect(sent[1]).toContain("Instrument B — default to fail.");
    for (const s of sent) {
      expect(s).toContain('"a bracket"');
      expect(s).toContain("1. Is the gusset at 45°?");
      expect(s).not.toContain("PREAMBLE");
    }
    expect(results.map((r) => r.systemPrompt)).toEqual(sent);
    expect(results[0].instrumentId).toMatch(/^a@[0-9a-f]{12}$/);
    expect(results[1].instrumentId).toMatch(/^b@[0-9a-f]{12}$/);
    expect(results[0].instrumentId).not.toBe(results[1].instrumentId);
  });

  it("without an instrument the judge sees production's, stamped as production — no per-model preamble (ADR 0003)", async () => {
    const result = await evaluateModelWithConfig(input, cfg);
    const s = streamCalls[0].system as string;
    expect(s.startsWith("You are a 3D model quality evaluator")).toBe(true);
    expect(s).not.toContain("PREAMBLE");
    expect(s).toContain("Category: Brackets (complexity level 4/10)");
    expect(result.instrumentId).toMatch(/^production@[0-9a-f]{12}$/);
    expect(result.thinkingEffort).toBe("off");
  });
});
