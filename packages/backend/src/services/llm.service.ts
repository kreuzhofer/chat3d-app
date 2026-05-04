import { NoOutputGeneratedError, streamText, generateText } from "ai";
import { trackedGenerateText } from "./tracked-llm.service.js";
import { recordUsageEvent, type LlmPurpose } from "./usage-tracking.service.js";
import { asQuotaError } from "../utils/llm-errors.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import { withLlmRetry } from "../utils/llm-retry.js";
import { config } from "../config.js";
import { getBuild123dReference } from "../data/build123d-api-reference.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  buildGenerateOptions,
  calculateCostUsd,
  buildCacheableSystem,
  listAllModels,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { createLogger } from "../utils/logger.js";
import { CONVERSATION_SYSTEM_PROMPT } from "../prompts/system-prompts.js";
import type { ModelMessage as CoreMessage } from "ai";
import type { ConversationHistoryEntry, CollectedImage } from "./query.service.js";

const logger = createLogger("llm");

/**
 * Bedrock + Anthropic streaming usage payloads sometimes report
 * `reasoningTokens === 0` even when the model produced thinking output. When
 * reasoning text is available (either streamed reasoning-delta chars or the
 * resolved `reasoningText` string), estimate ~4 chars/token so the stored
 * usage record reflects the actual work done. Falls back to the raw value
 * when no reasoning text was captured.
 */
function effectiveReasoningTokens(rawTokens: number, reasoningChars: number): number {
  if (rawTokens > 0) return rawTokens;
  if (reasoningChars > 0) return Math.ceil(reasoningChars / 4);
  return 0;
}

type LlmProvider = "mock" | "openai" | "anthropic" | "xai" | "deepseek" | "minimax" | "ollama";

export interface LlmModelDefinition {
  id: string;
  provider: LlmProvider;
  stage: "conversation" | "codegen";
  modelName: string;
}

export interface ConversationGenerationResult {
  text: string;
  model: LlmModelDefinition;
  usage: LlmUsageMetadata;
}

export interface CodeGenerationResult {
  code: string;
  baseFileName: string;
  model: LlmModelDefinition;
  usage: LlmUsageMetadata;
}

export interface LlmUsageMetadata {
  source: "provider" | "estimated";
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  estimatedCostUsd: number;
}


export class LlmServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
  ) {
    super(message);
  }
}

// ── Thinking-block stripping ────────────────────────────────────────
// Some models (e.g. Qwen) emit <think>...</think> as plain text rather than
// using the SDK's structured reasoning. These helpers strip thinking blocks
// from both full text and streaming token flows.

/** Strip all `<think>...</think>` blocks from a complete text string. */
export function stripThinkingBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

/**
 * Stateful streaming filter that suppresses `<think>...</think>` blocks.
 * Tokens inside a thinking block are silently consumed; tokens outside are forwarded.
 * Call `flush()` after the stream ends to emit any remaining buffered content.
 */
export class ThinkingBlockFilter {
  private insideThink = false;
  private buffer = "";
  private readonly downstream: (token: string) => void;

  constructor(downstream: (token: string) => void) {
    this.downstream = downstream;
  }

  push(token: string): void {
    this.buffer += token;
    this.drain();
  }

  flush(): void {
    if (!this.insideThink && this.buffer.length > 0) {
      this.downstream(this.buffer);
      this.buffer = "";
    }
  }

  private drain(): void {
    while (this.buffer.length > 0) {
      if (this.insideThink) {
        const endIdx = this.buffer.indexOf("</think>");
        if (endIdx !== -1) {
          this.buffer = this.buffer.slice(endIdx + "</think>".length).replace(/^\s+/, "");
          this.insideThink = false;
        } else {
          // Still inside — keep last 7 chars in case "</think>" is split across tokens
          if (this.buffer.length > 7) {
            this.buffer = this.buffer.slice(-7);
          }
          return;
        }
      } else {
        const startIdx = this.buffer.indexOf("<think>");
        if (startIdx !== -1) {
          if (startIdx > 0) {
            this.downstream(this.buffer.slice(0, startIdx));
          }
          this.buffer = this.buffer.slice(startIdx + "<think>".length);
          this.insideThink = true;
        } else {
          // No tag — emit everything except last 6 chars (in case "<think>" is split)
          if (this.buffer.length > 6) {
            this.downstream(this.buffer.slice(0, -6));
            this.buffer = this.buffer.slice(-6);
          }
          return;
        }
      }
    }
  }
}

function sanitizeBaseFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "generated-model";
}

export function extractExecutableCode(raw: string): string {
  const cleaned = stripThinkingBlocks(raw);
  const fencedCodeBlock =
    cleaned.match(/```python\s*([\s\S]*?)```/i) ??
    cleaned.match(/```py\s*([\s\S]*?)```/i) ??
    cleaned.match(/```\s*([\s\S]*?)```/i);

  if (fencedCodeBlock?.[1]) {
    return fencedCodeBlock[1].trim();
  }

  return cleaned.trim();
}

/**
 * Map stage name to DB purpose name.
 */
function stageToPurpose(stage: "conversation" | "codegen"): string {
  return stage === "conversation" ? "conversation" : "agent_codegen";
}

/**
 * Resolve the model for a given stage from the DB-driven config.
 * Returns both the LlmModelDefinition (for backward compat) and the resolved LlmModelConfig.
 */
