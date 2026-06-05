import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../db/prisma.js";
import { persistSpecToPrompt } from "../services/workbench-spec-persist.service.js";
import type { SpecResult } from "../services/spec-generation.service.js";
import type { EvalPlan } from "../utils/eval-plan.js";

describe("persistSpecToPrompt evalPlan", () => {
  let categoryId: string;
  let promptId: string;

  beforeEach(async () => {
    const nextRank = ((await prisma.workbenchCategory.aggregate({ _max: { rank: true } }))._max.rank ?? 0) + 1;
    const cat = await prisma.workbenchCategory.create({
      data: { name: `evalplan-persist-${Date.now()}-${nextRank}`, description: "", complexity: 1, rank: nextRank },
    });
    categoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({
      data: { categoryId, index: 1, prompt: "p" },
    });
    promptId = prompt.id;
  });

  function makeSpec(plan: EvalPlan | null): SpecResult {
    return {
      interpretation: "x",
      verificationChecklist: [],
      codeAssertions: [],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
      requiresDecomposition: false,
      decompositionReasoning: "",
      complexity: "simple",
      promptTokens: 0,
      completionTokens: 0,
      evalPlan: plan,
    };
  }

  it("persists evalPlan as JSONB when present", async () => {
    const plan: EvalPlan = {
      systemPrompt: "test prompt",
      inspectionPlan: { angles: ["isometric"] },
      suggestedCodeWeight: 0.65,
    };
    await persistSpecToPrompt({
      promptId,
      specResult: makeSpec(plan),
      specCameFromNullDecompositionCache: false,
    });
    const row = await prisma.workbenchExamplePrompt.findUnique({ where: { id: promptId } });
    expect(row?.evalPlan).toEqual(plan as unknown);
  });

  it("persists null evalPlan when spec result has none", async () => {
    await persistSpecToPrompt({
      promptId,
      specResult: makeSpec(null),
      specCameFromNullDecompositionCache: false,
    });
    const row = await prisma.workbenchExamplePrompt.findUnique({ where: { id: promptId } });
    expect(row?.evalPlan).toBeNull();
  });
});
