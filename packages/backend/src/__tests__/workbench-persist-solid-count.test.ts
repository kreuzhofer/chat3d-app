import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { prisma } from "../db/prisma.js";
import { deleteTestCategory } from "./support/workbench-category-fixture.js";
import { insertExample } from "../services/workbench-persist.service.js";

/** The measured solid count travels with every evaluated example (#137). */
describe("insertExample measuredSolidCount", () => {
  let createdCategoryId: string | undefined;
  let promptId: string;
  let id: string;

  beforeEach(async () => {
    const nextRank = ((await prisma.workbenchCategory.aggregate({ _max: { rank: true } }))._max.rank ?? 0) + 1;
    const cat = await prisma.workbenchCategory.create({
      data: { name: `solid-count-test-${Date.now()}-${nextRank}`, description: "", complexity: 1, rank: nextRank },
    });
    createdCategoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({ data: { categoryId: cat.id, index: 1, prompt: "p" } });
    promptId = prompt.id;
    id = crypto.randomUUID();
  });

  afterEach(async () => {
    await deleteTestCategory(createdCategoryId);
    createdCategoryId = undefined;
  });

  const write = (extra: { measuredSolidCount?: number | null; evalScore?: number }) => insertExample({
    id, promptId, iteration: 1, code: "x",
    renderStatus: "success", renderError: null,
    stlPath: null, stepPath: null, threemfPath: null,
    screenshotFront: null, screenshotBack: null, screenshotLeft: null, screenshotRight: null,
    screenshotTop: null, screenshotBottom: null, screenshotOrtho45: null,
    screenshotOrtho45Bottom: null, screenshotIso: null, screenshotIsoBack: null,
    evalScore: extra.evalScore ?? 8, evalIssues: null, evalSuggestions: null, evalChecklistResults: null,
    approvalStatus: "auto_approved",
    llmModel: "m", vlmModel: null,
    promptTokens: 0, completionTokens: 0,
    ...("measuredSolidCount" in extra ? { measuredSolidCount: extra.measuredSolidCount } : {}),
  });

  const stored = async () => (await prisma.workbenchExample.findUnique({ where: { id } }))?.measuredSolidCount;

  it("stores the measured count", async () => {
    await write({ measuredSolidCount: 2 });
    expect(await stored()).toBe(2);
  });

  it("stores null when the render measured nothing", async () => {
    await write({ measuredSolidCount: null });
    expect(await stored()).toBeNull();
  });

  it("leaves a row written without a count at null", async () => {
    await write({});
    expect(await stored()).toBeNull();
  });

  it("keeps a stored count when a later write carries none", async () => {
    await write({ measuredSolidCount: 3 });
    await write({ evalScore: 5 });
    expect(await stored()).toBe(3);
  });

  it("refuses a negative count", async () => {
    await expect(write({ measuredSolidCount: -1 })).rejects.toThrow();
  });
});