async function resolveModelForStage(stage: "conversation" | "codegen"): Promise<{ def: LlmModelDefinition; cfg: LlmModelConfig }> {
  if (config.query.llmMode !== "live") {
    const def: LlmModelDefinition = {
      id: `${stage}-mock`,
      provider: "mock",
      stage,
      modelName: stage === "conversation" ? "mock-conversation" : "mock-codegen",
    };
    // Return a dummy config for mock mode
    return {
      def,
      cfg: {
        id: "mock",
        provider: "mock",
        modelName: def.modelName,
        displayName: def.modelName,
        label: `mock/${def.modelName}`,
        costPer1mInput: 0,
        costPer1mOutput: 0,
        maxOutputTokens: null,
        maxContextTokens: null,
        supportsThinking: false,
        thinkingEffort: null,
        supportsVision: false,
        supportsEmbeddings: false,
        endpointUrl: null,
        apiKey: null,
        maxConcurrent: null,
      },
    };
  }

  const purpose = stageToPurpose(stage);
  const cfg = await getModelForPurpose(purpose);
  const def: LlmModelDefinition = {
    id: `${stage}-${cfg.provider}-${cfg.modelName}`,
    provider: cfg.provider as LlmProvider,
    stage,
    modelName: cfg.modelName,
  };
  return { def, cfg };
}

interface ProviderGenerationResult {
  text: string;
  usageRaw: unknown;
}

function toSafePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : null;
}

function extractTokenUsage(value: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
} {
  if (typeof value !== "object" || value === null) {
    return {
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: null,
    };
  }

  const usage = value as Record<string, unknown>;
  const inputTokens = toSafePositiveInteger(usage.inputTokens ?? usage.promptTokens ?? usage.input_tokens);
  const outputTokens = toSafePositiveInteger(
    usage.outputTokens ?? usage.completionTokens ?? usage.output_tokens,
  );
  const reasoningTokens = toSafePositiveInteger(usage.reasoningTokens ?? usage.reasoning_tokens);
  const totalTokens = toSafePositiveInteger(usage.totalTokens ?? usage.total_tokens);

  // Extract cache token details from Vercel AI SDK v6 usage object
  const details = typeof usage.inputTokenDetails === "object" && usage.inputTokenDetails !== null
    ? usage.inputTokenDetails as Record<string, unknown>
    : null;
  const cacheReadTokens = details ? toSafePositiveInteger(details.cacheReadTokens ?? details.cachedTokens) : null;
  const cacheWriteTokens = details ? toSafePositiveInteger(details.cacheWriteTokens ?? details.cacheCreationTokens) : null;

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
  };
}

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function buildUsageMetadata(input: {
  model: LlmModelDefinition;
  modelConfig?: LlmModelConfig;
  prompt: string;
  outputText: string;
  providerUsageRaw: unknown;
}): LlmUsageMetadata {
  const providerUsage = extractTokenUsage(input.providerUsageRaw);

  const estimatedInput = estimateTokens(input.prompt);
  const estimatedOutput = estimateTokens(input.outputText);
  const estimatedTotal = estimatedInput + estimatedOutput;

  const inputTokens = providerUsage.inputTokens ?? estimatedInput;
  const outputTokens = providerUsage.outputTokens ?? estimatedOutput;
  const reasoningTokens = providerUsage.reasoningTokens ?? 0;
  const cacheReadTokens = providerUsage.cacheReadTokens ?? 0;
  const cacheWriteTokens = providerUsage.cacheWriteTokens ?? 0;
  const totalTokens = providerUsage.totalTokens ?? inputTokens + outputTokens;

  // Use DB-driven pricing if config is available, otherwise fall back to 0
  const estimatedCostUsd = input.modelConfig
    ? calculateCostUsd(input.modelConfig, inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens)
    : 0;

  const result: LlmUsageMetadata = {
    source:
      providerUsage.inputTokens !== null ||
      providerUsage.outputTokens !== null ||
      providerUsage.totalTokens !== null
        ? "provider"
        : "estimated",
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens: totalTokens > 0 ? totalTokens : estimatedTotal,
    estimatedCostUsd,
  };

  if (cacheReadTokens > 0) result.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens > 0) result.cacheWriteTokens = cacheWriteTokens;

  return result;
}

/**
 * Generate text using the DB-driven model config.
 * Wrapped with per-provider semaphore (concurrency limit) and retry (rate limit backoff).
 */
