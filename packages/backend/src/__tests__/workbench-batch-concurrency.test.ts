/**
 * The re-evaluation batch keeps a bounded number of rows in flight (#63).
 *
 * The stale re-rating batch and the category re-evaluation share one loop.
 * One at a time is the default; a batch started with a concurrency above 1
 * keeps that many rows in flight, one judge call per pooled replica, and
 * stops pulling new rows when cancelled while the in-flight ones finish.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { reEvaluateExample } = vi.hoisted(() => ({ reEvaluateExample: vi.fn() }));
vi.mock("../services/workbench-reeval.service.js", () => ({ reEvaluateExample: (...a: unknown[]) => reEvaluateExample(...a) }));
vi.mock("../services/workbench-codegen.service.js", () => ({ generateForPrompt: vi.fn(), reRenderForExample: vi.fn() }));
vi.mock("../services/workbench-embeddings.service.js", () => ({ embedAndStorePrompt: vi.fn() }));
vi.mock("../services/workbench-examples.service.js", () => ({ cleanupExamplesForPrompt: vi.fn() }));
vi.mock("../services/sse.service.js", () => ({ sseService: { publish: vi.fn(), publishToUser: vi.fn() } }));

import { runBatchReEvaluate, type BatchJob } from "../services/workbench-batch.service.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 5));
const ok = (exampleId: string) => ({ exampleId, evalScore: 8, visualScore: 8, codeEvalScore: 8, assertionPassRate: null, approvalStatus: "auto_approved", source: "vlm" });

function job(): BatchJob {
  return {
    jobId: "batch-re-rate-stale-1", type: "batch-re-rate-stale", categoryId: "*", categoryName: "Stale ratings (all categories)",
    status: "running", total: 0, completed: 0, failed: 0, skipped: 0, currentPromptId: null, currentPromptText: null,
    exampleId: null, results: [], error: null, createdAt: new Date().toISOString(), finishedAt: null,
    pendingPromptIds: new Set(), userId: null, abortController: new AbortController(),
  };
}
const examples = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `ex${i}`, promptId: `p${i}`, promptRef: { prompt: `prompt ${i}` } }));

beforeEach(() => reEvaluateExample.mockReset());

describe("runBatchReEvaluate", () => {
  it("keeps at most `concurrency` rows in flight and completes every row", async () => {
    let inFlight = 0, peak = 0;
    reEvaluateExample.mockImplementation(async (id: string) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
      return ok(id);
    });
    const j = job();
    await runBatchReEvaluate(j, examples(7), 3);
    expect(peak).toBe(3);
    expect(j.completed).toBe(7);
    expect(j.failed).toBe(0);
    expect(j.status).toBe("completed");
    expect(j.finishedAt).not.toBeNull();
    expect(j.results.map((r) => r.exampleId).sort()).toEqual(examples(7).map((e) => e.id).sort());
  });

  it("runs one row at a time by default", async () => {
    let inFlight = 0, peak = 0;
    reEvaluateExample.mockImplementation(async (id: string) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
      return ok(id);
    });
    const j = job();
    await runBatchReEvaluate(j, examples(3));
    expect(peak).toBe(1);
    expect(j.completed).toBe(3);
  });

  it("records a failed row and goes on with the rest", async () => {
    reEvaluateExample.mockImplementation(async (id: string) => {
      await tick();
      if (id === "ex1") throw new Error("judge unreachable");
      return ok(id);
    });
    const j = job();
    await runBatchReEvaluate(j, examples(3), 2);
    expect(j.completed).toBe(2);
    expect(j.failed).toBe(1);
    expect(j.results.find((r) => r.status === "error")?.error).toBe("judge unreachable");
    expect(j.status).toBe("completed");
  });

  it("stops pulling rows once cancelled, letting the in-flight ones finish", async () => {
    const j = job();
    reEvaluateExample.mockImplementation(async (id: string) => {
      await tick();
      if (id === "ex1") { j.status = "cancelled"; j.abortController.abort(); }
      return ok(id);
    });
    await runBatchReEvaluate(j, examples(8), 2);
    expect(j.status).toBe("cancelled");
    expect(j.completed).toBeGreaterThanOrEqual(2);
    expect(j.completed).toBeLessThan(8);
    expect(j.finishedAt).not.toBeNull();
  });
});
