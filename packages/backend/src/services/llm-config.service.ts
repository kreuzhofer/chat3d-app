/**
 * LLM Model & Provider Configuration Service
 *
 * DB-driven model/provider registry and purpose-based model resolution.
 * Provider settings (API keys, endpoint URLs) are stored in llm_providers.
 * Model settings (capabilities, pricing, tokens) are stored in llm_models.
 * Models reference their provider via the provider column (FK to llm_providers.name).
 */

import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { createMinimax } from "vercel-minimax-ai-provider";
import { createOllamaVisionFetch } from "./ollama-vision-fetch.js";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("llm-config");

// ── Errors ───────────────────────────────────────────────────────────

export class LlmConfigError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "LlmConfigError";
  }
}

// ── Types ────────────────────────────────────────────────────────────

/** API-facing row shape from llm_providers table (snake_case for backward compat) */
export interface LlmProviderRow {
  name: string;
  provider_type: string | null;
  display_name: string | null;
  api_key: string | null;
  endpoint_url: string | null;
  max_concurrent: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** API-facing row shape from llm_models table (snake_case for backward compat) */
export interface LlmModelRow {
  id: string;
  provider: string;
  model_name: string;
  display_name: string | null;
  cost_per_1m_input: number;
  cost_per_1m_output: number;
  max_output_tokens: number | null;
  max_context_tokens: number | null;
  supports_thinking: boolean;
  default_thinking_effort: string | null;
  supports_vision: boolean;
  supports_embeddings: boolean;
  streaming_enabled: boolean;
  vlm_eval_preamble: string | null;
  tier: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Raw row from llm_purpose_map joined with llm_models */
export interface LlmPurposeRow {
  id: string;
  purpose: string;
  model_id: string;
  override_max_output_tokens: number | null;
  override_thinking_effort: string | null;
  created_at: string;
  updated_at: string;
}

/** Resolved model configuration ready for use — overrides applied, API key resolved from provider */
export interface LlmModelConfig {
  id: string;
  provider: string;
  /** SDK type override — null means use provider name for dispatch. */
  providerType: string | null;
  modelName: string;
  displayName: string;
  label: string; // "provider/modelName" for logging
  costPer1mInput: number;
  costPer1mOutput: number;
  maxOutputTokens: number | null;
  maxContextTokens: number | null;
  supportsThinking: boolean;
  thinkingEffort: string | null;
  supportsVision: boolean;
  supportsEmbeddings: boolean;
  /** Whether the model supports streaming responses. Default true. */
  streamingEnabled: boolean;
  /** Optional preamble prepended to VLM evaluation system prompts for per-model calibration. */
  vlmEvalPreamble: string | null;
  endpointUrl: string | null;
  apiKey: string | null;
  /** Per-provider concurrency limit from DB (null = use global default). */
  maxConcurrent: number | null;
}

/** Purpose assignment joined with model details (for admin API) */
export interface PurposeAssignment {
  id: string | null;
  purpose: string;
  modelId: string | null;
  modelDisplayName: string | null;
  modelProvider: string | null;
  modelModelName: string | null;
  overrideMaxOutputTokens: number | null;
  overrideThinkingEffort: string | null;
}

// ── Valid purposes ──────────────────────────────────────────────────

export const LLM_PURPOSES = [
  "conversation",
  "agent_codegen",
  "workbench_codegen",
  "vlm_eval",
  "embedding",
  "prompt_distill",
  "tag_suggest",
  "spec_generation",
  "spec_enrichment",
  "code_review",
] as const;

export type LlmPurpose = (typeof LLM_PURPOSES)[number];

// ── Thinking budget mapping ──────────────────────────────────────────
// Effort levels map to thinking-token budgets used by Claude's
// `thinking: { type: "enabled", budgetTokens: N }` provider option.
// Both the direct Anthropic SDK and the AWS Bedrock SDK accept this
// shape (Bedrock as `reasoningConfig`). The previous "adaptive" config
// (`type: "adaptive"`, `maxReasoningEffort`) was silently dropped by
// the AI SDK Bedrock provider — see DB evidence: 0 reasoning_tokens
// across 9k+ Sonnet 4.6 events. Always use `type: "enabled"`.

const THINKING_BUDGETS: Record<string, number> = {
  low: 1024,
  medium: 4096,
  high: 16384,
  max: 32768,
};

export function thinkingBudget(effort: string | null): number {
  if (!effort) return 0;
  return THINKING_BUDGETS[effort] ?? 0;
}

/**
 * Compute the max_tokens cap for a call where the caller has a desired
 * output-token budget. When thinking is enabled, max_tokens must cover
 * BOTH thinking and output (Anthropic API contract). If max_tokens is
 * less than budget_tokens, Bedrock silently disables thinking.
 *
 * Use this everywhere a caller passes `maxOutputTokens` for a model that
 * may have thinking enabled.
 */
export function maxOutputWithThinking(desiredOutputTokens: number, cfg: { supportsThinking: boolean; thinkingEffort: string | null }): number {
  if (!cfg.supportsThinking || !cfg.thinkingEffort) return desiredOutputTokens;
  const budget = thinkingBudget(cfg.thinkingEffort);
  if (budget <= 0) return desiredOutputTokens;
  return desiredOutputTokens + budget + 256; // 256 = small safety headroom
}

// ── Prisma → API row mappers ────────────────────────────────────────

interface PrismaProviderShape {
  name: string;
  providerType: string | null;
  displayName: string | null;
  apiKey: string | null;
  endpointUrl: string | null;
  maxConcurrent: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toProviderRow(p: PrismaProviderShape): LlmProviderRow {
  return {
    name: p.name,
    provider_type: p.providerType,
    display_name: p.displayName,
    api_key: p.apiKey,
    endpoint_url: p.endpointUrl,
    max_concurrent: p.maxConcurrent,
    is_active: p.isActive,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

interface PrismaModelShape {
  id: string;
  provider: string;
  modelName: string;
  displayName: string | null;
  costPer1mInput: unknown; // Prisma Decimal
  costPer1mOutput: unknown; // Prisma Decimal
  maxOutputTokens: number | null;
  maxContextTokens: number | null;
  supportsThinking: boolean;
  defaultThinkingEffort: string | null;
  supportsVision: boolean;
  supportsEmbeddings: boolean;
  streamingEnabled: boolean;
  vlmEvalPreamble: string | null;
  tier: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toModelRow(m: PrismaModelShape): LlmModelRow {
  return {
    id: m.id,
    provider: m.provider,
    model_name: m.modelName,
    display_name: m.displayName,
    cost_per_1m_input: Number(m.costPer1mInput),
    cost_per_1m_output: Number(m.costPer1mOutput),
    max_output_tokens: m.maxOutputTokens,
    max_context_tokens: m.maxContextTokens,
    supports_thinking: m.supportsThinking,
    default_thinking_effort: m.defaultThinkingEffort,
    supports_vision: m.supportsVision,
    supports_embeddings: m.supportsEmbeddings,
    streaming_enabled: m.streamingEnabled,
    vlm_eval_preamble: m.vlmEvalPreamble,
    tier: m.tier,
    is_active: m.isActive,
    created_at: m.createdAt.toISOString(),
    updated_at: m.updatedAt.toISOString(),
  };
}

// ── Model resolution from DB ────────────────────────────────────────

/**
 * Get the resolved model configuration for a given purpose.
 * Joins llm_purpose_map → llm_models → llm_providers to get full config.
 */
export async function getModelForPurpose(purpose: string): Promise<LlmModelConfig> {
  const purposeMap = await prisma.llmPurposeMap.findUnique({
    where: { purpose },
    include: {
      model: {
        include: {
          providerRef: true,
        },
      },
    },
  });

  if (!purposeMap) {
    throw new Error(`No model assigned for purpose: ${purpose}. Run model seeder or configure in admin.`);
  }

  const model = purposeMap.model;
  const provider = model.providerRef;
  const apiKey = provider.apiKey?.trim() || null;

  if (!apiKey && provider.name !== "ollama") {
    logger.warn(
      { purpose, model: `${model.provider}/${model.modelName}` },
      "API key not configured for provider — set it via Admin → Providers",
    );
  }

  return {
    id: model.id,
    provider: model.provider,
    providerType: provider.providerType,
    modelName: model.modelName,
    displayName: model.displayName ?? `${model.provider}/${model.modelName}`,
    label: `${model.provider}/${model.modelName}`,
    costPer1mInput: Number(model.costPer1mInput),
    costPer1mOutput: Number(model.costPer1mOutput),
    maxOutputTokens: purposeMap.overrideMaxOutputTokens ?? model.maxOutputTokens,
    maxContextTokens: model.maxContextTokens,
    supportsThinking: model.supportsThinking,
    thinkingEffort: purposeMap.overrideThinkingEffort ?? model.defaultThinkingEffort,
    supportsVision: model.supportsVision,
    supportsEmbeddings: model.supportsEmbeddings,
    streamingEnabled: model.streamingEnabled,
    vlmEvalPreamble: model.vlmEvalPreamble ?? null,
    endpointUrl: provider.endpointUrl,
    apiKey,
    maxConcurrent: provider.maxConcurrent ?? null,
  };
}

/**
 * Try to resolve a model for `purpose`; if not configured, fall back to `fallback`.
 */
export async function getModelForPurposeWithFallback(
  purpose: string,
  fallback: string,
): Promise<LlmModelConfig> {
  const row = await prisma.llmPurposeMap.findUnique({ where: { purpose } });
  if (row) {
    return getModelForPurpose(purpose);
  }
  logger.info({ purpose, fallback }, "purpose not assigned, using fallback");
  return getModelForPurpose(fallback);
}

/**
 * Resolve a model config directly by model ID (not via purpose map).
 * Used by experiments to override the model for a specific pipeline stage.
 */
export async function resolveModelConfigById(modelId: string): Promise<LlmModelConfig> {
  const model = await prisma.llmModel.findUnique({
    where: { id: modelId },
    include: { providerRef: true },
  });
  if (!model) throw new Error(`LLM model not found: ${modelId}`);
  if (!model.isActive) throw new Error(`LLM model is not active: ${model.provider}/${model.modelName}`);

  const provider = model.providerRef;
  const apiKey = provider.apiKey?.trim() || null;
  return {
    id: model.id,
    provider: model.provider,
    providerType: provider.providerType,
    modelName: model.modelName,
    displayName: model.displayName ?? `${model.provider}/${model.modelName}`,
    label: `${model.provider}/${model.modelName}`,
    costPer1mInput: Number(model.costPer1mInput),
    costPer1mOutput: Number(model.costPer1mOutput),
    maxOutputTokens: model.maxOutputTokens,
    maxContextTokens: model.maxContextTokens,
    supportsThinking: model.supportsThinking,
    thinkingEffort: model.defaultThinkingEffort,
    supportsVision: model.supportsVision,
    supportsEmbeddings: model.supportsEmbeddings,
    streamingEnabled: model.streamingEnabled,
    vlmEvalPreamble: model.vlmEvalPreamble ?? null,
    endpointUrl: provider.endpointUrl,
    apiKey,
    maxConcurrent: provider.maxConcurrent ?? null,
  };
}

// ── Provider instantiation ──────────────────────────────────────────

/** Resolves the effective SDK type for provider dispatch. */
export function sdkType(cfg: LlmModelConfig): string {
  return cfg.providerType ?? cfg.provider;
}

/**
 * Create a Vercel AI SDK LanguageModel from a resolved config.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createProviderModel(cfg: LlmModelConfig): any {
  const { modelName, endpointUrl, apiKey } = cfg;
  const type = sdkType(cfg);

  if (type === "openai") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createOpenAI({ apiKey, ...(endpointUrl ? { baseURL: endpointUrl } : {}) })(modelName);
  }

  if (type === "anthropic") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createAnthropic({ apiKey })(modelName);
  }

  if (type === "xai") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createXai({ apiKey })(modelName);
  }

  if (type === "deepseek") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createDeepSeek({ apiKey })(modelName);
  }

  if (type === "minimax") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createMinimax({ apiKey })(modelName);
  }

  if (type === "ollama") {
    if (!endpointUrl) {
      throw new Error(`Endpoint URL missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    const normalizedBaseUrl = endpointUrl.replace(/\/+$/, "");
    const baseUrlWithVersion = normalizedBaseUrl.endsWith("/v1")
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1`;
    const ollama = createOpenAICompatible({
      name: "ollama",
      baseURL: baseUrlWithVersion,
      apiKey: apiKey && apiKey.trim() !== "" ? apiKey.trim() : undefined,
      fetch: createOllamaVisionFetch(normalizedBaseUrl),
    });
    return ollama.chatModel(modelName);
  }

  if (type === "bedrock") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createAmazonBedrock({
      apiKey,
      region: endpointUrl || "us-east-1",
    })(modelName);
  }

  if (type === "openai-compatible") {
    if (!endpointUrl) {
      throw new Error(`Endpoint URL is required for OpenAI-compatible provider ${cfg.label}`);
    }
    const normalizedBaseUrl = endpointUrl.replace(/\/+$/, "");
    const baseUrlWithVersion = normalizedBaseUrl.endsWith("/v1")
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1`;

    // For models with thinking enabled on vLLM, inject chat_template_kwargs
    // into the request body so the chat template activates reasoning mode.
    const needsThinkingKwargs = cfg.supportsThinking && cfg.thinkingEffort;
    const customFetch = needsThinkingKwargs
      ? async (url: RequestInfo | URL, init?: RequestInit) => {
          if (init?.body && typeof init.body === "string") {
            try {
              const body = JSON.parse(init.body);
              body.chat_template_kwargs = { enable_thinking: true };
              return globalThis.fetch(url, { ...init, body: JSON.stringify(body) });
            } catch { /* fall through to unmodified fetch */ }
          }
          return globalThis.fetch(url, init);
        }
      : undefined;