async function generateWithConfig(
  cfg: LlmModelConfig,
  prompt: string,
  abortSignal?: AbortSignal,
  system?: string,
  purpose?: LlmPurpose,
): Promise<ProviderGenerationResult> {
  const providerModel = createProviderModelFromConfig(cfg);
  const extraOpts = buildGenerateOptions(cfg);
  const cacheableSystem = system ? buildCacheableSystem(cfg.provider, system) : undefined;

  // Bedrock's synchronous InvokeModel API does not support thinking/reasoning.
  // When thinking is enabled for a Bedrock model, use streamText (which calls
  // InvokeModelWithResponseStream) and collect the full output instead.
  const useFallbackStream = cfg.provider === "bedrock" && cfg.supportsThinking && cfg.thinkingEffort;

  logger.info(
    { provider: cfg.provider, model: cfg.modelName, thinkingEffort: cfg.thinkingEffort, supportsThinking: cfg.supportsThinking, useFallbackStream, extraOpts, hasCacheableSystem: !!cacheableSystem && typeof cacheableSystem !== "string" },
    "generateText call options",
  );

  const semaphore = getLlmSemaphore(cfg.provider, cfg.maxConcurrent);
  return semaphore.run(() =>
    withLlmRetry(async () => {
      let text: string;
      let reasoningText: string | undefined;
      let reasoning: unknown[] | undefined;
      let usage: unknown;

      if (useFallbackStream) {
        // Use streamText via fullStream to work around Bedrock synchronous API limitation
        // and track both reasoning and text progress.
        const stream = streamText({
          model: providerModel,
          prompt,
          abortSignal,
          ...(cacheableSystem ? { system: cacheableSystem } : {}),
          ...extraOpts,
        });

        let fullText = "";
        let reasoningChars = 0;
        let lastLogLen = 0;
        let phase: "thinking" | "generating" = "thinking";
        // Capture usage from finish-step event (Bedrock streaming doesn't propagate usage to resolved promise — SDK v6.0.111 bug)
        let streamStepUsage: unknown;
        for await (const part of stream.fullStream) {
          if (part.type === "finish-step" && "usage" in part) {
            streamStepUsage = (part as Record<string, unknown>).usage;
          }
          if (part.type === "reasoning-delta") {
            reasoningChars += part.text.length;
            if (reasoningChars - lastLogLen >= 500) {
              lastLogLen = reasoningChars;
              logger.debug({ provider: cfg.provider, model: cfg.modelName, reasoningChars }, "thinking progress");
            }
          } else if (part.type === "text-delta") {
            if (phase === "thinking") {
              phase = "generating";
              lastLogLen = 0;
              logger.info({ provider: cfg.provider, model: cfg.modelName, totalReasoningChars: reasoningChars }, "thinking complete, generating text");
            }
            fullText += part.text;
            if (fullText.length - lastLogLen >= 500) {
              lastLogLen = fullText.length;
              logger.debug({ provider: cfg.provider, model: cfg.modelName, chars: fullText.length }, "text streaming progress");
            }
          }
        }
        logger.info({ provider: cfg.provider, model: cfg.modelName, reasoningChars, textChars: fullText.length }, "streaming complete");

        let finalResult;
        try {
          finalResult = await stream;
        } catch (err) {
          if (err instanceof NoOutputGeneratedError) {
            throw new LlmServiceError("LLM returned empty output (no text generated)", 502);
          }
          throw err;
        }

        text = fullText;
        reasoningText = await finalResult.reasoningText;
        reasoning = await finalResult.reasoning;
        // Workaround: Bedrock streaming via AI SDK v6.0.111 doesn't propagate usage to the resolved promise.
        // Fall back to usage captured from the finish-step stream event.
        const resolvedUsage = await finalResult.usage;
        const hasResolvedUsage = resolvedUsage && Object.keys(resolvedUsage).length > 0 && (resolvedUsage as Record<string, unknown>).inputTokens != null;
        usage = hasResolvedUsage ? resolvedUsage : (streamStepUsage ?? resolvedUsage);
        if (!hasResolvedUsage && streamStepUsage) {
          logger.debug({ provider: cfg.provider, model: cfg.modelName }, "using finish-step usage (resolved promise usage was empty)");
        }
        // Record usage for Bedrock fallback stream
        if (purpose) {
          const su = extractTokenUsage(usage);
          const rt = effectiveReasoningTokens(su.reasoningTokens ?? 0, reasoningChars);
          recordUsageEvent({
            providerName: cfg.provider,
            modelId: cfg.id,
            modelName: cfg.modelName,
            purpose,
            inputTokens: su.inputTokens ?? 0,
            outputTokens: su.outputTokens ?? 0,
            reasoningTokens: rt,
            cacheReadTokens: su.cacheReadTokens ?? 0,
            cacheWriteTokens: su.cacheWriteTokens ?? 0,
            totalTokens: su.totalTokens ?? 0,
            estimatedCostUsd: calculateCostUsd(cfg, su.inputTokens ?? 0, su.outputTokens ?? 0, rt, su.cacheReadTokens ?? 0, su.cacheWriteTokens ?? 0),
            isEstimated: (su.reasoningTokens ?? 0) === 0 && reasoningChars > 0,
          });
        }
      } else {
        const result = await trackedGenerateText(
          {
            model: providerModel,
            prompt,
            abortSignal,
            ...(cacheableSystem ? { system: cacheableSystem } : {}),
            ...extraOpts,
          },
          {
            purpose: purpose ?? "codegen",
            providerName: cfg.provider,
            modelId: cfg.id,
            modelName: cfg.modelName,
            modelConfig: cfg,
          },
        );

        text = result.text;
        reasoningText = result.reasoningText;
        reasoning = result.reasoning;
        usage = result.usage;
      }

      // Log cache metrics when available
      const cacheUsage = extractTokenUsage(usage);
      if (cacheUsage.cacheReadTokens || cacheUsage.cacheWriteTokens) {
        logger.info(
          { provider: cfg.provider, model: cfg.modelName, cacheRead: cacheUsage.cacheReadTokens, cacheWrite: cacheUsage.cacheWriteTokens },
          "prompt cache metrics",
        );
      }

      if (reasoningText) {
        logger.info(
          { provider: cfg.provider, model: cfg.modelName, reasoningLength: reasoningText.length },
          "thinking output received",
        );
        logger.trace(
          { provider: cfg.provider, model: cfg.modelName, reasoning: reasoningText },
          "thinking output content",
        );
      } else {
        logger.debug(
          { provider: cfg.provider, model: cfg.modelName, reasoningBlocks: (reasoning as unknown[])?.length ?? 0 },
          "no thinking output in response",
        );
      }

      const cleanedText = stripThinkingBlocks(text);
      if (!cleanedText) {
        throw new LlmServiceError("LLM returned empty output", 502);
      }

      return {
        text: cleanedText,
        usageRaw: usage,
      };
    }, { provider: cfg.provider }),
  );
}

