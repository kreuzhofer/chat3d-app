/**
 * LLM Model & Provider Configuration Service
 *
 * DB-driven model/provider registry and purpose-based model resolution.
 * Provider settings (API keys, endpoint URLs) are stored in llm_providers.
 * Model settings (capabilities, pricing, tokens) are stored in llm_models.
 * Models reference their provider via the provider column (FK to llm_providers.name).
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { createMinimax } from "vercel-minimax-ai-provider";
import { pool } from "../db/connection.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("llm-config");

// ── Types ────────────────────────────────────────────────────────────

/** Raw row from llm_providers table */
export interface LlmProviderRow {
  name: string;
  display_name: string | null;
  api_key: string | null;
  endpoint_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Raw row from llm_models table */
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
  endpointUrl: string | null;
  apiKey: string | null;
}

/** Purpose assignment joined with model details (for admin API) */
export interface PurposeAssignment {
  id: string;
  purpose: string;
  modelId: string;
  modelDisplayName: string;
  modelProvider: string;
  modelModelName: string;
  overrideMaxOutputTokens: number | null;
  overrideThinkingEffort: string | null;
}

// ── Valid purposes ──────────────────────────────────────────────────

export const LLM_PURPOSES = [
  "conversation",
  "chat_codegen",
  "workbench_codegen",
  "vlm_eval",
  "embedding",
] as const;

export type LlmPurpose = (typeof LLM_PURPOSES)[number];

// ── Thinking budget mapping ─────────────────────────────────────────

const THINKING_BUDGETS: Record<string, number> = {
  low: 1024,
  medium: 4096,
  high: 16384,
};

export function thinkingBudget(effort: string | null): number {
  if (!effort) return 0;
  return THINKING_BUDGETS[effort] ?? 0;
}

// ── Model resolution from DB ────────────────────────────────────────

/**
 * Get the resolved model configuration for a given purpose.
 * Joins llm_purpose_map → llm_models → llm_providers to get full config.
 */
export async function getModelForPurpose(purpose: string): Promise<LlmModelConfig> {
  const result = await pool.query<
    LlmModelRow & LlmPurposeRow & {
      provider_api_key: string | null;
      provider_endpoint_url: string | null;
    }
  >(
    `SELECT
       m.*,
       p.override_max_output_tokens,
       p.override_thinking_effort,
       prov.api_key AS provider_api_key,
       prov.endpoint_url AS provider_endpoint_url
     FROM llm_purpose_map p
     JOIN llm_models m ON m.id = p.model_id
     JOIN llm_providers prov ON prov.name = m.provider
     WHERE p.purpose = $1`,
    [purpose],
  );

  if (result.rows.length === 0) {
    throw new Error(`No model assigned for purpose: ${purpose}. Run model seeder or configure in admin.`);
  }

  const row = result.rows[0];
  const apiKey = row.provider_api_key?.trim() || null;

  if (!apiKey && row.provider !== "ollama") {
    logger.warn(
      { purpose, model: `${row.provider}/${row.model_name}` },
      "API key not configured for provider — set it via Admin → Providers",
    );
  }

  return {
    id: row.id,
    provider: row.provider,
    modelName: row.model_name,
    displayName: row.display_name ?? `${row.provider}/${row.model_name}`,
    label: `${row.provider}/${row.model_name}`,
    costPer1mInput: Number(row.cost_per_1m_input),
    costPer1mOutput: Number(row.cost_per_1m_output),
    maxOutputTokens: row.override_max_output_tokens ?? row.max_output_tokens,
    maxContextTokens: row.max_context_tokens,
    supportsThinking: row.supports_thinking,
    thinkingEffort: row.override_thinking_effort ?? row.default_thinking_effort,
    supportsVision: row.supports_vision,
    supportsEmbeddings: row.supports_embeddings,
    endpointUrl: row.provider_endpoint_url,
    apiKey,
  };
}

// ── Provider instantiation ──────────────────────────────────────────

