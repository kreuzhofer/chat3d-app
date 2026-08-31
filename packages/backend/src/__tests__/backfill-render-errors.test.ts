import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { prisma } from "../db/prisma.js";
import { deleteTestCategory } from "./support/workbench-category-fixture.js";
import { runBackfill, type BackfillReport } from "../../scripts/backfill-render-errors.js";

describe("backfill-render-errors", () => {
  let createdCategoryId: string | undefined;
  let categoryId: string;
  let promptId: string;

  beforeEach(async () => {
    const nextRank = ((await prisma.workbenchCategory.aggregate({ _max: { rank: true } }))._max.rank ?? 0) + 1;
    const cat = await prisma.workbenchCategory.create({ data: { name: `backfill-test-${Date.now()}-${nextRank}`, description: "", complexity: 1, rank: nextRank } });
    createdCategoryId = cat.id;
    categoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({
      data: { categoryId, index: 1, prompt: "x" },
    });
    promptId = prompt.id;
  });

  afterEach(async () => {
    await deleteTestCategory(createdCategoryId);
    createdCategoryId = undefined;
  });

  function makeConvoWithRenderFailure(rawError: string): unknown {
    return [{
      role: "tool",
      content: [{
        type: "tool-result",
        toolName: "validate_and_render",
        output: `Render FAILED.\n\nError: ${rawError}\n\nPlease fix the code`,
      }],
    }];
  }

  it("dry-run reports what would change but does not write", async () => {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "error",
        renderError: "Agent codegen failed to render",
        agentConversation: makeConvoWithRenderFailure("NameError: name 'Foo' is not defined") as object,
        approvalStatus: "pending",
      },
    });

    const report = await runBackfill({ dryRun: true, categoryId });
    expect(report.recovered_from_conversation).toBe(1);
    expect(report.still_unknown).toBe(0);

    const after = await prisma.workbenchExample.findUnique({ where: { id: ex.id } });
    expect(after?.renderErrorCategory).toBeNull();
  });

  it("commit mode writes the classification and replaces the lossy raw message", async () => {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "error",
        renderError: "Agent codegen failed to render",
        agentConversation: makeConvoWithRenderFailure("NameError: name 'Foo' is not defined") as object,
        approvalStatus: "pending",
      },
    });

    await runBackfill({ dryRun: false, categoryId });

    const after = await prisma.workbenchExample.findUnique({ where: { id: ex.id } });
    expect(after?.renderErrorCategory).toBe("api_misuse");
    expect(after?.renderErrorDetail).toBe("Foo");
    expect(after?.renderError).toContain("NameError: name 'Foo' is not defined");
  });

  it("falls back to the row's own renderError when conversation has nothing useful", async () => {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "error",
        renderError: "ValueError: No objects to create",
        agentConversation: null,
        approvalStatus: "pending",
      },
    });

    await runBackfill({ dryRun: false, categoryId });

    const after = await prisma.workbenchExample.findUnique({ where: { id: ex.id } });
    expect(after?.renderErrorCategory).toBe("geometry");
  });

  it("marks rows as unknown when neither source yields a usable error", async () => {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "error",
        renderError: "Agent codegen failed to render",
        agentConversation: null,
        approvalStatus: "pending",
      },
    });

    const report = await runBackfill({ dryRun: false, categoryId });
    expect(report.still_unknown).toBe(1);

    const after = await prisma.workbenchExample.findUnique({ where: { id: ex.id } });
    expect(after?.renderErrorCategory).toBe("unknown");
  });

  it("skips rows that already have a category", async () => {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "error",
        renderError: "ValueError: bad",
        renderErrorCategory: "geometry",
        agentConversation: null,
        approvalStatus: "pending",
      },
    });

    const report = await runBackfill({ dryRun: false, categoryId });
    expect(report.recovered_from_conversation + report.recovered_from_render_error + report.still_unknown).toBe(0);

    const after = await prisma.workbenchExample.findUnique({ where: { id: ex.id } });
    expect(after?.renderErrorCategory).toBe("geometry"); // unchanged
  });

  it("ignores successful renders", async () => {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "success",
        renderError: null,
        approvalStatus: "auto_approved",
      },
    });

    const report = await runBackfill({ dryRun: false, categoryId });
    expect(report.recovered_from_conversation + report.recovered_from_render_error + report.still_unknown).toBe(0);

    const after = await prisma.workbenchExample.findUnique({ where: { id: ex.id } });
    expect(after?.renderErrorCategory).toBeNull();
  });
});
