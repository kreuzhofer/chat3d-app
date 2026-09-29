/**
 * Generation over an explicit prompt list (#120's top-up): another row for each
 * listed prompt, in lanes. A held-out prompt is refused, not dropped — the
 * held-out set is cut by prompt (the training export's cut), and a new row of
 * a held-out prompt would share its checklist with the measurement set.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ launch: vi.fn(), heldOut: [] as string[], found: [] as Array<{ id: string; prompt: string }> }));
vi.mock("../db/prisma.js", () => ({
  prisma: { workbenchExamplePrompt: { findMany: vi.fn(async () => h.found) } },
}));
vi.mock("../services/training-export/judge-sft-held-out.js", () => ({
  heldOutRows: vi.fn(async () => ({ exampleIds: [], promptIds: h.heldOut, siblingExampleIds: [] })),
}));
vi.mock("../services/workbench-batch.service.js", () => ({ launchGenerationBatch: (...a: unknown[]) => h.launch(...a) }));

import { startPromptListBatch } from "../services/workbench-batch-prompts.service.js";

describe("startPromptListBatch", () => {
  beforeEach(() => {
    h.launch.mockReset(); h.launch.mockResolvedValue({ jobId: "batch-1" });
    h.heldOut = ["held"];
    h.found = [{ id: "a", prompt: "A" }, { id: "b", prompt: "B" }];
  });
  it("launches one row per listed prompt with the requested lanes", async () => {
    await startPromptListBatch({ promptIds: ["a", "b"], concurrency: 12 }, "user-1");
    expect(h.launch).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "prompt-list" }), h.found, { concurrency: 12 }, "user-1");
  });
  it("refuses a list that holds a held-out prompt, naming it", async () => {
    await expect(startPromptListBatch({ promptIds: ["a", "held"] })).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("held") });
    expect(h.launch).not.toHaveBeenCalled();
  });
  it("refuses unknown ids, an empty list and duplicates", async () => {
    await expect(startPromptListBatch({ promptIds: ["a", "b", "zzz"] })).rejects.toMatchObject({ statusCode: 404 });
    await expect(startPromptListBatch({ promptIds: [] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(startPromptListBatch({ promptIds: ["a", "a"] })).rejects.toMatchObject({ statusCode: 400 });
  });
});