/**
 * Generate text using the DB-driven model config with a messages array (multimodal support).
 * Used when images need to be sent alongside text prompts.
 */
async function generateWithMessages(
  cfg: LlmModelConfig,
  system: string,
  messages: CoreMessage[],
  abortSignal?: AbortSignal,
  purpose?: LlmPurpose,
): Promise<ProviderGenerationResult> {
  const providerModel = createProviderModelFromConfig(cfg);
  const extraOpts = buildGenerateOptions(cfg);
  const cacheableSystem = buildCacheableSystem(cfg.provider, system);

  logger.info(
    { provider: cfg.provider, model: cfg.modelName, messageCount: messages.length, hasCacheableSystem: typeof cacheableSystem !== "string" },
    "generateText (messages) call",
  );

  const semaphore = getLlmSemaphore(cfg.provider, cfg.maxConcurrent);
  return semaphore.run(() =>
    withLlmRetry(async () => {
      const result = await trackedGenerateText(
        {
          model: providerModel,
          system: cacheableSystem,
          messages,
          abortSignal,
          ...extraOpts,
        },
        {
          purpose: purpose ?? "conversation",
          providerName: cfg.provider,
          modelId: cfg.id,
          modelName: cfg.modelName,
          modelConfig: cfg,
        },
      );

      // Log cache metrics when available
      const cacheUsage = extractTokenUsage(result.usage);
      if (cacheUsage.cacheReadTokens || cacheUsage.cacheWriteTokens) {
        logger.info(
          { provider: cfg.provider, model: cfg.modelName, cacheRead: cacheUsage.cacheReadTokens, cacheWrite: cacheUsage.cacheWriteTokens },
          "prompt cache metrics",
        );
      }

      const cleanedText = stripThinkingBlocks(result.text);
      if (!cleanedText) {
        throw new LlmServiceError("LLM returned empty output", 502);
      }

      return {
        text: cleanedText,
        usageRaw: result.usage,
      };
    }, { provider: cfg.provider }),
  );
}

/**
 * Stream text using the DB-driven model config with a messages array (multimodal support).
 * Used when images need to be sent alongside text prompts.
 */
async function streamWithMessages(
  cfg: LlmModelConfig,
  system: string,
  messages: CoreMessage[],
  onToken: (token: string) => void,
  abortSignal?: AbortSignal,
  purpose?: LlmPurpose,
): Promise<ProviderGenerationResult> {
  const providerModel = createProviderModelFromConfig(cfg);
  const extraOpts = buildGenerateOptions(cfg);
  const cacheableSystem = buildCacheableSystem(cfg.provider, system);

  logger.info(
    { provider: cfg.provider, model: cfg.modelName, messageCount: messages.length, hasCacheableSystem: typeof cacheableSystem !== "string" },
    "streamText (messages) call",
  );

  const semaphore = getLlmSemaphore(cfg.provider, cfg.maxConcurrent);
  return semaphore.run(async () => {
    try {
      // Non-streaming fallback for models that don't support streaming
      if (cfg.streamingEnabled === false) {
        logger.info({ provider: cfg.provider, model: cfg.modelName }, "using non-streaming generateText (streaming disabled)");
        const genResult = await generateText({
          model: providerModel,
          system: cacheableSystem,
          messages,
          abortSignal,
          ...extraOpts,
        });
        const text = genResult.text ?? "";
        onToken(text); // emit full text at once
        const effectiveUsage = genResult.usage;
        const cacheUsage = extractTokenUsage(effectiveUsage);
        const reasoningChars = (genResult.reasoningText ?? "").length;
        const rt = effectiveReasoningTokens(cacheUsage.reasoningTokens ?? 0, reasoningChars);
        if (purpose) {
          recordUsageEvent({
            providerName: cfg.provider, modelId: cfg.id, modelName: cfg.modelName, purpose,
            inputTokens: cacheUsage.inputTokens ?? 0, outputTokens: cacheUsage.outputTokens ?? 0,
            reasoningTokens: rt, cacheReadTokens: cacheUsage.cacheReadTokens ?? 0,
            cacheWriteTokens: cacheUsage.cacheWriteTokens ?? 0, totalTokens: cacheUsage.totalTokens ?? 0,
            estimatedCostUsd: calculateCostUsd(cfg, cacheUsage.inputTokens ?? 0, cacheUsage.outputTokens ?? 0, rt, cacheUsage.cacheReadTokens ?? 0, cacheUsage.cacheWriteTokens ?? 0),
            isEstimated: (cacheUsage.reasoningTokens ?? 0) === 0 && reasoningChars > 0,
          });
        }
        const cleanedText = stripThinkingBlocks(text);
        if (cleanedText === "") throw new LlmServiceError("LLM returned empty output", 502);
        return { text: cleanedText, usageRaw: effectiveUsage };
      }

      // Streaming path
      const result = streamText({
        model: providerModel,
        system: cacheableSystem,
        messages,
        abortSignal,
        ...extraOpts,
      });

      let fullText = "";
      let reasoningChars = 0;
      const thinkFilter = new ThinkingBlockFilter(onToken);
      let streamStepUsage: unknown;
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          fullText += part.text;
          thinkFilter.push(part.text);
        } else if (part.type === "reasoning-delta") {
          reasoningChars += (part as { text?: string }).text?.length ?? 0;
        } else if (part.type === "finish-step" && "usage" in part) {
          streamStepUsage = (part as Record<string, unknown>).usage;
        }
      }
      thinkFilter.flush();

      let finalResult;
      try {
        finalResult = await result;
      } catch (awaitError) {
        if (awaitError instanceof NoOutputGeneratedError) {
          throw new LlmServiceError("LLM returned empty output (no text generated)", 502);
        }
        throw awaitError;
      }

      const resolvedUsage = await finalResult.usage;
      const hasResolvedUsage = resolvedUsage && Object.keys(resolvedUsage).length > 0 && (resolvedUsage as Record<string, unknown>).inputTokens != null;
      const effectiveUsage = hasResolvedUsage ? resolvedUsage : (streamStepUsage ?? resolvedUsage);
      if (!hasResolvedUsage && streamStepUsage) {
        logger.debug({ provider: cfg.provider, model: cfg.modelName }, "using finish-step usage (resolved promise usage was empty)");
      }

      // Log cache metrics when available
      const cacheUsage = extractTokenUsage(effectiveUsage);
      if (cacheUsage.cacheReadTokens || cacheUsage.cacheWriteTokens) {
        logger.info(
          { provider: cfg.provider, model: cfg.modelName, cacheRead: cacheUsage.cacheReadTokens, cacheWrite: cacheUsage.cacheWriteTokens },
          "prompt cache metrics",
        );
      }

      const rt = effectiveReasoningTokens(cacheUsage.reasoningTokens ?? 0, reasoningChars);
      // Record usage event for streaming call
      if (purpose) {
        recordUsageEvent({
          providerName: cfg.provider,
          modelId: cfg.id,
          modelName: cfg.modelName,
          purpose,
          inputTokens: cacheUsage.inputTokens ?? 0,
          outputTokens: cacheUsage.outputTokens ?? 0,
          reasoningTokens: rt,
          cacheReadTokens: cacheUsage.cacheReadTokens ?? 0,
          cacheWriteTokens: cacheUsage.cacheWriteTokens ?? 0,
          totalTokens: cacheUsage.totalTokens ?? 0,
          estimatedCostUsd: calculateCostUsd(cfg, cacheUsage.inputTokens ?? 0, cacheUsage.outputTokens ?? 0, rt, cacheUsage.cacheReadTokens ?? 0, cacheUsage.cacheWriteTokens ?? 0),
          isEstimated: (cacheUsage.reasoningTokens ?? 0) === 0 && reasoningChars > 0,
        });
      }

      const cleanedText = stripThinkingBlocks(fullText);
      if (cleanedText === "") {
        throw new LlmServiceError("LLM returned empty output", 502);
      }

      return {
        text: cleanedText,
        usageRaw: effectiveUsage,
      };
    } catch (error) {
      if (error instanceof NoOutputGeneratedError) {
        throw new LlmServiceError("LLM returned empty output (no text generated)", 502);
      }
      const quotaError = asQuotaError(error, cfg.provider);
      if (quotaError) throw quotaError;
      throw error;
    }
  });
}