    const compat = createOpenAICompatible({
      name: cfg.provider,
      baseURL: baseUrlWithVersion,
      apiKey: apiKey?.trim() || undefined,
      ...(customFetch ? { fetch: customFetch } : {}),
    });
    return compat.chatModel(modelName);
  }

  throw new Error(`Unsupported provider: ${cfg.provider} (type: ${type})`);
}

/**
 * Create a Vercel AI SDK EmbeddingModel from a resolved config.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createEmbeddingModel(cfg: LlmModelConfig): any {
  const { modelName, endpointUrl, apiKey } = cfg;
  const type = sdkType(cfg);

  if (type === "openai") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createOpenAI({ apiKey, ...(endpointUrl ? { baseURL: endpointUrl } : {}) }).embedding(modelName);
  }

  if (type === "deepseek") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createOpenAI({ apiKey, baseURL: endpointUrl ?? "https://api.deepseek.com/v1" }).embedding(modelName);
  }

  if (type === "ollama") {
    if (!endpointUrl) {
      throw new Error(`Endpoint URL missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    const normalizedBaseUrl = endpointUrl.replace(/\/+$/, "");
    const baseUrlWithVersion = normalizedBaseUrl.endsWith("/v1")
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1`;
    const ollama = createOpenAICompatible({
      name: "ollama",
      baseURL: baseUrlWithVersion,
      apiKey: apiKey && apiKey.trim() !== "" ? apiKey.trim() : undefined,
    });
    return ollama.embeddingModel(modelName);
  }

  if (type === "bedrock") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createAmazonBedrock({
      apiKey,
      region: endpointUrl || "us-east-1",
    }).embedding(modelName);
  }

  if (type === "openai-compatible") {
    if (!endpointUrl) {
      throw new Error(`Endpoint URL is required for OpenAI-compatible provider ${cfg.label}`);
    }
    const normalizedBaseUrl = endpointUrl.replace(/\/+$/, "");
    const baseUrlWithVersion = normalizedBaseUrl.endsWith("/v1")
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1`;
    const compat = createOpenAICompatible({
      name: cfg.provider,
      baseURL: baseUrlWithVersion,
      apiKey: apiKey?.trim() || undefined,
    });
    return compat.embeddingModel(modelName);
  }

  throw new Error(`Unsupported embedding provider: ${cfg.provider} (type: ${type})`);
}

// ── generateText() options builder ──────────────────────────────────

/**
 * Build additional options for generateText() based on model config.
 */
export function buildGenerateOptions(cfg: LlmModelConfig): Record<string, unknown> {
  const opts: Record<string, unknown> = {};

  if (cfg.maxOutputTokens) {
    opts.maxOutputTokens = cfg.maxOutputTokens;
  }

  const providerOptions: Record<string, unknown> = {};

  // Anthropic thinking/reasoning (direct API and Bedrock). Always use
  // the documented `type: "enabled"` shape with an explicit budgetTokens —
  // this is the only thinking config the @ai-sdk/amazon-bedrock and
  // @ai-sdk/anthropic providers actually forward to the upstream API.
  const type = sdkType(cfg);
  if (cfg.supportsThinking && cfg.thinkingEffort) {
    const budget = thinkingBudget(cfg.thinkingEffort);
    if (budget > 0) {
      if (type === "bedrock") {
        providerOptions.bedrock = {
          reasoningConfig: { type: "enabled", budgetTokens: budget },
        };
      } else {
        providerOptions.anthropic = {
          thinking: { type: "enabled", budgetTokens: budget },
        };
      }
    }
  }

  // Ollama context window
  if (type === "ollama" && cfg.maxContextTokens) {
    providerOptions.ollama = {
      ...(providerOptions.ollama as Record<string, unknown> | undefined),
      num_ctx: cfg.maxContextTokens,
    };
  }

  if (Object.keys(providerOptions).length > 0) {
    opts.providerOptions = providerOptions;
  }

  return opts;
}

// ── Prompt caching ──────────────────────────────────────────────────

/** Minimum prompt size (in characters) to attempt caching (~1,024 tokens). */
const MIN_CACHEABLE_CHARS = 4096;

/** Returns true if the provider supports prompt caching (Bedrock, Anthropic). */
export function supportsCaching(provider: string): boolean {
  return provider === "bedrock" || provider === "anthropic";
}

/**
 * Build provider-specific cache point options for a system message.
 * Returns undefined for providers that don't support caching.
 */
export function buildCachePointOptions(provider: string): Record<string, unknown> | undefined {
  if (provider === "bedrock") {
    return { bedrock: { cachePoint: { type: "default" } } };
  }
  if (provider === "anthropic") {
    return { anthropic: { cacheControl: { type: "ephemeral" } } };
  }
  return undefined;
}

/**
 * Wrap a system prompt string into a SystemModelMessage with cache providerOptions
 * for supported providers. Returns a plain string for others.
 * Skips caching for prompts below the minimum size threshold.
 *
 * The return type uses `as any` for providerOptions because the AI SDK's
 * SharedV3ProviderOptions expects Record<string, JSONObject> which is not
 * structurally compatible with Record<string, unknown> at compile time,
 * even though the runtime values are valid.
 */
export function buildCacheableSystem(
  provider: string,
  systemContent: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): string | any {
  if (systemContent.length < MIN_CACHEABLE_CHARS) {
    return systemContent;
  }
  const cacheOptions = buildCachePointOptions(provider);
  if (!cacheOptions) {
    return systemContent;
  }
  return {
    role: "system",
    content: systemContent,
    providerOptions: cacheOptions,
  };
}

// ── Cost calculation ────────────────────────────────────────────────

export function calculateCostUsd(
  cfg: LlmModelConfig,
  promptTokens: number,
  completionTokens: number,
  reasoningTokens = 0,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  // Non-cached input tokens at standard price
  const nonCachedInput = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
  const inputCost = (nonCachedInput / 1_000_000) * cfg.costPer1mInput;
  // Cache reads: 0.1x input price
  const cacheReadCost = (cacheReadTokens / 1_000_000) * cfg.costPer1mInput * 0.1;
  // Cache writes: 1.25x input price
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * cfg.costPer1mInput * 1.25;
  const outputCost = (completionTokens / 1_000_000) * cfg.costPer1mOutput;
  // Reasoning/thinking tokens are billed at the output token rate
  const reasoningCost = (reasoningTokens / 1_000_000) * cfg.costPer1mOutput;
  return roundUsd(inputCost + cacheReadCost + cacheWriteCost + outputCost + reasoningCost);
}

function roundUsd(value: number): number {
  return Number(value.toFixed(8));
}

// ── Provider CRUD (for admin API) ───────────────────────────────────

export async function listAllProviders(): Promise<LlmProviderRow[]> {
  const rows = await prisma.llmProvider.findMany({
    orderBy: { name: "asc" },
  });
  return rows.map((r) => maskProviderApiKey(toProviderRow(r)));
}

export async function getProviderByName(name: string): Promise<LlmProviderRow | null> {
  const row = await prisma.llmProvider.findUnique({
    where: { name },
  });
  return row ? toProviderRow(row) : null;
}

export async function createProvider(input: {
  name: string;
  displayName?: string;
  apiKey?: string | null;
  endpointUrl?: string | null;
  providerType?: string | null;
}): Promise<LlmProviderRow> {
  // Default Bedrock region to us-east-1 if not specified
  const endpointUrl =
    input.name === "bedrock" && !input.endpointUrl
      ? "us-east-1"
      : (input.endpointUrl ?? null);

  const row = await prisma.llmProvider.create({
    data: {
      name: input.name,
      providerType: input.providerType ?? null,
      displayName: input.displayName ?? null,
      apiKey: input.apiKey ?? null,
      endpointUrl,
    },
  });
  return maskProviderApiKey(toProviderRow(row));
}

export async function updateProvider(
  name: string,
  patch: Record<string, unknown>,
): Promise<LlmProviderRow | null> {
  const ALLOWED_KEYS: Record<string, string> = {
    displayName: "displayName",
    apiKey: "apiKey",
    endpointUrl: "endpointUrl",
    maxConcurrent: "maxConcurrent",
    isActive: "isActive",
    providerType: "providerType",
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {};
  let hasChanges = false;

  for (const [key, value] of Object.entries(patch)) {
    const prismaKey = ALLOWED_KEYS[key];
    if (!prismaKey) continue;
    data[prismaKey] = value;
    hasChanges = true;
  }

  if (!hasChanges) return getProviderByName(name);

  data.updatedAt = new Date();

  try {
    const row = await prisma.llmProvider.update({
      where: { name },
      data,
    });
    return maskProviderApiKey(toProviderRow(row));
  } catch {
    return null;
  }
}

export async function deleteProvider(name: string): Promise<boolean> {
  // Check if any models reference this provider
  const modelCount = await prisma.llmModel.count({
    where: { provider: name },
  });

  if (modelCount > 0) {
    throw new Error(`Cannot delete provider: models still reference it`);
  }

  try {
    await prisma.llmProvider.delete({ where: { name } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mask the api_key in a provider row for safe API responses.
 * Shows first 5 chars + "****" or null if not set.
 */
function maskProviderApiKey(row: LlmProviderRow): LlmProviderRow {
  if (!row.api_key) return row;
  const masked = row.api_key.length > 5
    ? `${row.api_key.slice(0, 5)}****`
    : "****";
  return { ...row, api_key: masked };
}

// ── Model CRUD (for admin API) ──────────────────────────────────────

export async function listAllModels(): Promise<LlmModelRow[]> {
  const rows = await prisma.llmModel.findMany({
    orderBy: [{ provider: "asc" }, { modelName: "asc" }],
  });
  return rows.map(toModelRow);
}

export async function getModelById(id: string): Promise<LlmModelRow | null> {
  const row = await prisma.llmModel.findUnique({
    where: { id },
  });
  return row ? toModelRow(row) : null;
}

export async function createModel(input: {
  provider: string;
  modelName: string;
  displayName: string;            // now required
  costPer1mInput?: number;
  costPer1mOutput?: number;
  maxOutputTokens?: number | null;
  maxContextTokens?: number | null;
  supportsThinking?: boolean;
  defaultThinkingEffort?: string | null;
  supportsVision?: boolean;
  supportsEmbeddings?: boolean;
  streamingEnabled?: boolean;
  vlmEvalPreamble?: string | null;
  tier?: string | null;
}): Promise<LlmModelRow> {
  const displayName = input.displayName.trim();
  if (!displayName) {
    throw new LlmConfigError("displayName is required", 400);
  }

  try {
    const row = await prisma.llmModel.create({
      data: {
        provider: input.provider,
        modelName: input.modelName,
        displayName,
        costPer1mInput: input.costPer1mInput ?? 0,
        costPer1mOutput: input.costPer1mOutput ?? 0,
        maxOutputTokens: input.maxOutputTokens ?? null,
        maxContextTokens: input.maxContextTokens ?? null,
        supportsThinking: input.supportsThinking ?? false,
        defaultThinkingEffort: input.defaultThinkingEffort ?? null,
        supportsVision: input.supportsVision ?? false,
        supportsEmbeddings: input.supportsEmbeddings ?? false,
        streamingEnabled: input.streamingEnabled ?? true,
        vlmEvalPreamble: input.vlmEvalPreamble ?? null,
        tier: input.tier ?? null,
      },
    });
    return toModelRow(row);
  } catch (error) {
    // Prisma unique-constraint violation → 409 Conflict
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      throw new LlmConfigError(
        `A model with display name "${displayName}" already exists for provider "${input.provider}"`,
        409,
      );
    }
    throw error;
  }
}

export async function updateModel(
  id: string,
  patch: Record<string, unknown>,
): Promise<LlmModelRow | null> {
  const ALLOWED_KEYS: Record<string, string> = {
    provider: "provider",
    modelName: "modelName",
    displayName: "displayName",
    costPer1mInput: "costPer1mInput",
    costPer1mOutput: "costPer1mOutput",
    maxOutputTokens: "maxOutputTokens",
    maxContextTokens: "maxContextTokens",
    supportsThinking: "supportsThinking",
    defaultThinkingEffort: "defaultThinkingEffort",
    supportsVision: "supportsVision",
    supportsEmbeddings: "supportsEmbeddings",
    streamingEnabled: "streamingEnabled",
    vlmEvalPreamble: "vlmEvalPreamble",
    tier: "tier",
    isActive: "isActive",
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {};
  let hasChanges = false;

  for (const [key, value] of Object.entries(patch)) {
    const prismaKey = ALLOWED_KEYS[key];
    if (!prismaKey) continue;
    data[prismaKey] = value;
    hasChanges = true;
  }

  if (!hasChanges) return getModelById(id);

  data.updatedAt = new Date();

  try {
    const row = await prisma.llmModel.update({
      where: { id },
      data,
    });
    return toModelRow(row);
  } catch {
    return null;
  }
}

export async function deleteModel(id: string): Promise<boolean> {
  // Check if model is assigned to any purpose
  const purposes = await prisma.llmPurposeMap.findMany({
    where: { modelId: id },
    select: { purpose: true },
  });

  if (purposes.length > 0) {
    const purposeNames = purposes.map((r) => r.purpose).join(", ");
    throw new Error(`Cannot delete model: still assigned to purposes: ${purposeNames}`);
  }

  try {
    await prisma.llmModel.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

// ── Purpose assignment CRUD ─────────────────────────────────────────

export async function listPurposeAssignments(): Promise<PurposeAssignment[]> {
  const rows = await prisma.llmPurposeMap.findMany({
    include: {
      model: {
        select: {
          displayName: true,
          provider: true,
          modelName: true,
        },
      },
    },
    orderBy: { purpose: "asc" },
  });

  const byPurpose = new Map(rows.map((row) => [row.purpose, row]));

  return LLM_PURPOSES.map((purpose) => {
    const row = byPurpose.get(purpose);
    if (row) {
      return {
        id: row.id,
        purpose: row.purpose,
        modelId: row.modelId,
        modelDisplayName: row.model.displayName ?? `${row.model.provider}/${row.model.modelName}`,
        modelProvider: row.model.provider,
        modelModelName: row.model.modelName,
        overrideMaxOutputTokens: row.overrideMaxOutputTokens,
        overrideThinkingEffort: row.overrideThinkingEffort,
      };
    }
    return {
      id: null,
      purpose,
      modelId: null,
      modelDisplayName: null,
      modelProvider: null,
      modelModelName: null,
      overrideMaxOutputTokens: null,
      overrideThinkingEffort: null,
    };
  });
}

export async function updatePurposeAssignment(
  purpose: string,
  patch: {
    modelId?: string;
    overrideMaxOutputTokens?: number | null;
    overrideThinkingEffort?: string | null;
  },
): Promise<PurposeAssignment | null> {
  if (!patch.modelId) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {
    modelId: patch.modelId,
    updatedAt: new Date(),
  };
  if (patch.overrideMaxOutputTokens !== undefined) {
    updateData.overrideMaxOutputTokens = patch.overrideMaxOutputTokens;
  }
  if (patch.overrideThinkingEffort !== undefined) {
    updateData.overrideThinkingEffort = patch.overrideThinkingEffort;
  }

  try {
    await prisma.llmPurposeMap.upsert({
      where: { purpose },
      update: updateData,
      create: {
        purpose,
        modelId: patch.modelId,
        overrideMaxOutputTokens: patch.overrideMaxOutputTokens ?? null,
        overrideThinkingEffort: patch.overrideThinkingEffort ?? null,
      },
    });
  } catch {
    return null;
  }

  // Return the updated assignment with joined model info
  const assignments = await listPurposeAssignments();
  return assignments.find((a) => a.purpose === purpose) ?? null;
}
