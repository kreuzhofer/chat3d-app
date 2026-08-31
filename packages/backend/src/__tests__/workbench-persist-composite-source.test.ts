import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { prisma } from "../db/prisma.js";
import { deleteTestCategory } from "./support/workbench-category-fixture.js";
import { insertExample } from "../services/workbench-persist.service.js";

describe("insertExample compositeWeightSource", () => {
  let createdCategoryId: string | undefined;
  let promptId: string;
  let id: string;

  beforeEach(async () => {
    const nextRank = ((await prisma.workbenchCategory.aggregate({ _max: { rank: true } }))._max.rank ?? 0) + 1;
    const cat = await prisma.workbenchCategory.create({
      data: { name: `cws-test-${Date.now()}-${nextRank}`, description: "", complexity: 1, rank: nextRank },
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

  it("persists compositeWeightSource when provided", async () => {
    await insertExample({
      id, promptId, iteration: 1, code: "x",
      renderStatus: "success", renderError: null,
      compositeWeightSource: "eval_plan",
      stlPath: null, stepPath: null, threemfPath: null,
      screenshotFront: null, screenshotBack: null, screenshotLeft: null, screenshotRight: null,
      screenshotTop: null, screenshotBottom: null, screenshotOrtho45: null,
      screenshotOrtho45Bottom: null, screenshotIso: null, screenshotIsoBack: null,
      evalScore: 8, evalIssues: null, evalSuggestions: null, evalChecklistResults: null,
      approvalStatus: "auto_approved",
      llmModel: "m", vlmModel: null,
      promptTokens: 0, completionTokens: 0,
    });
    const row = await prisma.workbenchExample.findUnique({ where: { id } });
    expect(row?.compositeWeightSource).toBe("eval_plan");
  });
});
