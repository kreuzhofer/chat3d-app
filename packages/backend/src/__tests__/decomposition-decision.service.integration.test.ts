import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../db/prisma.js";
import {
  DECIDER_VERSION,
  lookupCachedDecision,
} from "../services/decomposition-decision.service.js";

// Stable fixed UUIDs for the fixtures created/destroyed by this suite.
const PROMPT_ID = "11111111-1111-1111-1111-111111111111";
const MODEL_ID = "22222222-2222-2222-2222-222222222222";
const PROVIDER_NAME = "test-provider-retro";

// Category needs a unique `rank` per the schema (UNIQUE constraint). Pick
// a high rank unlikely to collide with existing rows.
const CATEGORY_RANK = 99999;
const CATEGORY_NAME = `test-category-retro-${Date.now()}`;

let categoryId: string = "";

beforeAll(async () => {
  // 1) Provider (no FK from elsewhere relevant, but llm_models.provider → llm_providers.name).
  await prisma.llmProvider.upsert({
    where: { name: PROVIDER_NAME },
    update: {},
    create: {
      name: PROVIDER_NAME,
      displayName: "Test Provider (retro-routing)",
      apiKey: "",
      endpointUrl: null,
    },
  });

  // 2) Model — referenced by DecompositionDecision.modelId.
  await prisma.llmModel.upsert({
    where: { id: MODEL_ID },
    update: {},
    create: {
      id: MODEL_ID,
      provider: PROVIDER_NAME,
      modelName: "test-model-retro",
      displayName: "Test Codegen Model (retro-routing)",
      costPer1mInput: 0,
      costPer1mOutput: 0,
    },
  });

  // 3) Category (WorkbenchExamplePrompt.categoryId → WorkbenchCategory.id, NOT NULL).
  //    Find or create by name to be idempotent; pick a unique rank if needed.
  const existing = await prisma.workbenchCategory.findFirst({
    where: { name: CATEGORY_NAME },
    select: { id: true },
  });
  if (existing) {
    categoryId = existing.id;
  } else {
    const maxRank = await prisma.workbenchCategory.aggregate({ _max: { rank: true } });
    const nextRank = Math.max((maxRank._max.rank ?? 0) + 1, CATEGORY_RANK);
    const cat = await prisma.workbenchCategory.create({
      data: {
        name: CATEGORY_NAME,
        complexity: 1,
        description: "retro-routing integration-test fixture",
        rank: nextRank,
      },
      select: { id: true },
    });
    categoryId = cat.id;
  }

  // 4) Prompt — referenced by DecompositionDecision.promptId.
  await prisma.workbenchExamplePrompt.upsert({
    where: { id: PROMPT_ID },
    update: {},
    create: {
      id: PROMPT_ID,
      categoryId,
      index: 0,
      prompt: "test prompt (retro-routing)",
    },
  });
});

afterAll(async () => {
  // Clean up in FK-safe order.
  await prisma.decompositionDecision.deleteMany({
    where: { promptId: PROMPT_ID, modelId: MODEL_ID },
  });
  await prisma.workbenchExamplePrompt.deleteMany({ where: { id: PROMPT_ID } });
  if (categoryId) {
    await prisma.workbenchCategory.deleteMany({ where: { id: categoryId } });
  }
  await prisma.llmModel.deleteMany({ where: { id: MODEL_ID } });
  await prisma.llmProvider.deleteMany({ where: { name: PROVIDER_NAME } });
});

describe("lookupCachedDecision (override-aware) [integration]", () => {
  beforeEach(async () => {
    await prisma.decompositionDecision.deleteMany({
      where: { promptId: PROMPT_ID, modelId: MODEL_ID },
    });
  });

  it("returns null when no row exists", async () => {
    const r = await lookupCachedDecision(PROMPT_ID, MODEL_ID);
    expect(r).toBeNull();
  });

  it("returns null when decider_version is stale AND no override is set", async () => {
    await prisma.decompositionDecision.create({
      data: {
        promptId: PROMPT_ID,
        modelId: MODEL_ID,
        deciderVersion: "v0.0.0-stale",
        decompose: true,
        reasoning: "stale",
      },
    });
    const r = await lookupCachedDecision(PROMPT_ID, MODEL_ID);
    expect(r).toBeNull();
  });

  it("returns the cached row when decider_version matches", async () => {
    await prisma.decompositionDecision.create({
      data: {
        promptId: PROMPT_ID,
        modelId: MODEL_ID,
        deciderVersion: DECIDER_VERSION,
        decompose: false,
        reasoning: "single",
      },
    });
    const r = await lookupCachedDecision(PROMPT_ID, MODEL_ID);
    expect(r).toEqual({ decompose: false, reasoning: "single", overrideSource: null });
  });

  it("returns the override row even when decider_version is the sentinel 'observed-failure'", async () => {
    await prisma.decompositionDecision.create({
      data: {
        promptId: PROMPT_ID,
        modelId: MODEL_ID,
        deciderVersion: "observed-failure",
        decompose: true,
        reasoning: "single-agent timed out previously with stepCount=0",
        overrideSource: "timeout_observed",
      },
    });
    const r = await lookupCachedDecision(PROMPT_ID, MODEL_ID);
    expect(r).toEqual({
      decompose: true,
      reasoning: "single-agent timed out previously with stepCount=0",
      overrideSource: "timeout_observed",
    });
  });
});
