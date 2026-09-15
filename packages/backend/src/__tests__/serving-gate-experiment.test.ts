/**
 * The VLM experiment executor under the serving gate (issue #72, ADR 0006).
 *
 * The experiment driver's output is an observation, not an assertion about the
 * corpus, so it is treated differently from the batch: what it already wrote
 * stays — the N=3/R=2 arm is exactly how #67 became evidence — but the run is
 * marked, and no pair may be drawn from a marked run by accident.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ServingSnapshot } from "../services/serving-provenance.service.js";

function snapshot(servingCount: number | null, maxInflight: number | null): ServingSnapshot {
  return { publishedName: "qwen3.8-27b-nvfp4", servingCount, maxInflight, source: "gateway", sampledAt: new Date() };
}

const { readings, prismaMock, evaluate } = vi.hoisted(() => ({
  readings: { queue: [] as Array<ServingSnapshot | null> },
  prismaMock: {
    experiment: { findMany: vi.fn(), update: vi.fn(async (_args: unknown) => ({})) },
    experimentRun: { update: vi.fn(async (_args: unknown) => ({})) },
    vlmExperimentResult: { findMany: vi.fn(async (_args: unknown) => []), create: vi.fn(async (_args: unknown) => ({})) },
    workbenchExample: { findUnique: vi.fn() },
  },
  evaluate: vi.fn(),
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/serving-provenance.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/serving-provenance.service.js")>()),
  readServingSnapshot: async () => readings.queue.length > 1 ? readings.queue.shift()! : readings.queue[0],
}));
vi.mock("../services/experiment-lock.service.js", () => ({
  acquireExperimentLock: () => new AbortController(),
  releaseExperimentLock: () => {},
  isExperimentRunning: () => false,
  cancelRunningExperiment: () => true,
}));
vi.mock("../services/llm-config.service.js", () => ({
  resolveModelConfigById: async () => ({
    id: "m1", label: "vllm-dgx-14/qwen3.8-27b-nvfp4",
    modelName: "qwen3.8-27b-nvfp4", endpointUrl: "http://192.168.44.14:4000/v1/", maxConcurrent: 8,
  }),
}));
vi.mock("../services/generation-settings.service.js", () => ({
  getVlmExperimentConcurrency: async () => 3,
}));
vi.mock("../services/visual-eval.service.js", () => ({
  evaluateModelWithConfig: (...a: unknown[]) => evaluate(...a),
}));
vi.mock("../services/visual-eval-zoom.service.js", () => ({ runZoomFollowUp: async () => null }));
vi.mock("../services/file-storage.service.js", () => ({
  readStorageFile: async () => Buffer.from("png"),
  storageFileExists: async () => false,
}));

const { recoverStuckVlmExperiments } = await import("../services/vlm-experiment-execution.service.js");

const EXAMPLE_IDS = ["ex1", "ex2", "ex3"];

function stuckExperiment() {
  return [{
    id: "exp1",
    runs: [{
      id: "run1", modelId: "m1", modelLabel: "qwen", runOrder: 1, status: "running",
      judgePromptVariantId: null as string | null, judgePromptTemplate: null as string | null,
      judgeResponseShape: null as string | null, judgeThinkingEffort: null as string | null,
      servingViolation: null as string | null, servingBackoffs: 0,
    }],
    vlmExampleSelections: EXAMPLE_IDS.map((exampleId, i) => ({ exampleId, selectionOrder: i })),
  }];
}

/** An example with its eight views inline, so nothing touches the filesystem. */
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

/** The `data` of every `update` a mock recorded, newest last. */
function updateData(fn: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return fn.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
}

const runUpdates = () => updateData(prismaMock.experimentRun.update);

beforeEach(() => {
  for (const model of Object.values(prismaMock)) for (const fn of Object.values(model)) fn.mockClear();
  prismaMock.experiment.findMany.mockResolvedValue(stuckExperiment());
  prismaMock.vlmExperimentResult.findMany.mockResolvedValue([]);
  prismaMock.workbenchExample.findUnique.mockResolvedValue(example());
  evaluate.mockReset();
  evaluate.mockResolvedValue({
    score: 8, issues: [], suggestions: [], checklistResults: [{ question: "q", answer: "yes" }],
    promptTokens: 10, completionTokens: 5, instrumentId: "production@abc", thinkingEffort: "off",
  });
});

describe("a VLM run under the gate", () => {
  it("runs at the replica count rather than the configured concurrency", async () => {
    // `global.vlm_experiment_concurrency` says 3; the pool has 2.
    readings.queue = [snapshot(2, 0)];

    await recoverStuckVlmExperiments();

    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(runUpdates().at(-1)).toMatchObject({ status: "completed", servingViolation: null });
  });

  it("halts and marks the run when a replica goes away mid-run", async () => {
    // Pre-flight and the first dispatch are clean; then spark-02 is OOM-killed.
    readings.queue = [snapshot(3, 0), snapshot(3, 0), snapshot(2, 1)];

    await recoverStuckVlmExperiments();

    // What was already evaluated stays — an experiment result is an
    // observation, and #67's marked arm is what made the case.
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(prismaMock.vlmExperimentResult.create).toHaveBeenCalledTimes(1);
    expect(runUpdates().at(-1)).toMatchObject({ status: "halted", servingViolation: "replica-lost" });
    expect(updateData(prismaMock.experiment.update).at(-1)).toMatchObject({ status: "halted" });
  });

  it("runs unclamped and unmarked when the judge has no gateway", async () => {
    // Sonnet on the Anthropic path: nothing to ask, nothing to gate on.
    readings.queue = [null];

    await recoverStuckVlmExperiments();

    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(runUpdates().at(-1)).toMatchObject({ status: "completed", servingViolation: null });
  });

  it("keeps the mark when an operator resumes a run that was halted before", async () => {
    // The halt stopped the next dispatch, but the calls in flight at the drop
    // completed and were written. Those results are still in the run, so a
    // clean second half does not make it a term in a pair again.
    const stuck = stuckExperiment();
    stuck[0].runs[0] = { ...stuck[0].runs[0], status: "halted", servingViolation: "replica-lost", servingBackoffs: 2 };
    prismaMock.experiment.findMany.mockResolvedValue(stuck);
    prismaMock.vlmExperimentResult.findMany.mockResolvedValue([{ exampleId: "ex1" }] as never);
    readings.queue = [snapshot(3, 0)];

    await recoverStuckVlmExperiments();

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(runUpdates().at(-1)).toMatchObject({
      status: "completed", servingViolation: "replica-lost", servingBackoffs: 2,
    });
  });
});
