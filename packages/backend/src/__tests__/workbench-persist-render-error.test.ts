import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../db/prisma.js";
import { insertExample } from "../services/workbench-persist.service.js";

describe("insertExample render error classification", () => {
  let categoryId: string;
  let promptId: string;
  let id: string;

  beforeEach(async () => {
    const maxRank = await prisma.workbenchCategory.aggregate({ _max: { rank: true } });
    const nextRank = (maxRank._max.rank ?? 0) + 1;
    const cat = await prisma.workbenchCategory.create({
      data: { name: `render-err-test-${Date.now()}-${nextRank}`, description: "", complexity: 1, rank: nextRank },
    });
    categoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({
      data: { categoryId, index: 1, prompt: "test" },
    });
    promptId = prompt.id;
    id = crypto.randomUUID();
  });

  it("persists renderErrorCategory and renderErrorDetail when provided", async () => {
    await insertExample({
      id, promptId, iteration: 1, code: "fail",
      renderStatus: "error",
      renderError: "NameError: name 'BadName' is not defined",
      renderErrorCategory: "api_misuse",
      renderErrorDetail: "BadName",
      stlPath: null, stepPath: null, threemfPath: null,
      screenshotFront: null, screenshotBack: null, screenshotLeft: null, screenshotRight: null,
      screenshotTop: null, screenshotBottom: null, screenshotOrtho45: null,
      screenshotOrtho45Bottom: null, screenshotIso: null, screenshotIsoBack: null,
      evalScore: null, evalIssues: null, evalSuggestions: null, evalChecklistResults: null,
      approvalStatus: "pending",
      llmModel: "test-model", vlmModel: null,
      promptTokens: 0, completionTokens: 0,
    });

    const row = await prisma.workbenchExample.findUnique({ where: { id } });
    expect(row?.renderErrorCategory).toBe("api_misuse");
    expect(row?.renderErrorDetail).toBe("BadName");
    expect(row?.renderError).toBe("NameError: name 'BadName' is not defined");
  });

  it("leaves both fields null on successful renders", async () => {
    await insertExample({
      id, promptId, iteration: 1, code: "ok",
      renderStatus: "success",
      renderError: null,
      // renderErrorCategory + renderErrorDetail omitted on purpose
      stlPath: null, stepPath: null, threemfPath: null,
      screenshotFront: null, screenshotBack: null, screenshotLeft: null, screenshotRight: null,
      screenshotTop: null, screenshotBottom: null, screenshotOrtho45: null,
      screenshotOrtho45Bottom: null, screenshotIso: null, screenshotIsoBack: null,
      evalScore: 8, evalIssues: null, evalSuggestions: null, evalChecklistResults: null,
      approvalStatus: "auto_approved",
      llmModel: "test-model", vlmModel: null,
      promptTokens: 0, completionTokens: 0,
    });

    const row = await prisma.workbenchExample.findUnique({ where: { id } });
    expect(row?.renderErrorCategory).toBeNull();
    expect(row?.renderErrorDetail).toBeNull();
  });
});
