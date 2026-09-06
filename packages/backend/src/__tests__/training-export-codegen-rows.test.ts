import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchCodegenRows } from "../services/training-export/codegen-rows.service.js";

vi.mock("../db/prisma.js", () => ({
  prisma: {
    workbenchExample: {
      findMany: vi.fn(),
    },
  },
}));
vi.mock("../services/visual-eval-instrument-id.service.js", () => ({
  currentInstrumentId: vi.fn(async () => "production@0123456789ab"),
}));

const { prisma } = await import("../db/prisma.js");

describe("fetchCodegenRows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries approved + successfully-rendered examples by default", async () => {
    (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await fetchCodegenRows({});
    const args = (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.renderStatus).toBe("success");
    expect(args.where.experimentRunId).toBe(null);
    expect(args.where.approvalStatus).toEqual({ in: ["auto_approved", "human_approved"] });
  });

  it("admits only ratings under the current instrument when approval gates the export (ADR 0003)", async () => {
    (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await fetchCodegenRows({});
    const args = (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.vlmInstrumentId).toBe("production@0123456789ab");
  });

  it("drops approval and instrument filters when approvalOnly=false", async () => {
    (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await fetchCodegenRows({ approvalOnly: false });
    const args = (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.approvalStatus).toBeUndefined();
    expect(args.where.vlmInstrumentId).toBeUndefined();
  });

  it("applies minScore and categoryId when provided", async () => {
    (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await fetchCodegenRows({ minScore: 7, categoryId: "cat-uuid" });
    const args = (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.evalScore).toEqual({ gte: 7 });
    expect(args.where.promptRef).toEqual({ categoryId: "cat-uuid" });
  });

  it("maps prisma rows to flat shape with prompt, code, system_prompt", async () => {
    (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "ex-1",
        promptId: "p-1",
        code: "from build123d import *\n",
        agentSystemPrompt: "You are a Build123d expert.",
        evalScore: 9,
        promptRef: { prompt: "Make a cube", category: { name: "primitives" } },
      },
    ]);
    const rows = await fetchCodegenRows({});
    expect(rows).toEqual([
      {
        exampleId: "ex-1",
        promptId: "p-1",
        prompt: "Make a cube",
        code: "from build123d import *\n",
        systemPrompt: "You are a Build123d expert.",
        category: "primitives",
        evalScore: 9,
      },
    ]);
  });

  it("skips rows with no agent system prompt", async () => {
    (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "ex-1",
        promptId: "p-1",
        code: "x",
        agentSystemPrompt: null,
        evalScore: null,
        promptRef: { prompt: "p", category: { name: "c" } },
      },
    ]);
    const rows = await fetchCodegenRows({});
    expect(rows).toEqual([]);
  });
});