/**
 * Create a Vercel AI SDK LanguageModel from a resolved config.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createProviderModel(cfg: LlmModelConfig): any {
  const { provider, modelName, endpointUrl, apiKey } = cfg;

  if (provider === "openai") {
    const baseURL = endpointUrl ?? config.query.openAiBaseUrl;
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createOpenAI({ apiKey, baseURL })(modelName);
  }

  if (provider === "anthropic") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createAnthropic({ apiKey })(modelName);
  }

  if (provider === "xai") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createXai({ apiKey })(modelName);
  }

  if (provider === "deepseek") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createDeepSeek({ apiKey })(modelName);
  }

  if (provider === "minimax") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createMinimax({ apiKey })(modelName);
  }

  if (provider === "ollama") {
    const baseUrl = endpointUrl ?? config.query.ollamaBaseUrl;
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
    const baseUrlWithVersion = normalizedBaseUrl.endsWith("/v1")
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1`;
    const ollama = createOpenAICompatible({
      name: "ollama",
      baseURL: baseUrlWithVersion,
      apiKey: apiKey && apiKey.trim() !== "" ? apiKey.trim() : undefined,
    });
    return ollama.chatModel(modelName);
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * Create a Vercel AI SDK EmbeddingModel from a resolved config.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createEmbeddingModel(cfg: LlmModelConfig): any {
  const { provider, modelName, endpointUrl, apiKey } = cfg;

  if (provider === "openai") {
    const baseURL = endpointUrl ?? config.query.openAiBaseUrl;
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createOpenAI({ apiKey, baseURL }).embedding(modelName);
  }

  if (provider === "deepseek") {
    if (!apiKey) {
      throw new Error(`API key missing for ${cfg.label} — configure it in Admin → Providers`);
    }
    return createOpenAI({ apiKey, baseURL: endpointUrl ?? "https://api.deepseek.com/v1" }).embedding(modelName);
  }

  if (provider === "ollama") {
    const baseUrl = endpointUrl ?? config.query.ollamaBaseUrl;
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
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

  throw new Error(`Unsupported embedding provider: ${provider}`);
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

  // Anthropic thinking/reasoning
  if (cfg.supportsThinking && cfg.thinkingEffort) {
    const budget = thinkingBudget(cfg.thinkingEffort);
    if (budget > 0) {
      providerOptions.anthropic = {
        thinking: { type: "enabled", budgetTokens: budget },
      };
    }
  }

  // Ollama context window
  if (cfg.provider === "ollama" && cfg.maxContextTokens) {
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

// ── Cost calculation ────────────────────────────────────────────────

export function calculateCostUsd(
  cfg: LlmModelConfig,
  promptTokens: number,
  completionTokens: number,
): number {
  const inputCost = (promptTokens / 1_000_000) * cfg.costPer1mInput;
  const outputCost = (completionTokens / 1_000_000) * cfg.costPer1mOutput;
  return roundUsd(inputCost + outputCost);
}

function roundUsd(value: number): number {
  return Number(value.toFixed(8));
}

// ── Provider CRUD (for admin API) ───────────────────────────────────

export async function listAllProviders(): Promise<LlmProviderRow[]> {
  const result = await pool.query<LlmProviderRow>(
    `SELECT * FROM llm_providers ORDER BY name`,
  );
  return result.rows.map(maskProviderApiKey);
}

export async function getProviderByName(name: string): Promise<LlmProviderRow | null> {
  const result = await pool.query<LlmProviderRow>(
    `SELECT * FROM llm_providers WHERE name = $1`,
    [name],
  );
  return result.rows[0] ?? null;
}

export async function createProvider(input: {
  name: string;
  displayName?: string;
  apiKey?: string | null;
  endpointUrl?: string | null;
}): Promise<LlmProviderRow> {
  const result = await pool.query<LlmProviderRow>(
    `INSERT INTO llm_providers (name, display_name, api_key, endpoint_url)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.name, input.displayName ?? null, input.apiKey ?? null, input.endpointUrl ?? null],
  );
  return maskProviderApiKey(result.rows[0]);
}

export async function updateProvider(
  name: string,
  patch: Record<string, unknown>,
): Promise<LlmProviderRow | null> {
  const ALLOWED_COLUMNS: Record<string, string> = {
    displayName: "display_name",
    apiKey: "api_key",
    endpointUrl: "endpoint_url",
    isActive: "is_active",
  };

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const [key, value] of Object.entries(patch)) {
    const column = ALLOWED_COLUMNS[key];
    if (!column) continue;
    setClauses.push(`${column} = $${paramIdx}`);
    values.push(value);
    paramIdx++;
  }

  if (setClauses.length === 0) return getProviderByName(name);

  setClauses.push(`updated_at = NOW()`);
  values.push(name);

  const result = await pool.query<LlmProviderRow>(
    `UPDATE llm_providers SET ${setClauses.join(", ")} WHERE name = $${paramIdx} RETURNING *`,
    values,
  );
  return result.rows[0] ? maskProviderApiKey(result.rows[0]) : null;
}

export async function deleteProvider(name: string): Promise<boolean> {
  // Check if any models reference this provider
  const modelCheck = await pool.query(
    `SELECT id FROM llm_models WHERE provider = $1 LIMIT 1`,
    [name],
  );
  if (modelCheck.rows.length > 0) {
    throw new Error(`Cannot delete provider: models still reference it`);
  }

  const result = await pool.query(`DELETE FROM llm_providers WHERE name = $1`, [name]);
  return (result.rowCount ?? 0) > 0;
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
  const result = await pool.query<LlmModelRow>(
    `SELECT * FROM llm_models ORDER BY provider, model_name`,
  );
  return result.rows;
}

export async function getModelById(id: string): Promise<LlmModelRow | null> {
  const result = await pool.query<LlmModelRow>(
    `SELECT * FROM llm_models WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function createModel(input: {
  provider: string;
  modelName: string;
  displayName?: string;
  costPer1mInput?: number;
  costPer1mOutput?: number;
  maxOutputTokens?: number | null;
  maxContextTokens?: number | null;
  supportsThinking?: boolean;
  defaultThinkingEffort?: string | null;
  supportsVision?: boolean;
  supportsEmbeddings?: boolean;
}): Promise<LlmModelRow> {
  const result = await pool.query<LlmModelRow>(
    `INSERT INTO llm_models (
       provider, model_name, display_name,
       cost_per_1m_input, cost_per_1m_output,
       max_output_tokens, max_context_tokens,
       supports_thinking, default_thinking_effort,
       supports_vision, supports_embeddings
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      input.provider,
      input.modelName,
      input.displayName ?? null,
      input.costPer1mInput ?? 0,
      input.costPer1mOutput ?? 0,
      input.maxOutputTokens ?? null,
      input.maxContextTokens ?? null,
      input.supportsThinking ?? false,
      input.defaultThinkingEffort ?? null,
      input.supportsVision ?? false,
      input.supportsEmbeddings ?? false,
    ],
  );
  return result.rows[0];
}

export async function updateModel(
  id: string,
  patch: Record<string, unknown>,
): Promise<LlmModelRow | null> {
  const ALLOWED_COLUMNS: Record<string, string> = {
    provider: "provider",
    modelName: "model_name",
    displayName: "display_name",
    costPer1mInput: "cost_per_1m_input",
    costPer1mOutput: "cost_per_1m_output",
    maxOutputTokens: "max_output_tokens",
    maxContextTokens: "max_context_tokens",
    supportsThinking: "supports_thinking",
    defaultThinkingEffort: "default_thinking_effort",
    supportsVision: "supports_vision",
    supportsEmbeddings: "supports_embeddings",
    isActive: "is_active",
  };

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const [key, value] of Object.entries(patch)) {
    const column = ALLOWED_COLUMNS[key];
    if (!column) continue;
    setClauses.push(`${column} = $${paramIdx}`);
    values.push(value);
    paramIdx++;
  }

  if (setClauses.length === 0) return getModelById(id);

  setClauses.push(`updated_at = NOW()`);
  values.push(id);

  const result = await pool.query<LlmModelRow>(
    `UPDATE llm_models SET ${setClauses.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function deleteModel(id: string): Promise<boolean> {
  // Check if model is assigned to any purpose
  const purposeCheck = await pool.query(
    `SELECT purpose FROM llm_purpose_map WHERE model_id = $1`,
    [id],
  );
  if (purposeCheck.rows.length > 0) {
    const purposes = purposeCheck.rows.map((r: { purpose: string }) => r.purpose).join(", ");
    throw new Error(`Cannot delete model: still assigned to purposes: ${purposes}`);
  }

  const result = await pool.query(`DELETE FROM llm_models WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

// ── Purpose assignment CRUD ─────────────────────────────────────────

export async function listPurposeAssignments(): Promise<PurposeAssignment[]> {
  const result = await pool.query<{
    id: string;
    purpose: string;
    model_id: string;
    override_max_output_tokens: number | null;
    override_thinking_effort: string | null;
    display_name: string | null;
    provider: string;
    model_name: string;
  }>(
    `SELECT
       p.id, p.purpose, p.model_id,
       p.override_max_output_tokens, p.override_thinking_effort,
       m.display_name, m.provider, m.model_name
     FROM llm_purpose_map p
     JOIN llm_models m ON m.id = p.model_id
     ORDER BY p.purpose`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    purpose: row.purpose,
    modelId: row.model_id,
    modelDisplayName: row.display_name ?? `${row.provider}/${row.model_name}`,
    modelProvider: row.provider,
    modelModelName: row.model_name,
    overrideMaxOutputTokens: row.override_max_output_tokens,
    overrideThinkingEffort: row.override_thinking_effort,
  }));
}

export async function updatePurposeAssignment(
  purpose: string,
  patch: {
    modelId?: string;
    overrideMaxOutputTokens?: number | null;
    overrideThinkingEffort?: string | null;
  },
): Promise<PurposeAssignment | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (patch.modelId !== undefined) {
    setClauses.push(`model_id = $${paramIdx}`);
    values.push(patch.modelId);
    paramIdx++;
  }
  if (patch.overrideMaxOutputTokens !== undefined) {
    setClauses.push(`override_max_output_tokens = $${paramIdx}`);
    values.push(patch.overrideMaxOutputTokens);
    paramIdx++;
  }
  if (patch.overrideThinkingEffort !== undefined) {
    setClauses.push(`override_thinking_effort = $${paramIdx}`);
    values.push(patch.overrideThinkingEffort);
    paramIdx++;
  }

  if (setClauses.length === 0) return null;

  setClauses.push(`updated_at = NOW()`);
  values.push(purpose);

  await pool.query(
    `UPDATE llm_purpose_map SET ${setClauses.join(", ")} WHERE purpose = $${paramIdx}`,
    values,
  );

  // Return the updated assignment with joined model info
  const assignments = await listPurposeAssignments();
  return assignments.find((a) => a.purpose === purpose) ?? null;
}
