/**
 * Usage Tracking Service
 *
 * Append-only recording of every LLM call with full dimensional data.
 * Uses AsyncLocalStorage to propagate user/context/item IDs from pipeline
 * entry points to inner LLM call sites without parameter drilling.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("usage-tracking");

// ── AsyncLocalStorage context ──────────────────────────────────────

export interface UsageTrackingContext {
  userId?: string;
  chatContextId?: string;
  chatItemId?: string;
  workbenchExampleId?: string;
  experimentId?: string;
  experimentRunId?: string;
  source?: "workbench" | "chat" | "experiment" | "system";
  sourceLabel?: string;
}

const store = new AsyncLocalStorage<UsageTrackingContext>();

/**
 * Run a function within a usage tracking context.
 * Nested calls inherit the outer context; explicit fields override.
 */
export function runWithUsageContext<T>(ctx: UsageTrackingContext, fn: () => T): T {
  return store.run(ctx, fn);
}

/** Get the current usage tracking context (empty object if none set). */
export function getUsageContext(): UsageTrackingContext {
  return store.getStore() ?? {};
}

// ── Purpose type ───────────────────────────────────────────────────

export type LlmPurpose =
  | "conversation"
  | "codegen"
  | "chat_naming"
  | "vlm_evaluation"
  | "code_evaluation"
  | "embeddings"
  | "spec_generation"
  | "agent_orchestration"
  | "agent_decomposition"
  | "curation_distill"
  | "curation_tags"
  | "prompt_validation"
  | "prompt_improvement"
  | "knowledge_embedding"
  | "gap_prompt_generation"
  | "gap_decomposition"
  | "decomposition_decision";

// ── Event recording ────────────────────────────────────────────────

export interface UsageEventParams {
  userId?: string;
  chatContextId?: string;
  chatItemId?: string;
  workbenchExampleId?: string;
  providerName: string;
  modelId?: string;
  modelName: string;
  purpose: LlmPurpose;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs?: number;
  isEstimated?: boolean;
  generationAttempt?: number;
  outputTokensPerSecond?: number;
  /**
   * Raw thinking text from the model. Persisted only for purposes in
   * REASONING_TEXT_PERSIST_PURPOSES — those are the runs we'd want to
   * use for fine-tuning data later (planning + codegen). Other callers
   * may pass it; it'll be dropped to keep storage small.
   */
  reasoningText?: string;
}

/**
 * Purposes whose reasoning_text we persist. Limited to runs that are
 * useful for distillation/training datasets.
 */
const REASONING_TEXT_PERSIST_PURPOSES = new Set<LlmPurpose>([
  "agent_orchestration",
  "spec_generation",
]);

/**
 * Record a usage event. Fire-and-forget: never throws.
 * Merges explicit params with AsyncLocalStorage context (explicit wins).
 */
export function recordUsageEvent(params: UsageEventParams): void {
  const ctx = getUsageContext();

  const merged = {
    userId: params.userId ?? ctx.userId,
    chatContextId: params.chatContextId ?? ctx.chatContextId,
    chatItemId: params.chatItemId ?? ctx.chatItemId,
    workbenchExampleId: params.workbenchExampleId ?? ctx.workbenchExampleId,
    experimentId: ctx.experimentId,
    experimentRunId: ctx.experimentRunId,
    source: ctx.source,
    sourceLabel: ctx.sourceLabel,
  };

  // Fire-and-forget
  prisma.llmUsageEvent
    .create({
      data: {
        userId: merged.userId ?? null,
        chatContextId: merged.chatContextId ?? null,
        chatItemId: merged.chatItemId ?? null,
        workbenchExampleId: merged.workbenchExampleId ?? null,
        experimentId: merged.experimentId ?? null,
        experimentRunId: merged.experimentRunId ?? null,
        source: merged.source ?? null,
        sourceLabel: merged.sourceLabel ?? null,
        providerName: params.providerName,
        modelId: params.modelId ?? null,
        modelName: params.modelName,
        purpose: params.purpose,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        reasoningTokens: params.reasoningTokens ?? 0,
        cacheReadTokens: params.cacheReadTokens ?? 0,
        cacheWriteTokens: params.cacheWriteTokens ?? 0,
        totalTokens: params.totalTokens,
        estimatedCostUsd: params.estimatedCostUsd,
        durationMs: params.durationMs ?? null,
        isEstimated: params.isEstimated ?? false,
        generationAttempt: params.generationAttempt ?? 1,
        outputTokensPerSecond: params.outputTokensPerSecond ?? null,
        reasoningText:
          params.reasoningText && REASONING_TEXT_PERSIST_PURPOSES.has(params.purpose)
            ? params.reasoningText
            : null,
      },
    })
    .catch((err: unknown) => {
      logger.warn(
        { err, purpose: params.purpose, model: params.modelName, costUsd: params.estimatedCostUsd },
        "failed to record usage event — cost data lost",
      );
    });
}