/**
 * Stream text using the DB-driven model config.
 * Wrapped with per-provider semaphore (concurrency limit).
 * No retry for streaming — rate limit errors are returned before tokens flow,
 * and mid-stream errors are not safely retryable.
 */
async function streamWithConfig(
  cfg: LlmModelConfig,
  prompt: string,
  onToken: (token: string) => void,
  abortSignal?: AbortSignal,
  system?: string,
  purpose?: LlmPurpose,
): Promise<ProviderGenerationResult> {
  const providerModel = createProviderModelFromConfig(cfg);
  const extraOpts = buildGenerateOptions(cfg);
  const cacheableSystem = system ? buildCacheableSystem(cfg.provider, system) : undefined;

  logger.info(
    { provider: cfg.provider, model: cfg.modelName, thinkingEffort: cfg.thinkingEffort, supportsThinking: cfg.supportsThinking, extraOpts, hasCacheableSystem: !!cacheableSystem && typeof cacheableSystem !== "string" },
    "streamText call options",
  );

  const semaphore = getLlmSemaphore(cfg.provider, cfg.maxConcurrent);
  return semaphore.run(async () => {
    try {
      // Non-streaming fallback for models that don't support streaming
      if (cfg.streamingEnabled === false) {
        logger.info({ provider: cfg.provider, model: cfg.modelName }, "using non-streaming generateText (streaming disabled)");
        const genResult = await generateText({
          model: providerModel,
          prompt,
          abortSignal,
          ...(cacheableSystem ? { system: cacheableSystem } : {}),
          ...extraOpts,
        });
        const text = genResult.text ?? "";
        onToken(text);
        const effectiveUsage = genResult.usage;
        const cacheUsage = extractTokenUsage(effectiveUsage);
        const reasoningChars = (genResult.reasoningText ?? "").length;
        const rt = effectiveReasoningTokens(cacheUsage.reasoningTokens ?? 0, reasoningChars);
        if (purpose) {
          recordUsageEvent({
            providerName: cfg.provider, modelId: cfg.id, modelName: cfg.modelName, purpose,
            inputTokens: cacheUsage.inputTokens ?? 0, outputTokens: cacheUsage.outputTokens ?? 0,
            reasoningTokens: rt, cacheReadTokens: cacheUsage.cacheReadTokens ?? 0,
            cacheWriteTokens: cacheUsage.cacheWriteTokens ?? 0, totalTokens: cacheUsage.totalTokens ?? 0,
            estimatedCostUsd: calculateCostUsd(cfg, cacheUsage.inputTokens ?? 0, cacheUsage.outputTokens ?? 0, rt, cacheUsage.cacheReadTokens ?? 0, cacheUsage.cacheWriteTokens ?? 0),
            isEstimated: (cacheUsage.reasoningTokens ?? 0) === 0 && reasoningChars > 0,
          });
        }
        const cleanedText = stripThinkingBlocks(text);
        if (cleanedText === "") throw new LlmServiceError("LLM returned empty output", 502);
        return { text: cleanedText, usageRaw: effectiveUsage, reasoningText: genResult.reasoningText };
      }

      // Streaming path
      const result = streamText({
        model: providerModel,
        prompt,
        abortSignal,
        ...(cacheableSystem ? { system: cacheableSystem } : {}),
        ...extraOpts,
      });

      let fullText = "";
      const thinkFilter = new ThinkingBlockFilter(onToken);
      let streamStepUsage: unknown;
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          fullText += part.text;
          thinkFilter.push(part.text);
        } else if (part.type === "finish-step" && "usage" in part) {
          streamStepUsage = (part as Record<string, unknown>).usage;
        }
      }
      thinkFilter.flush();

      let finalResult;
      try {
        finalResult = await result;
      } catch (awaitError) {
        if (awaitError instanceof NoOutputGeneratedError) {
          throw new LlmServiceError("LLM returned empty output (no text generated)", 502);
        }
        throw awaitError;
      }

      const awaitedReasoningText = await finalResult.reasoningText;
      const awaitedReasoning = await finalResult.reasoning;
      if (awaitedReasoningText) {
        logger.info(
          { provider: cfg.provider, model: cfg.modelName, reasoningLength: awaitedReasoningText.length },
          "thinking output received",
        );
        logger.trace(
          { provider: cfg.provider, model: cfg.modelName, reasoning: awaitedReasoningText },
          "thinking output content",
        );
      } else {
        logger.debug(
          { provider: cfg.provider, model: cfg.modelName, reasoningBlocks: awaitedReasoning?.length ?? 0 },
          "no thinking output in response",
        );
      }

      // Workaround: use finish-step usage when resolved promise usage is empty
      const resolvedUsage = await finalResult.usage;
      const hasResolvedUsage = resolvedUsage && Object.keys(resolvedUsage).length > 0 && (resolvedUsage as Record<string, unknown>).inputTokens != null;
      const effectiveUsage = hasResolvedUsage ? resolvedUsage : (streamStepUsage ?? resolvedUsage);
      if (!hasResolvedUsage && streamStepUsage) {
        logger.debug({ provider: cfg.provider, model: cfg.modelName }, "using finish-step usage (resolved promise usage was empty)");
      }

      // Log cache metrics when available
      const cacheUsage = extractTokenUsage(effectiveUsage);
      if (cacheUsage.cacheReadTokens || cacheUsage.cacheWriteTokens) {
        logger.info(
          { provider: cfg.provider, model: cfg.modelName, cacheRead: cacheUsage.cacheReadTokens, cacheWrite: cacheUsage.cacheWriteTokens },
          "prompt cache metrics",
        );
      }

      const reasoningCharsResolved = (awaitedReasoningText ?? "").length;
      const rt = effectiveReasoningTokens(cacheUsage.reasoningTokens ?? 0, reasoningCharsResolved);
      // Record usage event for streaming call
      if (purpose) {
        recordUsageEvent({
          providerName: cfg.provider,
          modelId: cfg.id,
          modelName: cfg.modelName,
          purpose,
          inputTokens: cacheUsage.inputTokens ?? 0,
          outputTokens: cacheUsage.outputTokens ?? 0,
          reasoningTokens: rt,
          cacheReadTokens: cacheUsage.cacheReadTokens ?? 0,
          cacheWriteTokens: cacheUsage.cacheWriteTokens ?? 0,
          totalTokens: cacheUsage.totalTokens ?? 0,
          estimatedCostUsd: calculateCostUsd(cfg, cacheUsage.inputTokens ?? 0, cacheUsage.outputTokens ?? 0, rt, cacheUsage.cacheReadTokens ?? 0, cacheUsage.cacheWriteTokens ?? 0),
          isEstimated: (cacheUsage.reasoningTokens ?? 0) === 0 && reasoningCharsResolved > 0,
        });
      }

      const cleanedText = stripThinkingBlocks(fullText);
      if (cleanedText === "") {
        throw new LlmServiceError("LLM returned empty output", 502);
      }

      return {
        text: cleanedText,
        usageRaw: effectiveUsage,
      };
    } catch (error) {
      if (error instanceof NoOutputGeneratedError) {
        throw new LlmServiceError("LLM returned empty output (no text generated)", 502);
      }
      const quotaError = asQuotaError(error, cfg.provider);
      if (quotaError) throw quotaError;
      throw error;
    }
  });
}

