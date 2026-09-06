/**
 * The agent-trajectory exporters read the same admission as the codegen
 * rows (ADR 0003, ADR 0004; #62): a human's verdict, or a judge's under the
 * current instrument by a judge qualified under it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const CURRENT = "production@0123456789ab";
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("../db/prisma.js", () => ({ prisma: { workbenchExample: { findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("../services/visual-eval-instrument-id.service.js", () => ({
  currentInstrumentId: vi.fn(async () => "production@0123456789ab"),
}));
vi.mock("../services/visual-eval-qualified-judges.js", () => ({
  QUALIFIED_JUDGES: [
    { model: "vllm-x/qwen", thinkingEffort: "off", instrumentId: "production@0123456789ab", qualifiedOn: "2026-09-06", evidence: ["run", "sheet"] },
  ],
}));

import { exportAgentTrainingJsonl } from "../services/workbench-training-export.service.js";
import { exportAgentSyntheticTrainingJsonl } from "../services/training-export/agent-synthetic.exporter.js";

const ADMITTED = [
  { approvalStatus: "human_approved" },
  { approvalStatus: "auto_approved", vlmInstrumentId: CURRENT, OR: [{ vlmModel: "vllm-x/qwen", vlmThinkingEffort: "off" }] },
];

beforeEach(() => { findMany.mockReset(); findMany.mockResolvedValue([]); });

describe("exportAgentTrainingJsonl", () => {
  it("admits approved rows by the export admission, not by approval status alone", async () => {
    await exportAgentTrainingJsonl({});
    const where = findMany.mock.calls[0][0].where;
    expect(where.approvalStatus).toBeUndefined();
    expect(where.vlmInstrumentId).toBeUndefined();
    expect(where.OR).toEqual(ADMITTED);
  });

  it("drops the admission when approvalOnly=false", async () => {
    await exportAgentTrainingJsonl({ approvalOnly: false });
    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
    expect(where.approvalStatus).toBeUndefined();
  });
});

describe("exportAgentSyntheticTrainingJsonl", () => {
  it("admits approved rows by the same export admission", async () => {
    await exportAgentSyntheticTrainingJsonl({});
    const where = findMany.mock.calls[0][0].where;
    expect(where.approvalStatus).toBeUndefined();
    expect(where.OR).toEqual(ADMITTED);
  });

  it("drops the admission when approvalOnly=false", async () => {
    await exportAgentSyntheticTrainingJsonl({ approvalOnly: false });
    expect(findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });
});
