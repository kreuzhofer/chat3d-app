/**
 * Export admission (ADR 0003, ADR 0004; #62).
 *
 * The training export trusts an approved row on one of two grounds: a human
 * decided it, or the judge did — and a judge's verdict counts only when it
 * was answered under the current Instrument id (else Stale) by a judge
 * qualified under that id (else Provisional). A human's verdict is not the
 * judge's, so neither the instrument nor the qualification gates it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const CURRENT = "production@0123456789ab";
const REVISED = "production@ffffffffffff";
const QWEN = { model: "vllm-x/qwen", thinkingEffort: "off", instrumentId: CURRENT, qualifiedOn: "2026-09-06", evidence: ["run", "sheet"] };
const GLM = { model: "vllm-x/glm", thinkingEffort: "off", instrumentId: CURRENT, qualifiedOn: "2026-09-06", evidence: ["run", "sheet"] };
const QWEN_UNDER_OLD_ID = { ...QWEN, instrumentId: REVISED };

const { count } = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock("../db/prisma.js", () => ({ prisma: { workbenchExample: { count: (...a: unknown[]) => count(...a) } } }));

import { admittedWhere, staleApprovedWhere, qualifiedUnder, getExportAdmission } from "../services/training-export/admission.js";

beforeEach(() => { count.mockReset(); });

describe("qualifiedUnder", () => {
  it("keeps only the pairs granted under that instrument id — a revision revokes", () => {
    expect(qualifiedUnder(CURRENT, [QWEN, QWEN_UNDER_OLD_ID, GLM])).toEqual([QWEN, GLM]);
    expect(qualifiedUnder(REVISED, [QWEN, GLM])).toEqual([]);
  });
});

describe("admittedWhere", () => {
  it("admits a human's verdict whatever its rating's instrument or judge", () => {
    expect(admittedWhere(CURRENT, []).OR).toEqual([{ approvalStatus: "human_approved" }]);
  });

  it("admits a judge-derived verdict only under the current instrument, by a judge qualified under it, thinking setting included", () => {
    expect(admittedWhere(CURRENT, [QWEN, GLM])).toEqual({
      OR: [
        { approvalStatus: "human_approved" },
        {
          approvalStatus: "auto_approved",
          vlmInstrumentId: CURRENT,
          OR: [
            { vlmModel: "vllm-x/qwen", vlmThinkingEffort: "off" },
            { vlmModel: "vllm-x/glm", vlmThinkingEffort: "off" },
          ],
        },
      ],
    });
  });

  it("does not count a judge qualified under another instrument id", () => {
    expect(admittedWhere(CURRENT, [QWEN_UNDER_OLD_ID]).OR).toEqual([{ approvalStatus: "human_approved" }]);
  });
});

describe("staleApprovedWhere", () => {
  it("selects judge-derived approvals rated under another id or before ids existed", () => {
    expect(staleApprovedWhere(CURRENT)).toEqual({
      approvalStatus: "auto_approved",
      OR: [{ vlmInstrumentId: null }, { vlmInstrumentId: { not: CURRENT } }],
    });
  });
});

describe("getExportAdmission", () => {
  it("partitions the approved, rendered production rows into admitted, provisional and stale", async () => {
    count.mockResolvedValueOnce(2309).mockResolvedValueOnce(0).mockResolvedValueOnce(2308);
    const admission = await getExportAdmission(CURRENT, [QWEN]);
    expect(admission).toEqual({
      qualifiedJudges: [{ model: "vllm-x/qwen", thinkingEffort: "off" }],
      approved: 2309,
      admitted: 0,
      provisional: 1,
      stale: 2308,
    });
    const base = { renderStatus: "success", experimentRunId: null };
    expect(count.mock.calls[0][0]).toEqual({ where: { ...base, approvalStatus: { in: ["auto_approved", "human_approved"] } } });
    expect(count.mock.calls[1][0]).toEqual({ where: { ...base, ...admittedWhere(CURRENT, [QWEN]) } });
    expect(count.mock.calls[2][0]).toEqual({ where: { ...base, ...staleApprovedWhere(CURRENT) } });
  });
});