export async function listLlmModels(): Promise<LlmModelDefinition[]> {
  const dbModels = await listAllModels();
  const activeModels = dbModels.filter((m) => m.is_active);

  return (["conversation", "codegen"] as const).flatMap((stage) =>
    activeModels.map((m) => ({
      id: `${stage}-${m.provider}-${m.model_name}`,
      provider: m.provider as LlmProvider,
      stage,
      modelName: m.model_name,
    })),
  );
}

/**
 * Format conversation history entries into a text block for LLM prompts.
 * Returns empty string if no history is available.
 */
export function formatConversationHistory(history?: ConversationHistoryEntry[]): string {
  if (!history || history.length === 0) return "";

  const lines = ["## Conversation History"];
  for (const entry of history) {
    const roleLabel = entry.role === "user" ? "User" : "Assistant";
    lines.push(`[${entry.sequencePosition}] ${roleLabel}: ${entry.text}`);
    if (entry.code) {
      lines.push("```python", entry.code, "```");
    }
  }
  return lines.join("\n");
}

/**
 * Find the most recent Build123d code from conversation history.
 * Used as the baseline for modification in codegen prompts.
 */
export function findMostRecentCode(history?: ConversationHistoryEntry[]): string | undefined {
  if (!history || history.length === 0) return undefined;
  // Walk backwards to find the most recent assistant entry with code
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant" && history[i].code) {
      return history[i].code;
    }
  }
  return undefined;
}

