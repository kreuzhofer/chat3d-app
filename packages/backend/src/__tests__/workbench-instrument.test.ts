/**
 * Stale ratings and the re-rating batch (ADR 0003).
 *
 * A rating is Stale when its Instrument id is not the current one, the rows
 * rated before ids existed included. The batch re-rates only rows the judge
 * can be re-run on (the eight views stored) and whose verdict the judge
 * derived; it never overturns a human's decision.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const CURRENT = "production@0123456789ab";
const { count, findMany, runBatchReEvaluate, jobs } = vi.hoisted(() => ({
  count: vi.fn(), findMany: vi.fn(), runBatchReEvaluate: vi.fn(async (..._args: unknown[]) => {}), jobs: new Map(),
}));
vi.mock("../db/prisma.js", () => ({ prisma: { workbenchExample: { count: (...a: unknown[]) => count(...a), findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("../services/visual-eval-instrument-id.service.js", () => ({ currentInstrumentId: vi.fn(async () => "production@0123456789ab") }));
vi.mock("../services/visual-eval-qualified-judges.js", () => ({
  QUALIFIED_JUDGES: [{ model: "vllm-x/qwen", thinkingEffort: "off", instrumentId: "production@0123456789ab", qualifiedOn: "2026-09-06", evidence: ["run", "sheet"] }],
}));
vi.mock("../services/llm-config.service.js", () => ({
  getModelForPurpose: vi.fn(async () => ({ endpointUrl: "http://192.168.44.14:4000/v1/", modelName: "qwen3.8-27b-nvfp4", label: "vllm-dgx-14/qwen3.8-27b-nvfp4" })),
}));
vi.mock("../services/workbench-batch.service.js", () => ({
  jobs,
  generateJobId: (t: string) => `${t}-1`,
  toSummary: (j: Record<string, unknown>) => ({ jobId: j.jobId, type: j.type, total: j.total, status: j.status, concurrency: j.concurrency }),
  runBatchReEvaluate: (...a: unknown[]) => runBatchReEvaluate(...a),
}));

import { staleRatingWhere, getInstrumentStatus, startBatchReRateStale } from "../services/workbench-instrument.service.js";
import { resetServingSnapshotCache } from "../services/serving-provenance.service.js";

/** The judge's pool as the gateway reports it, with `serving` replicas up. */
function pool(serving: number, inflight = 0) {
  return {
    pools: [{
      publishedName: "qwen3.8-27b-nvfp4",
      servingCount: serving,
      members: Array.from({ length: serving }, (_, i) => ({ node: `dgx-spark-0${i + 2}`, inflight, serving: true })),
    }],
  };
}

function servePool(serving: number, inflight = 0) {
  resetServingSnapshotCache();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => pool(serving, inflight) }));
}

