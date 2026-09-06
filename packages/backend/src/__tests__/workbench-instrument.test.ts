/**
 * Stale ratings and the re-rating batch (ADR 0003).
 *
 * A rating is Stale when its Instrument id is not the current one, the rows
 * rated before ids existed included. The batch re-rates only rows the judge
 * can be re-run on (the eight views stored) and whose verdict the judge
 * derived; it never overturns a human's decision.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const CURRENT = "production@0123456789ab";
const { count, findMany, runBatchReEvaluate, jobs } = vi.hoisted(() => ({
  count: vi.fn(), findMany: vi.fn(), runBatchReEvaluate: vi.fn(async (..._args: unknown[]) => {}), jobs: new Map(),
}));
vi.mock("../db/prisma.js", () => ({ prisma: { workbenchExample: { count: (...a: unknown[]) => count(...a), findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("../services/visual-eval-instrument-id.service.js", () => ({ currentInstrumentId: vi.fn(async () => "production@0123456789ab") }));
vi.mock("../services/visual-eval-qualified-judges.js", () => ({
  QUALIFIED_JUDGES: [{ model: "vllm-x/qwen", thinkingEffort: "off", instrumentId: "production@0123456789ab", qualifiedOn: "2026-09-06", evidence: ["run", "sheet"] }],
}));
vi.mock("../services/workbench-batch.service.js", () => ({
  jobs,
  generateJobId: (t: string) => `${t}-1`,
  toSummary: (j: Record<string, unknown>) => ({ jobId: j.jobId, type: j.type, total: j.total, status: j.status }),
  runBatchReEvaluate: (...a: unknown[]) => runBatchReEvaluate(...a),
}));

import { staleRatingWhere, getInstrumentStatus, startBatchReRateStale } from "../services/workbench-instrument.service.js";

beforeEach(() => { count.mockReset(); findMany.mockReset(); runBatchReEvaluate.mockReset(); jobs.clear(); });

describe("staleRatingWhere", () => {
  it("selects rated production rows under another id or under none", () => {
    expect(staleRatingWhere(CURRENT)).toEqual({
      renderStatus: "success", experimentRunId: null, visualScore: { not: null },
      OR: [{ vlmInstrumentId: null }, { vlmInstrumentId: { not: CURRENT } }],
    });
  });
});

describe("getInstrumentStatus", () => {
  it("reports the current id and the stale, approved-stale, unratable and human-decided counts, and the export's admission", async () => {
    count.mockResolvedValueOnce(2618).mockResolvedValueOnce(0).mockResolvedValueOnce(2618)
      .mockResolvedValueOnce(2305).mockResolvedValueOnce(2600).mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2309).mockResolvedValueOnce(0).mockResolvedValueOnce(2308);
    const status = await getInstrumentStatus();
    expect(status).toEqual({
      instrumentId: CURRENT, rated: 2618, current: 0, stale: 2618, staleApproved: 2305, unratable: 18, staleHumanDecided: 4,
      export: { qualifiedJudges: [{ model: "vllm-x/qwen", thinkingEffort: "off" }], approved: 2309, admitted: 0, provisional: 1, stale: 2308 },
    });
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
    expect(args.where.OR).toEqual([{ vlmInstrumentId: null }, { vlmInstrumentId: { not: CURRENT } }]);
    for (const f of ["screenshotFront", "screenshotBack", "screenshotLeft", "screenshotRight", "screenshotTop", "screenshotBottom", "screenshotOrtho45", "screenshotOrtho45Bottom"]) {
      expect(args.where[f]).toEqual({ not: null });
    }
    expect(args.where.approvalStatus).toEqual({ in: ["auto_approved", "pending"] });
    expect(args.where.promptRef).toEqual({ categoryId: "cat1" });
    expect(args.take).toBe(40);
    expect(args.orderBy[0]).toEqual({ updatedAt: "asc" });
    expect(summary).toMatchObject({ jobId: "batch-re-rate-stale-1", type: "batch-re-rate-stale", total: 1, status: "running" });
    expect(runBatchReEvaluate).toHaveBeenCalledWith(expect.objectContaining({ jobId: "batch-re-rate-stale-1" }), [row]);
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