/**
 * Build a multimodal user content array from text prompt and images.
 * Follows the Vercel AI SDK pattern: array of {type: "text"} and {type: "image"} parts.
 */
export function buildMultimodalUserContent(
  textPrompt: string,
  images: CollectedImage[],
): Array<{ type: "text"; text: string } | { type: "image"; image: string }> {
  const content: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [];

  // Add images first so the model sees them before reading the text prompt
  for (const img of images) {
    content.push({ type: "text", text: `[Attached image: ${img.filename}]` });
    content.push({ type: "image", image: img.base64 });
  }

  content.push({ type: "text", text: textPrompt });
  return content;
}

function buildConversationPrompt(input: {
  prompt: string;
  contextName: string;
  conversationHistory?: ConversationHistoryEntry[];
}): string {
  const historyBlock = formatConversationHistory(input.conversationHistory);
  return [
    CONVERSATION_SYSTEM_PROMPT,
    `Chat context: ${input.contextName}`,
    historyBlock,
    `User request: ${input.prompt}`,
  ].filter(Boolean).join("\n\n");
}

/**
 * Build conversation prompt data for multimodal (vision) calls.
 * Returns a system prompt and a messages array with images.
 */
function buildConversationMultimodal(input: {
  prompt: string;
  contextName: string;
  conversationHistory?: ConversationHistoryEntry[];
  images: CollectedImage[];
}): { system: string; messages: CoreMessage[] } {
  const historyBlock = formatConversationHistory(input.conversationHistory);
  const system = CONVERSATION_SYSTEM_PROMPT;

  const textPrompt = [
    `Chat context: ${input.contextName}`,
    historyBlock,
    `User request: ${input.prompt}`,
  ].filter(Boolean).join("\n\n");

  const userContent = buildMultimodalUserContent(textPrompt, input.images);

  return {
    system,
    messages: [{ role: "user" as const, content: userContent }],
  };
}

/**
 * Parse the conversation response to extract the codegen decision tag and clean text.
 * Returns { needsCodegen: boolean, text: string } where text has the tag stripped.
 */
export function parseConversationResponse(raw: string): { needsCodegen: boolean; text: string } {
  const trimmed = stripThinkingBlocks(raw);
  if (trimmed.startsWith("[CODEGEN_NEEDED]")) {
    return { needsCodegen: true, text: trimmed.slice("[CODEGEN_NEEDED]".length).trim() };
  }
  if (trimmed.startsWith("[CHAT_ONLY]")) {
    return { needsCodegen: false, text: trimmed.slice("[CHAT_ONLY]".length).trim() };
  }
  // Default to chat-only if the LLM didn't follow instructions — safer to skip codegen
  // than to trigger an unwanted model generation for a conversational question.
  return { needsCodegen: false, text: trimmed };
}

export async function generateConversationText(input: {
  prompt: string;
  contextName: string;
  conversationHistory?: ConversationHistoryEntry[];
  images?: CollectedImage[];
  abortSignal?: AbortSignal;
}): Promise<ConversationGenerationResult> {
  const { def: model, cfg: modelCfg } = await resolveModelForStage("conversation");
  const prompt = buildConversationPrompt(input);
  const useVision = (input.images?.length ?? 0) > 0 && modelCfg.supportsVision;

  if (model.provider === "mock") {
    const text = `[CODEGEN_NEEDED]\nMock assistant response for context "${input.contextName}": ${input.prompt}`;
    return {
      model,
      text,
      usage: buildUsageMetadata({
        model,
        modelConfig: modelCfg,
        prompt,
        outputText: text,
        providerUsageRaw: null,
      }),
    };
  }

  if (useVision) {
    logger.info({ imageCount: input.images!.length, model: modelCfg.modelName }, "using multimodal conversation call");
    const { system, messages } = buildConversationMultimodal({
      ...input,
      images: input.images!,
    });
    const result = await generateWithMessages(modelCfg, system, messages, input.abortSignal, "conversation");
    return {
      model,
      text: result.text,
      usage: buildUsageMetadata({
        model,
        modelConfig: modelCfg,
        prompt,
        outputText: result.text,
        providerUsageRaw: result.usageRaw,
      }),
    };
  }

  const result = await generateWithConfig(modelCfg, prompt, input.abortSignal, undefined, "conversation");

  return {
    model,
    text: result.text,
    usage: buildUsageMetadata({
      model,
      modelConfig: modelCfg,
      prompt,
      outputText: result.text,
      providerUsageRaw: result.usageRaw,
    }),
  };
}