beforeEach(() => {
  count.mockReset(); findMany.mockReset(); runBatchReEvaluate.mockReset(); jobs.clear();
  servePool(3);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("staleRatingWhere", () => {
  it("selects rated production rows under another id or under none", () => {
    expect(staleRatingWhere(CURRENT)).toEqual({
      renderStatus: "success", experimentRunId: null, visualScore: { not: null },
      OR: [{ vlmInstrumentId: null }, { vlmInstrumentId: { not: CURRENT } }, { ratingItemsStale: true }],
    });
  });
});

describe("getInstrumentStatus", () => {
  it("reports the current id and the stale, approved-stale, unratable and human-decided counts, and the export's admission", async () => {
    count.mockResolvedValueOnce(2618).mockResolvedValueOnce(0).mockResolvedValueOnce(2618)
      .mockResolvedValueOnce(2305).mockResolvedValueOnce(2600).mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2309).mockResolvedValueOnce(0).mockResolvedValueOnce(2308)
      .mockResolvedValueOnce(25).mockResolvedValueOnce(116).mockResolvedValueOnce(1);
    const status = await getInstrumentStatus();
    expect(status).toEqual({
      instrumentId: CURRENT, rated: 2618, current: 0, stale: 2618, staleApproved: 2305, unratable: 18, staleHumanDecided: 4,
      export: { qualifiedJudges: [{ model: "vllm-x/qwen", thinkingEffort: "off" }], approved: 2309, admitted: 0, provisional: 1, stale: 2308 },
      // Rows the pipeline rejected before the judge (issue #68): pending, never rated, no id — outside every count above.
      rejectedBeforeJudge: { total: 142, assertionsFailed: 25, codeReviewRejected: 116, unexplained: 1 },
    });
    // the reason split reads the row's own stored outcome, never the batch's log
    expect(count.mock.calls[9][0].where).toMatchObject({ renderStatus: "success", experimentRunId: null, visualScore: null, vlmInstrumentId: null, approvalStatus: "pending", assertionPassRate: { lt: 1 } });
    expect(count.mock.calls[10][0].where).toMatchObject({ codeEvalScore: { lte: 3 } });
    expect(count.mock.calls[1][0]).toEqual({ where: { renderStatus: "success", experimentRunId: null, visualScore: { not: null }, vlmInstrumentId: CURRENT } });
    expect(count.mock.calls[5][0].where.approvalStatus).toEqual({ notIn: ["auto_approved", "pending"] });
    expect(count.mock.calls[7][0].where.OR).toEqual([
      { approvalStatus: "human_approved" },
      { approvalStatus: "auto_approved", vlmInstrumentId: CURRENT, OR: [{ vlmModel: "vllm-x/qwen", vlmThinkingEffort: "off" }] },
    ]);
  });
});

describe("startBatchReRateStale", () => {
  const row = { id: "ex1", promptId: "p1", promptRef: { prompt: "a bracket" } };

  it("selects stale rows with all eight views and a judge-derived verdict, oldest first, up to the limit", async () => {
    findMany.mockResolvedValue([row]);
    const summary = await startBatchReRateStale({ limit: 40, categoryId: "cat1" });
    const args = findMany.mock.calls[0][0];
    expect(args.where.OR).toEqual([{ vlmInstrumentId: null }, { vlmInstrumentId: { not: CURRENT } }, { ratingItemsStale: true }]);
    for (const f of ["screenshotFront", "screenshotBack", "screenshotLeft", "screenshotRight", "screenshotTop", "screenshotBottom", "screenshotOrtho45", "screenshotOrtho45Bottom"]) {
      expect(args.where[f]).toEqual({ not: null });
    }
    expect(args.where.approvalStatus).toEqual({ in: ["auto_approved", "pending"] });
    expect(args.where.promptRef).toEqual({ categoryId: "cat1" });
    expect(args.take).toBe(40);
    expect(args.orderBy[0]).toEqual({ updatedAt: "asc" });
    expect(summary).toMatchObject({ jobId: "batch-re-rate-stale-1", type: "batch-re-rate-stale", total: 1, status: "running", concurrency: 1 });
    expect(runBatchReEvaluate).toHaveBeenCalledWith(expect.objectContaining({ jobId: "batch-re-rate-stale-1" }), [row], 1, expect.anything());
  });

  it("re-rates the given rows by id whatever their rating state — the rows a dead gateway voided (#87)", async () => {
    findMany.mockResolvedValue([row]);
    const summary = await startBatchReRateStale({ exampleIds: ["a", "b"], concurrency: 3 });
    const args = findMany.mock.calls[0][0];
    expect(args.where.id).toEqual({ in: ["a", "b"] });
    expect(args.where.OR).toBeUndefined();          // not the Stale frame: an unrated row has no id to be stale under
    expect(args.where.visualScore).toBeUndefined();
    expect(args.where.renderStatus).toBe("success");
    expect(args.where.experimentRunId).toBeNull();
    expect(args.where.screenshotOrtho45Bottom).toEqual({ not: null });
    expect(args.where.approvalStatus).toEqual({ in: ["auto_approved", "pending"] });
    expect(summary).toMatchObject({ total: 1, status: "running", concurrency: 3 });
  });

  it("refuses when none of the given rows can be re-rated", async () => {
    findMany.mockResolvedValue([]);
    await expect(startBatchReRateStale({ exampleIds: ["nope"] })).rejects.toThrow(/none of the given rows/i);
  });

  it("runs one row at a time unless told otherwise, and clamps the concurrency to the pool's range", async () => {
    findMany.mockResolvedValue([row]);
    const summary = await startBatchReRateStale({ concurrency: 3 });
    expect(summary).toMatchObject({ concurrency: 3 });
    expect(runBatchReEvaluate).toHaveBeenLastCalledWith(expect.objectContaining({ concurrency: 3 }), [row], 3, expect.anything());
    jobs.clear();
    await startBatchReRateStale({ concurrency: 0 });
    expect(runBatchReEvaluate).toHaveBeenLastCalledWith(expect.anything(), [row], 1, expect.anything());
    jobs.clear();
    // Eight is the setting's ceiling; three replicas are what is actually there.
    await startBatchReRateStale({ concurrency: 99 });
    expect(runBatchReEvaluate).toHaveBeenLastCalledWith(expect.anything(), [row], 3, expect.anything());
  });

  it("defaults and clamps the limit", async () => {
    findMany.mockResolvedValue([row]);
    await startBatchReRateStale();
    expect(findMany.mock.calls[0][0].take).toBe(250);
    jobs.clear();
    await startBatchReRateStale({ limit: 1e9 });
    expect(findMany.mock.calls[1][0].take).toBe(5000);
  });

  it("refuses to start with nothing stale, and while another stale batch runs", async () => {
    findMany.mockResolvedValue([]);
    await expect(startBatchReRateStale()).rejects.toMatchObject({ statusCode: 404 });
    findMany.mockResolvedValue([row]);
    await startBatchReRateStale();
    await expect(startBatchReRateStale()).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("the batch's pre-flight (ADR 0006)", () => {
  const row = { id: "ex1", promptId: "p1", promptRef: { prompt: "a bracket" } };

  it("runs at the replica count when the operator asked for more", async () => {
    // 2026-09-07: the pool fell to two while the setting still said three.
    servePool(2);
    findMany.mockResolvedValue([row]);

    const summary = await startBatchReRateStale({ concurrency: 3 });

    expect(summary).toMatchObject({ concurrency: 2 });
    expect(runBatchReEvaluate).toHaveBeenLastCalledWith(expect.anything(), [row], 2, expect.anything());
  });

  it("refuses to start an overnight batch against an empty pool", async () => {
    servePool(0);
    findMany.mockResolvedValue([row]);

    await expect(startBatchReRateStale({ concurrency: 3 })).rejects.toMatchObject({ statusCode: 503 });
  });

  it("runs at the configured concurrency when the judge has no gateway to ask", async () => {
    // An Anthropic judge: unknown R, recorded as unknown, not clamped to one.
    const { getModelForPurpose } = await import("../services/llm-config.service.js");
    vi.mocked(getModelForPurpose).mockResolvedValueOnce({ endpointUrl: null, modelName: "claude-sonnet-4-6" } as never);
    findMany.mockResolvedValue([row]);

    const summary = await startBatchReRateStale({ concurrency: 3 });

    expect(summary).toMatchObject({ concurrency: 3 });
  });
});
