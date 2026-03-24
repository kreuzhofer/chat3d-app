/**
 * Tracked LLM Wrappers
 *
 * Thin wrappers around Vercel AI SDK functions that automatically record
 * usage events after each call. For non-streaming calls only — streaming
 * calls have inline recording due to the Bedrock usage bug workaround.
 */

import { generateText, embed, embedMany } from "ai";
import { calculateCostUsd, type LlmModelConfig } from "./llm-config.service.js";
import { recordUsageEvent, type LlmPurpose } from "./usage-tracking.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("tracked-llm");

// ── Tracking metadata ──────────────────────────────────────────────

export interface TrackingMeta {
  purpose: LlmPurpose;
  providerName: string;
  modelId?: string;
  modelName: string;
  modelConfig: { costPer1mInput: number; costPer1mOutput: number };
  generationAttempt?: number;
}

// ── Token extraction helpers ───────────────────────────────────────

function safeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

interface ExtractedUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

function extractUsage(raw: unknown): ExtractedUsage {
  if (typeof raw !== "object" || raw === null) {
    return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
  }
  const u = raw as Record<string, unknown>;
  const inputTokens = safeInt(u.inputTokens ?? u.promptTokens ?? u.input_tokens);
  const outputTokens = safeInt(u.outputTokens ?? u.completionTokens ?? u.output_tokens);
  const reasoningTokens = safeInt(u.reasoningTokens ?? u.reasoning_tokens);
  const totalTokens = safeInt(u.totalTokens ?? u.total_tokens) || (inputTokens + outputTokens);

  const details = typeof u.inputTokenDetails === "object" && u.inputTokenDetails !== null
    ? u.inputTokenDetails as Record<string, unknown>
    : null;
  const cacheReadTokens = details ? safeInt(details.cacheReadTokens ?? details.cachedTokens) : 0;
  const cacheWriteTokens = details ? safeInt(details.cacheWriteTokens ?? details.cacheCreationTokens) : 0;

  return { inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens, totalTokens };
}

function computeCost(meta: TrackingMeta, usage: ExtractedUsage): number {
  const cfg = {
    costPer1mInput: meta.modelConfig.costPer1mInput,
    costPer1mOutput: meta.modelConfig.costPer1mOutput,
  } as LlmModelConfig;
  return calculateCostUsd(cfg, usage.inputTokens, usage.outputTokens, usage.reasoningTokens, usage.cacheReadTokens, usage.cacheWriteTokens);
}

// ── trackedGenerateText ────────────────────────────────────────────

type GenerateTextParams = Parameters<typeof generateText>[0];
type GenerateTextResult = Awaited<ReturnType<typeof generateText>>;

/** Default timeouts for LLM calls.
 * Opus on Bedrock can take 5+ min for complex codegen prompts (threads, sweeps, etc.).
 * These are generous to avoid premature aborts — the pipeline timeout is the real safety net. */
const DEFAULT_TIMEOUT = {
  totalMs: 900_000,  // 15 min total per generateText call (covers multi-step tool loops)
  stepMs: 480_000,   // 8 min per individual LLM step (Opus TTFT can be 5+ min on complex prompts)
  chunkMs: 480_000,  // 8 min between chunks (generateText may use internal streaming)
};

export async function trackedGenerateText(
  options: GenerateTextParams,
  tracking: TrackingMeta,
): Promise<GenerateTextResult> {
  const callerSignal = options.abortSignal as AbortSignal | undefined;

  // Hard timeout per call via AbortController (safety net if SDK timeout doesn't work)
  const hardTimeoutController = new AbortController();
  const timer = setTimeout(() => {
    logger.warn({ purpose: tracking.purpose, timeoutMs: DEFAULT_TIMEOUT.totalMs }, "LLM call hard timeout — aborting");
    hardTimeoutController.abort();
  }, DEFAULT_TIMEOUT.totalMs);

  const combinedSignal = callerSignal
    ? AbortSignal.any([callerSignal, hardTimeoutController.signal])
    : hardTimeoutController.signal;

  try {
    const start = Date.now();
    const result = await generateText({
      ...options,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      abortSignal: combinedSignal,
    });

    const durationMs = Date.now() - start;
    const usage = extractUsage(result.usage);
    const cost = computeCost(tracking, usage);

    recordUsageEvent({
      providerName: tracking.providerName,
      modelId: tracking.modelId,
      modelName: tracking.modelName,
      purpose: tracking.purpose,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      totalTokens: usage.totalTokens,
      estimatedCostUsd: cost,
      durationMs,
      isEstimated: usage.inputTokens === 0 && usage.outputTokens === 0,
      generationAttempt: tracking.generationAttempt,
    });

    return result;
  } finally {
    clearTimeout(timer);
  }
}

// ── trackedEmbed ───────────────────────────────────────────────────

type EmbedParams = Parameters<typeof embed>[0];
type EmbedResult = Awaited<ReturnType<typeof embed>>;

export async function trackedEmbed(
  options: EmbedParams,
  tracking: TrackingMeta,
): Promise<EmbedResult> {
  const start = Date.now();
  const result = await embed(options);
  const durationMs = Date.now() - start;

  const usage = extractUsage(result.usage);
  const cost = computeCost(tracking, usage);

  recordUsageEvent({
    providerName: tracking.providerName,
    modelId: tracking.modelId,
    modelName: tracking.modelName,
    purpose: tracking.purpose,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedCostUsd: cost,
    durationMs,
    isEstimated: usage.inputTokens === 0,
  });

  return result;
}

// ── trackedEmbedMany ───────────────────────────────────────────────

type EmbedManyParams = Parameters<typeof embedMany>[0];
type EmbedManyResult = Awaited<ReturnType<typeof embedMany>>;

export async function trackedEmbedMany(
  options: EmbedManyParams,
  tracking: TrackingMeta,
): Promise<EmbedManyResult> {
  const start = Date.now();
  const result = await embedMany(options);
  const durationMs = Date.now() - start;

  // embedMany returns usage per embedding; aggregate
  let totalInput = 0;
  let totalTokensAll = 0;
  if (result.usage) {
    const u = result.usage as Record<string, unknown>;
    totalInput = safeInt(u.tokens ?? u.totalTokens);
    totalTokensAll = totalInput;
  }
  // Some providers include per-embedding usage
  const resultAny = result as unknown as Record<string, unknown>;
  if (Array.isArray(resultAny.usages)) {
    const usages = resultAny.usages as unknown[];
    for (const u of usages) {
      if (typeof u === "object" && u !== null) {
        totalInput += safeInt((u as Record<string, unknown>).tokens ?? (u as Record<string, unknown>).totalTokens);
      }
    }
    totalTokensAll = totalInput;
  }

  const cost = (totalInput / 1_000_000) * tracking.modelConfig.costPer1mInput;

  recordUsageEvent({
    providerName: tracking.providerName,
    modelId: tracking.modelId,
    modelName: tracking.modelName,
    purpose: tracking.purpose,
    inputTokens: totalInput,
    outputTokens: 0,
    totalTokens: totalTokensAll,
    estimatedCostUsd: Number(cost.toFixed(8)),
    durationMs,
    isEstimated: totalInput === 0,
  });

  return result;
}