export async function generateConversationTextStream(input: {
  prompt: string;
  contextName: string;
  onToken: (token: string) => void;
  conversationHistory?: ConversationHistoryEntry[];
  images?: CollectedImage[];
  abortSignal?: AbortSignal;
}): Promise<ConversationGenerationResult> {
  const { def: model, cfg: modelCfg } = await resolveModelForStage("conversation");
  const prompt = buildConversationPrompt(input);
  const useVision = (input.images?.length ?? 0) > 0 && modelCfg.supportsVision;

  if (model.provider === "mock") {
    const text = `[CODEGEN_NEEDED]\nMock assistant response for context "${input.contextName}": ${input.prompt}`;
    // Simulate streaming by emitting the mock response word by word
    for (const word of text.split(" ")) {
      input.onToken(word + " ");
    }
    return {
      model,
      text,
      usage: buildUsageMetadata({
        model,
        modelConfig: modelCfg,
        prompt,
        outputText: text,
        providerUsageRaw: null,
      }),
    };
  }

  if (useVision) {
    logger.info({ imageCount: input.images!.length, model: modelCfg.modelName }, "using multimodal streaming conversation call");
    const { system, messages } = buildConversationMultimodal({
      ...input,
      images: input.images!,
    });
    const result = await streamWithMessages(modelCfg, system, messages, input.onToken, input.abortSignal, "conversation");
    return {
      model,
      text: result.text,
      usage: buildUsageMetadata({
        model,
        modelConfig: modelCfg,
        prompt,
        outputText: result.text,
        providerUsageRaw: result.usageRaw,
      }),
    };
  }

  const result = await streamWithConfig(modelCfg, prompt, input.onToken, input.abortSignal, undefined, "conversation");

  return {
    model,
    text: result.text,
    usage: buildUsageMetadata({
      model,
      modelConfig: modelCfg,
      prompt,
      outputText: result.text,
      providerUsageRaw: result.usageRaw,
    }),
  };
}

/**
 * Build codegen prompt as separate system and user content parts.
 * System = static Build123d API reference + instructions (cacheable).
 * User content = dynamic parts (baseline code, history, requirements, user request).
 */
export function buildCodegenPromptParts(
  baseFileName: string,
  userPrompt: string,
  conversationText: string,
  conversationHistory?: ConversationHistoryEntry[],
): { system: string; userContent: string } {
  const { entries, examples } = getBuild123dReference();

  const classReference = entries
    .map((e) => `  - ${e.className}: ${e.signature} — ${e.description}`)
    .join("\n");

  const exampleSnippets = examples
    .map((ex) => `### ${ex.operation}: ${ex.description}\n\`\`\`python\n${ex.code}\n\`\`\``)
    .join("\n\n");

  // Static system prompt — cacheable across calls
  const systemSections = [
    "Generate valid Python build123d code.",
    "",
    "## Build123d API Reference — Available Classes and Functions",
    classReference,
    "",
    "## Example Code Snippets",
    exampleSnippets,
    "",
    "Use ONLY the classes and functions listed above. Do NOT invent or hallucinate classes that are not in this reference.",
  ];

  // Dynamic user content — changes per request
  const userSections: string[] = [];

  // Include most recent code as baseline for modification (Req 10.3, 11.1)
  const baselineCode = findMostRecentCode(conversationHistory);
  if (baselineCode) {
    userSections.push(
      "## Previous Code (baseline for modification)",
      "Modify this existing code based on the user's follow-up request. Preserve working parts and apply the requested changes.",
      "```python",
      baselineCode,
      "```",
      "",
    );
  }

  // Include conversation history for context (Req 10.1, 10.4)
  const historyBlock = formatConversationHistory(conversationHistory);
  if (historyBlock) {
    userSections.push(historyBlock, "");
  }

  userSections.push(
    "## Requirements",
    `- Export one STEP file with base filename ${baseFileName}.step`,
    "- Code must be executable as-is.",
    "",
    `User request: ${userPrompt}`,
    `Assistant planning notes: ${conversationText}`,
  );

  return {
    system: systemSections.join("\n"),
    userContent: userSections.join("\n"),
  };
}

/** Thin wrapper for backward compat — joins system + user content into a single string. */
export function buildCodegenPrompt(
  baseFileName: string,
  userPrompt: string,
  conversationText: string,
  conversationHistory?: ConversationHistoryEntry[],
): string {
  const { system, userContent } = buildCodegenPromptParts(baseFileName, userPrompt, conversationText, conversationHistory);
  return [system, "", userContent].join("\n");
}

export async function generateBuild123dCode(input: {
  prompt: string;
  conversationText: string;
  conversationHistory?: ConversationHistoryEntry[];
}): Promise<CodeGenerationResult> {
  const { def: model, cfg: modelCfg } = await resolveModelForStage("codegen");
  const baseFileName = sanitizeBaseFileName(input.prompt);

  const { system, userContent } = buildCodegenPromptParts(baseFileName, input.prompt, input.conversationText, input.conversationHistory);
  const fullPrompt = [system, "", userContent].join("\n");

  if (model.provider === "mock") {
    const code = `
from build123d import *
with BuildPart() as model:
    Box(20, 20, 20)
export_step(model.part, "${baseFileName}.step")
      `.trim();

    return {
      model,
      baseFileName,
      code,
      usage: buildUsageMetadata({
        model,
        modelConfig: modelCfg,
        prompt: fullPrompt,
        outputText: code,
        providerUsageRaw: null,
      }),
    };
  }

  const result = await generateWithConfig(modelCfg, userContent, undefined, system, "codegen");
  const code = extractExecutableCode(result.text);

  return {
    model,
    baseFileName,
    code,
    usage: buildUsageMetadata({
      model,
      modelConfig: modelCfg,
      prompt: fullPrompt,
      outputText: code,
      providerUsageRaw: result.usageRaw,
    }),
  };
}
