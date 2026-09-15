/**
 * The VLM experiment executor runs its judge at thinking off unless the run
 * asks otherwise (issue #99).
 *
 * The experiment path resolves its judge from a model row, never from the
 * `vlm_eval` purpose, so before this the row's `default_thinking_effort`
 * silently decided what an experiment measured — and under ADR 0004 a
 * different thinking setting is a different judge. The effort is now the
 * run's own, explicit, and "off" when nobody asked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LlmModelConfig } from "../services/llm-config.service.js";

const { prismaMock, evaluate, judgeRow } = vi.hoisted(() => ({
  prismaMock: {
    experiment: { findMany: vi.fn(), update: vi.fn(async (_args: unknown) => ({})) },
    experimentRun: { update: vi.fn(async (_args: unknown) => ({})) },
    vlmExperimentResult: { findMany: vi.fn(async (_args: unknown) => []), create: vi.fn(async (_args: unknown) => ({})) },
    workbenchExample: { findUnique: vi.fn() },
  },
  evaluate: vi.fn(),
  /** A thinking-on model row: the twin of the qualified judge nobody qualified. */
  judgeRow: {
    id: "m1", provider: "vllm-dgx-14", providerType: "openai-compatible",
    modelName: "qwen3.8-27b-nvfp4", displayName: "qwen3.8-27b-nvfp4 (3-node pool)", label: "vllm-dgx-14/qwen3.8-27b-nvfp4",
    costPer1mInput: 0, costPer1mOutput: 0, maxOutputTokens: 32768, maxContextTokens: 131072,
    supportsThinking: true, thinkingEffort: "medium", supportsVision: true, supportsEmbeddings: false,
    streamingEnabled: true, vlmEvalPreamble: null, endpointUrl: "http://192.168.44.14:4000/v1/", apiKey: null, maxConcurrent: 8,
  } satisfies LlmModelConfig,
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/serving-provenance.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/serving-provenance.service.js")>()),
  readServingSnapshot: async () => null,
}));
vi.mock("../services/experiment-lock.service.js", () => ({
  acquireExperimentLock: () => new AbortController(),
  releaseExperimentLock: () => {},
  isExperimentRunning: () => false,
  cancelRunningExperiment: () => true,
}));
vi.mock("../services/llm-config.service.js", () => ({ resolveModelConfigById: async () => ({ ...judgeRow }) }));
vi.mock("../services/generation-settings.service.js", () => ({ getVlmExperimentConcurrency: async () => 1 }));
vi.mock("../services/visual-eval.service.js", () => ({ evaluateModelWithConfig: (...a: unknown[]) => evaluate(...a) }));
vi.mock("../services/visual-eval-zoom.service.js", () => ({ runZoomFollowUp: async () => null }));
vi.mock("../services/file-storage.service.js", () => ({
  readStorageFile: async () => Buffer.from("png"),
  storageFileExists: async () => false,
}));

const { recoverStuckVlmExperiments } = await import("../services/vlm-experiment-execution.service.js");

function experimentWithRun(judgeThinkingEffort: string | null) {
  return [{
    id: "exp1",
    runs: [{
      id: "run1", modelId: "m1", modelLabel: "qwen", runOrder: 1, status: "running",
      judgePromptVariantId: null, judgePromptTemplate: null, judgeResponseShape: null,
      judgeThinkingEffort, servingViolation: null, servingBackoffs: 0,
    }],
    vlmExampleSelections: [{ exampleId: "ex1", selectionOrder: 0 }],
  }];
}

function example() {
  const view = "data:image/png;base64,aGk=";
  return {
    id: "ex1", stlPath: null,
    screenshotFront: view, screenshotBack: view, screenshotLeft: view, screenshotRight: view,
    screenshotTop: view, screenshotBottom: view, screenshotOrtho45: view, screenshotOrtho45Bottom: view,
    promptRef: {
      prompt: "a bracket", constructionSpec: null, verificationChecklist: ["is it a bracket?"],
      verificationCriteria: null, category: { name: "Brackets", complexity: 3 },
    },
  };
}

/** The config the judge was actually called with. */
const judgeConfig = () => evaluate.mock.calls[0]![1] as LlmModelConfig;

beforeEach(() => {
  for (const model of Object.values(prismaMock)) for (const fn of Object.values(model)) fn.mockClear();
  prismaMock.vlmExperimentResult.findMany.mockResolvedValue([]);
  prismaMock.workbenchExample.findUnique.mockResolvedValue(example());
  evaluate.mockReset();
  evaluate.mockImplementation(async (_input: unknown, cfg: LlmModelConfig) => ({
    score: 8, issues: [], suggestions: [], checklistResults: [{ question: "q", answer: "yes" }],
    promptTokens: 10, completionTokens: 5, instrumentId: "production@abc", thinkingEffort: cfg.thinkingEffort,
  }));
});

describe("a VLM experiment pointed at a thinking-on model row", () => {
  it("judges at thinking off when the run asks for nothing — the row's default is not consulted", async () => {
    prismaMock.experiment.findMany.mockResolvedValue(experimentWithRun(null));
    await recoverStuckVlmExperiments();
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(judgeConfig().thinkingEffort).toBe("off");
    // What was stamped on the row is what ran.
    const stored = prismaMock.vlmExperimentResult.create.mock.calls[0]![0] as { data: { thinkingEffort: string | null } };
    expect(stored.data.thinkingEffort).toBe("off");
  });

  it("judges at the effort the run explicitly carries", async () => {
    prismaMock.experiment.findMany.mockResolvedValue(experimentWithRun("medium"));
    await recoverStuckVlmExperiments();
    expect(judgeConfig().thinkingEffort).toBe("medium");
  });
});
