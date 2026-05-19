/**
 * Tests for the failure-aware retro-routing hook in persistAbortedPipeline.
 *
 * When a single-agent run aborts on timeout with stepCount=0 (over-reasoning
 * hang), the harness writes a sticky `override_source='timeout_observed'` row
 * into `decomposition_decisions` so the next run for that (prompt, model)
 * routes to multi-agent automatically.
 *
 * Verifies the trigger fires for the abort+no-tool-call case and stays
 * silent for the two negative cases (had tool calls; missing promptId).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Mock the heavy persistence/trace dependencies BEFORE importing the SUT so the
// test focuses narrowly on the `markTimeoutObserved` side effect.
const { mockInsertExample, mockFinalizeTrace } = vi.hoisted(() => ({
  mockInsertExample: vi.fn().mockResolvedValue(undefined),
  mockFinalizeTrace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/workbench-persist.service.js", () => ({
  insertExample: mockInsertExample,
}));
vi.mock("../services/trace-persistence.service.js", () => ({
  finalizeTrace: mockFinalizeTrace,
}));

import { prisma } from "../db/prisma.js";
import { TraceBuilder } from "../services/trace-builder.service.js";
import { persistAbortedPipeline } from "../services/workbench-pipeline-persist.service.js";
import type { PromptContext } from "../services/workbench-pipeline-helpers.service.js";
import type { LlmModelConfig } from "../services/llm-config.service.js";
import type { AgentCodegenResult } from "../services/agent-codegen.service.js";

// Distinct fixed UUIDs so we don't collide with the existing
// decomposition-decision integration test suite.
const PROMPT_ID = "33333333-3333-3333-3333-333333333333";
const MODEL_ID = "44444444-4444-4444-4444-444444444444";
const PROVIDER_NAME = "test-provider-persist";
const CATEGORY_NAME = `test-category-persist-${Date.now()}`;
const CATEGORY_RANK_BASE = 99998;

let categoryId = "";

function makeCtx(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    promptId: PROMPT_ID,
    prompt: "test prompt (persist-abort)",
    categoryId,
    categoryName: CATEGORY_NAME,
    complexity: 1,
    cachedSpec: {
      specInterpretation: null,
      constructionSpec: null,
      codeAssertions: null,
      verificationChecklist: null,
      verificationCriteria: null,
      specRawResponse: null,
      specSystemPrompt: null,
      requiresDecomposition: null,
      decompositionReasoning: null,
    },
    ...overrides,
  };
}

function makeAgResult(overrides: Partial<AgentCodegenResult> = {}): AgentCodegenResult {
  return {
    code: "",
    files: [{ path: "main.py", content: "" }],
    renderedFiles: [],
    renderSuccess: false,
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      totalCostUsd: 0,
    },
    stepCount: 0,
    submitted: false,
    evalResult: null,
    screenshots: [],
    conversationHistory: [],
    ...overrides,
  };
}

function makeModelConfig(): LlmModelConfig {
  return {
    id: MODEL_ID,
    provider: PROVIDER_NAME,
    providerType: null,
    modelName: "test-model-persist",
    displayName: "Test Codegen Model (persist)",
    label: "test/persist",
    costPer1mInput: 0,
    costPer1mOutput: 0,
    maxOutputTokens: null,
    maxContextTokens: null,
    supportsThinking: false,
    thinkingEffort: null,
    supportsVision: false,
    supportsEmbeddings: false,
    streamingEnabled: true,
    vlmEvalPreamble: null,
    endpointUrl: null,
    apiKey: null,
    maxConcurrent: null,
  };
}

beforeAll(async () => {
  // Provider — referenced by llm_models.provider (FK).
  await prisma.llmProvider.upsert({
    where: { name: PROVIDER_NAME },
    update: {},
    create: {
      name: PROVIDER_NAME,
      displayName: "Test Provider (persist)",
      apiKey: "",
      endpointUrl: null,
    },
  });

  // Model — referenced by DecompositionDecision.modelId.
  await prisma.llmModel.upsert({
    where: { id: MODEL_ID },
    update: {},
    create: {
      id: MODEL_ID,
      provider: PROVIDER_NAME,
      modelName: "test-model-persist",
      displayName: "Test Codegen Model (persist)",
      costPer1mInput: 0,
      costPer1mOutput: 0,
    },
  });

  // Category (WorkbenchExamplePrompt.categoryId NOT NULL FK).
  const existing = await prisma.workbenchCategory.findFirst({
    where: { name: CATEGORY_NAME },
    select: { id: true },
  });
  if (existing) {
    categoryId = existing.id;
  } else {
    const maxRank = await prisma.workbenchCategory.aggregate({ _max: { rank: true } });
    const nextRank = Math.max((maxRank._max.rank ?? 0) + 1, CATEGORY_RANK_BASE);
    const cat = await prisma.workbenchCategory.create({
      data: {
        name: CATEGORY_NAME,
        complexity: 1,
        description: "persist-abort hook test fixture",
        rank: nextRank,
      },
      select: { id: true },
    });
    categoryId = cat.id;
  }

  // Prompt — referenced by DecompositionDecision.promptId.
  await prisma.workbenchExamplePrompt.upsert({
    where: { id: PROMPT_ID },
    update: {},
    create: {
      id: PROMPT_ID,
      categoryId,
      index: 0,
      prompt: "test prompt (persist-abort)",
    },
  });
});

afterAll(async () => {
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

beforeEach(async () => {
  await prisma.decompositionDecision.deleteMany({
    where: { promptId: PROMPT_ID, modelId: MODEL_ID },
  });
  mockInsertExample.mockClear();
  mockFinalizeTrace.mockClear();
});

describe("persistAbortedPipeline → markTimeoutObserved hook", () => {
  it("writes a 'timeout_observed' override row when stepCount=0 and promptId is set", async () => {
    const ctx = makeCtx();
    const agResult = makeAgResult({ stepCount: 0 });
    const traceBuilder = new TraceBuilder("single_agent");
    traceBuilder.startPhase("root", "root", "root");

    await persistAbortedPipeline(ctx, agResult, makeModelConfig(), traceBuilder, null);

    const row = await prisma.decompositionDecision.findUnique({
      where: { promptId_modelId: { promptId: PROMPT_ID, modelId: MODEL_ID } },
    });
    expect(row).not.toBeNull();
    expect(row!.overrideSource).toBe("timeout_observed");
    expect(row!.decompose).toBe(true);
    expect(row!.deciderVersion).toBe("observed-failure");
  });

  it("does NOT write an override row when stepCount > 0 (different failure class)", async () => {
    const ctx = makeCtx();
    const agResult = makeAgResult({ stepCount: 3 });
    const traceBuilder = new TraceBuilder("single_agent");
    traceBuilder.startPhase("root", "root", "root");

    await persistAbortedPipeline(ctx, agResult, makeModelConfig(), traceBuilder, null);

    const row = await prisma.decompositionDecision.findUnique({
      where: { promptId_modelId: { promptId: PROMPT_ID, modelId: MODEL_ID } },
    });
    expect(row).toBeNull();
  });

  it("does NOT write an override row when promptId is empty (chat path / unworkbenched)", async () => {
    const ctx = makeCtx({ promptId: "" });
    const agResult = makeAgResult({ stepCount: 0 });
    const traceBuilder = new TraceBuilder("single_agent");
    traceBuilder.startPhase("root", "root", "root");

    await persistAbortedPipeline(ctx, agResult, makeModelConfig(), traceBuilder, null);

    // No row should exist for this model at all — if the hook fired with an
    // empty promptId, it would have failed FK insert anyway, but the guard
    // must short-circuit BEFORE the upsert call (no swallowed FK error noise).
    const rows = await prisma.decompositionDecision.findMany({
      where: { modelId: MODEL_ID },
    });
    expect(rows).toHaveLength(0);
  });
});
