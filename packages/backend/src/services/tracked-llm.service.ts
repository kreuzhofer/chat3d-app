/**
 * Tracked LLM Wrappers
 *
 * Thin wrappers around Vercel AI SDK functions that automatically record
 * usage events after each call.
 *
 * - trackedGenerateText: non-streaming, used by most callers (spec gen, eval, etc.)
 * - trackedStreamText: streaming, used by agent codegen to keep TCP alive for slow models
 */

import { generateText, streamText, embed, embedMany, type TextStreamPart } from "ai";
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

function computeOutputTps(outputTokens: number, durationMs: number): number | undefined {
  if (outputTokens <= 0 || durationMs <= 0) return undefined;
  return Math.round((outputTokens / durationMs) * 1000 * 100) / 100;
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
 * stepMs/chunkMs are per-step safety nets. totalMs is overridable by callers
 * (e.g., pipeline timeout) — defaults to 15 min for non-agent callers. */
const DEFAULT_STEP_TIMEOUT_MS = 480_000;   // 8 min per individual LLM step
const DEFAULT_CHUNK_TIMEOUT_MS = 480_000;  // 8 min between streaming chunks (stall detection)
const DEFAULT_TOTAL_TIMEOUT_MS = 900_000;  // 15 min fallback for callers that don't specify

function buildTimeout(totalMs?: number) {
  return {
    totalMs: totalMs ?? DEFAULT_TOTAL_TIMEOUT_MS,
    stepMs: DEFAULT_STEP_TIMEOUT_MS,
    chunkMs: DEFAULT_CHUNK_TIMEOUT_MS,
  };
}

export async function trackedGenerateText(
  options: GenerateTextParams,
  tracking: TrackingMeta,
  /** Override totalMs (e.g., pass pipeline timeout). stepMs/chunkMs stay at defaults. */
  totalTimeoutMs?: number,
): Promise<GenerateTextResult> {
  const callerSignal = options.abortSignal as AbortSignal | undefined;
  const effectiveTotal = totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const timeout = buildTimeout(effectiveTotal);

  // Hard timeout per call via AbortController (safety net if SDK timeout doesn't work)
  const hardTimeoutController = new AbortController();
  const timer = setTimeout(() => {
    logger.warn({ purpose: tracking.purpose, timeoutMs: effectiveTotal }, "LLM call hard timeout — aborting");
    hardTimeoutController.abort();
  }, effectiveTotal);

  const combinedSignal = callerSignal
    ? AbortSignal.any([callerSignal, hardTimeoutController.signal])
    : hardTimeoutController.signal;

  try {
    const start = Date.now();
    const result = await generateText({
      ...options,
      timeout: options.timeout ?? timeout,
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
      outputTokensPerSecond: computeOutputTps(usage.outputTokens, durationMs),
    });

    return result;
  } finally {
    clearTimeout(timer);
  }
}

// ── trackedStreamText ─────────────────────────────────────────────

type StreamTextParams = Parameters<typeof streamText>[0];
type StreamTextReturn = ReturnType<typeof streamText>;

/**
 * Streaming wrapper for LLM calls. Keeps TCP connections alive for slow models
 * (gpt-oss-120b, Nemotron) by flowing tokens continuously. Use with
 * consumeStreamWithProgress() to drive the stream and log token progress.
 *
 * Usage recording happens in the onFinish callback (after stream completes).
 * The caller's onFinish is preserved and called after usage is recorded.
 */
export function trackedStreamText(
  options: StreamTextParams,
  tracking: TrackingMeta,
  /** Override totalMs (e.g., pass pipeline timeout). stepMs/chunkMs stay at defaults. */
  totalTimeoutMs?: number,
): StreamTextReturn {
  const callerSignal = options.abortSignal as AbortSignal | undefined;
  const effectiveTotal = totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const timeout = buildTimeout(effectiveTotal);

  const hardTimeoutController = new AbortController();
  const timer = setTimeout(() => {
    logger.warn({ purpose: tracking.purpose, timeoutMs: effectiveTotal }, "LLM stream hard timeout — aborting");
    hardTimeoutController.abort();
  }, effectiveTotal);

  const combinedSignal = callerSignal
    ? AbortSignal.any([callerSignal, hardTimeoutController.signal])
    : hardTimeoutController.signal;

  const start = Date.now();
  const userOnFinish = options.onFinish;
  const userOnError = options.onError;

  return streamText({
    ...options,
    timeout: options.timeout ?? timeout,
    abortSignal: combinedSignal,
    onError: (event) => {
      // event is { error: unknown } per SDK types
      const raw = typeof event === "object" && event !== null && "error" in event ? (event as { error: unknown }).error : event;
      const errMsg = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : JSON.stringify(raw).slice(0, 500);
      logger.error({ purpose: tracking.purpose, model: tracking.modelName, err: errMsg }, "LLM stream onError");
      userOnError?.(event);
    },
    onFinish: async (event) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const usage = extractUsage(event.totalUsage);
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
        outputTokensPerSecond: computeOutputTps(usage.outputTokens, durationMs),
      });

      await userOnFinish?.(event);
    },
  });
}

/**
 * Consume a fullStream from streamText, logging token progress at intervals.
 * Must be called to drive the tool-use loop and stream to completion.
 * Returns collected stream errors (if any) so callers can include them in traces.
 */
export async function consumeStreamWithProgress(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stream: AsyncIterable<TextStreamPart<any>>,
  meta: { purpose: string; modelName: string },
  logIntervalTokens = 500,
): Promise<{ streamErrors: string[] }> {
  let estimatedTokens = 0;
  let lastLoggedAt = 0;
  const start = Date.now();
  const streamErrors: string[] = [];

  for await (const part of stream) {
    if (part.type === "text-delta") {
      // Rough token estimate: ~4 chars per token (exact counts come via onFinish)
      const delta = (part as { delta?: string }).delta ?? "";
      estimatedTokens += Math.ceil(delta.length / 4);
      if (estimatedTokens - lastLoggedAt >= logIntervalTokens) {
        lastLoggedAt = estimatedTokens;
        logger.info(
          { purpose: meta.purpose, model: meta.modelName, estimatedTokens, elapsedMs: Date.now() - start },
          "LLM streaming progress",
        );
      }
    } else if (part.type === "error") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const partAny = part as any;
      const errorText = partAny.errorText ?? partAny.error?.message ?? partAny.error ?? JSON.stringify(part).slice(0, 500);
      streamErrors.push(String(errorText));
      logger.error(
        { purpose: meta.purpose, model: meta.modelName, errorText: String(errorText), partKeys: Object.keys(partAny), elapsedMs: Date.now() - start },
        "LLM stream error",
      );
    }
  }

  if (estimatedTokens > 0) {
    logger.debug(
      { purpose: meta.purpose, model: meta.modelName, estimatedTokens, totalMs: Date.now() - start },
      "LLM stream completed",
    );
  }

  return { streamErrors };
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
