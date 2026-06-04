import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../db/prisma.js";
import {
  getRenderErrorHistogramForCategory,
  listExamplesByRenderErrorCategory,
  type RenderErrorHistogram,
} from "../services/render-error-analytics.service.js";

describe("render-error analytics", () => {
  let categoryId: string;
  let promptId: string;

  async function makeExample(opts: { renderErrorCategory?: string | null; renderStatus?: string }): Promise<string> {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId,
        iteration: 1,
        code: "x",
        renderStatus: opts.renderStatus ?? "error",
        renderError: "x",
        renderErrorCategory: opts.renderErrorCategory ?? null,
        approvalStatus: "pending",
      },
    });
    return ex.id;
  }

  beforeEach(async () => {
    const nextRank = ((await prisma.workbenchCategory.aggregate({ _max: { rank: true } }))._max.rank ?? 0) + 1;
    const cat = await prisma.workbenchCategory.create({ data: { name: `analytics-test-${Date.now()}-${nextRank}`, description: "", complexity: 1, rank: nextRank } });
    categoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({
      data: { categoryId, index: 1, prompt: "y" },
    });
    promptId = prompt.id;
  });

  it("histogram returns zero counts when no failed examples exist", async () => {
    await makeExample({ renderStatus: "success", renderErrorCategory: null });
    const histogram = await getRenderErrorHistogramForCategory(categoryId);
    expect(histogram.kernel_error).toBe(0);
    expect(histogram.geometry).toBe(0);
    expect(histogram.unknown).toBe(0);
  });

  it("histogram groups by render_error_category and ignores successes", async () => {
    await makeExample({ renderErrorCategory: "kernel_error" });
    await makeExample({ renderErrorCategory: "kernel_error" });
    await makeExample({ renderErrorCategory: "geometry" });
    await makeExample({ renderStatus: "success", renderErrorCategory: null });
    await makeExample({ renderStatus: "error", renderErrorCategory: null }); // unclassified — should be excluded

    const histogram = await getRenderErrorHistogramForCategory(categoryId);
    expect(histogram.kernel_error).toBe(2);
    expect(histogram.geometry).toBe(1);
    expect(histogram.unknown).toBe(0);
  });

  it("drill-down lists examples filtered by error category", async () => {
    const id1 = await makeExample({ renderErrorCategory: "kernel_error" });
    await makeExample({ renderErrorCategory: "geometry" });

    const result = await listExamplesByRenderErrorCategory({
      categoryId,
      errorCategory: "kernel_error",
      limit: 10,
    });
    expect(result.total).toBe(1);
    expect(result.examples[0].id).toBe(id1);
    expect(result.examples[0].renderErrorCategory).toBe("kernel_error");
  });

  it("drill-down paginates", async () => {
    for (let i = 0; i < 5; i++) {
      await makeExample({ renderErrorCategory: "geometry" });
    }
    const page = await listExamplesByRenderErrorCategory({
      categoryId,
      errorCategory: "geometry",
      limit: 3,
    });
    expect(page.examples.length).toBe(3);
    expect(page.total).toBe(5);
  });
});
