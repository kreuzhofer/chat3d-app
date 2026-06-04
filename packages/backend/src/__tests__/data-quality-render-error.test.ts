import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../db/prisma.js";
import { getDataQualityReport } from "../services/data-quality.service.js";

describe("data-quality includes renderErrorCategoryHistogram", () => {
  let categoryId: string;
  let promptId: string;

  beforeEach(async () => {
    const nextRank = ((await prisma.workbenchCategory.aggregate({ _max: { rank: true } }))._max.rank ?? 0) + 1;
    const cat = await prisma.workbenchCategory.create({ data: { name: `dq-test-${Date.now()}-${nextRank}`, description: "", complexity: 1, rank: nextRank } });
    categoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({
      data: { categoryId, index: 1, prompt: "z" },
    });
    promptId = prompt.id;
    await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "error", renderError: "x",
        renderErrorCategory: "kernel_error",
        approvalStatus: "pending",
      },
    });
  });

  it("returns per-category histogram with the kernel_error count", async () => {
    const result = await getDataQualityReport();
    const ours = result.categories.find((c) => c.categoryId === categoryId);
    expect(ours).toBeDefined();
    expect(ours!.stats.renderErrorCategoryHistogram).toBeDefined();
    expect(ours!.stats.renderErrorCategoryHistogram!.kernel_error).toBe(1);
    expect(ours!.stats.renderErrorCategoryHistogram!.geometry).toBe(0);
  });
});
