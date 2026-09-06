/**
 * The experiment executor runs production's zoom follow-up (issue #54).
 *
 * Until now the executor scored judges without the tool production uses to
 * resolve "uncertain", so every comparison penalised exactly the judges that
 * say uncertain most. These tests pin the wiring: the follow-up runs behind
 * the same settings, is answered by the judge under test, and merges back
 * into the stored result the way eval-orchestrator merges it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const runZoomFollowUp = vi.fn();
vi.mock("../services/visual-eval-zoom.service.js", async (orig) => ({
  ...(await orig<typeof import("../services/visual-eval-zoom.service.js")>()),
  runZoomFollowUp: (...args: unknown[]) => runZoomFollowUp(...args),
}));

import { applyZoomFollowUp, buildExperimentEvalInput } from "../services/vlm-experiment-execution.service.js";
import type { EvaluationResult, EvaluateModelInput } from "../services/visual-eval.service.js";
import type { LlmModelConfig } from "../services/llm-config.service.js";

const judge: LlmModelConfig = {
  id: "judge-under-test", provider: "vllm-dgx-14", providerType: "openai-compatible",
  modelName: "glm-5.3-flash", displayName: "glm", label: "vllm-dgx-14/glm-5.3-flash",
  costPer1mInput: 0, costPer1mOutput: 0, maxOutputTokens: null, maxContextTokens: null,
  supportsThinking: true, thinkingEffort: "off", supportsVision: true, supportsEmbeddings: false,
  streamingEnabled: true, vlmEvalPreamble: null, endpointUrl: "http://vllm.local/v1", apiKey: null,
  maxConcurrent: null,
};

const images = [{ angle: "front", base64: "AAA" }];
const example = {
  promptRef: {
    prompt: "a bracket", constructionSpec: "spec text",
    verificationChecklist: null, verificationCriteria: null, evalPlan: null,
    category: { name: "Hinges", complexity: 3 },
  },
};

const uncertainChecklist = [
  { question: "Does it have two arms?", pass: true, detail: "yes" },
  { question: "Is the top hole open?", pass: null, detail: "cannot resolve" },
];

function result(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    score: 7, issues: [], suggestions: [], vlmModel: "glm",
    instrumentId: "production@0123456789ab", thinkingEffort: "off",
    promptTokens: 100, completionTokens: 40,
    checklistResults: uncertainChecklist, rawResponse: "{raw}", systemPrompt: "sys",
    ...overrides,
  };
}

function input(overrides: Partial<EvaluateModelInput> = {}): EvaluateModelInput {
  return {
    userPrompt: "a bracket", categoryName: "Hinges", complexity: 3, images,
    constructionSpec: "spec text", stlBase64: "U1RM", modelFormat: "stl",
    ...overrides,
  };
}

beforeEach(() => { runZoomFollowUp.mockReset(); });

describe("buildExperimentEvalInput", () => {
  it("carries the example's STL so the follow-up can render it, as production does", () => {
    const built = buildExperimentEvalInput(example, images, "U1RM");
    expect(built.stlBase64).toBe("U1RM");
    expect(built.modelFormat).toBe("stl");
  });

  it("leaves the STL fields unset when the example has no STL", () => {
    const built = buildExperimentEvalInput(example, images);
    expect(built.stlBase64).toBeUndefined();
    expect(built.modelFormat).toBeUndefined();
  });
});

describe("applyZoomFollowUp", () => {
  it("does nothing when no item is uncertain", async () => {
    const r = result({ checklistResults: [{ question: "q", pass: true, detail: "" }] });
    expect(await applyZoomFollowUp(r, input(), judge)).toBe(r);
    expect(runZoomFollowUp).not.toHaveBeenCalled();
  });

  it("does nothing when the judge returned no checklist", async () => {
    const r = result({ checklistResults: undefined });
    expect(await applyZoomFollowUp(r, input(), judge)).toBe(r);
    expect(runZoomFollowUp).not.toHaveBeenCalled();
  });

  it("runs the follow-up with the judge under test and the example's STL, then merges like production", async () => {
    const resolved = [
      uncertainChecklist[0],
      { question: "Is the top hole open?", pass: true, detail: "[2x zoom] open" },
    ];
    runZoomFollowUp.mockResolvedValue({
      resolvedChecklist: resolved, followUpCount: 1,
      followUpDetails: [{ question: "Is the top hole open?", angle: "top", pass: true, detail: "open" }],
      promptTokens: 22, completionTokens: 6,
    });

    const merged = await applyZoomFollowUp(result(), input(), judge);

    expect(runZoomFollowUp).toHaveBeenCalledTimes(1);
    expect(runZoomFollowUp.mock.calls[0][0]).toMatchObject({
      checklist: uncertainChecklist, stlBase64: "U1RM", modelFormat: "stl",
      constructionSpec: "spec text", vlmConfig: judge,
    });
    expect(merged.checklistResults).toEqual(resolved);
    expect(merged.promptTokens).toBe(122);
    expect(merged.completionTokens).toBe(46);
    // The score and the judge's raw answer are the first pass, untouched — as in production.
    expect(merged.score).toBe(7);
    expect(merged.rawResponse).toBe("{raw}");
  });

  it("keeps the judge's answer as is when the follow-up is disabled", async () => {
    runZoomFollowUp.mockResolvedValue(null);
    const r = result();
    expect(await applyZoomFollowUp(r, input(), judge)).toBe(r);
  });

  it("keeps the uncertain items when the example has no STL to zoom into", async () => {
    const r = result();
    expect(await applyZoomFollowUp(r, input({ stlBase64: undefined }), judge)).toBe(r);
    expect(runZoomFollowUp).not.toHaveBeenCalled();
  });

  it("keeps the uncertain items when the follow-up fails, as production does", async () => {
    runZoomFollowUp.mockRejectedValue(new Error("render service down"));
    const r = result();
    expect(await applyZoomFollowUp(r, input(), judge)).toBe(r);
  });
});
