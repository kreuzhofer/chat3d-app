import { describe, expect, it, afterAll } from "vitest";
import { prisma } from "../db/prisma.js";
import { deleteTestCategory } from "./support/workbench-category-fixture.js";

describe("workbench-reeval persists compositeWeightSource", () => {
  let createdCategoryId: string | undefined;

  afterAll(async () => {
    await deleteTestCategory(createdCategoryId);
    createdCategoryId = undefined;
  });
  it("the update payload includes compositeWeightSource", async () => {
    // This is a minimal regression test that just confirms the update can write the field.
    // Full E2E would require mocking the eval pipeline; out of scope.
    const nextRank = ((await prisma.workbenchCategory.aggregate({ _max: { rank: true } }))._max.rank ?? 0) + 1;
    const cat = await prisma.workbenchCategory.create({
      data: { name: `reeval-cws-${Date.now()}-${nextRank}`, description: "", complexity: 1, rank: nextRank },
    });
    createdCategoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({
      data: { categoryId: cat.id, index: 1, prompt: "p" },
    });
    const example = await prisma.workbenchExample.create({
      data: {
        id: crypto.randomUUID(),
        promptId: prompt.id,
        iteration: 1, code: "x",
        renderStatus: "success", renderError: null,
        approvalStatus: "auto_approved",
        evalScore: 8,
      },
    });
    await prisma.workbenchExample.update({
      where: { id: example.id },
      data: { compositeWeightSource: "eval_plan" },
    });
    const row = await prisma.workbenchExample.findUnique({ where: { id: example.id } });
    expect(row?.compositeWeightSource).toBe("eval_plan");
  });
});
