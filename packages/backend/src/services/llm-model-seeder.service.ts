/**
 * LLM Model & Provider Seeder
 *
 * Seeds the llm_providers, llm_models and llm_purpose_map tables with defaults
 * on first run. Idempotent — skips if rows already exist. Called during backend startup.
 * Purpose assignments are resolved from current env var configuration.
 *
 * API keys are NOT seeded — the admin must configure them via the Providers UI.
 */

import { pool } from "../db/connection.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("llm-seeder");

// ── Provider seed data ──────────────────────────────────────────────

interface SeedProvider {
  name: string;
  displayName: string;
}

const SEED_PROVIDERS: SeedProvider[] = [
  { name: "openai", displayName: "OpenAI" },
  { name: "anthropic", displayName: "Anthropic" },
  { name: "xai", displayName: "xAI" },
  { name: "deepseek", displayName: "DeepSeek" },
  { name: "minimax", displayName: "MiniMax" },
  { name: "ollama", displayName: "Ollama" },
];

// ── Model seed data ─────────────────────────────────────────────────

interface SeedModel {
  provider: string;
  modelName: string;
  displayName: string;
  costPer1mInput: number;
  costPer1mOutput: number;
  supportsVision?: boolean;
  supportsEmbeddings?: boolean;
  supportsThinking?: boolean;
  defaultThinkingEffort?: string;
  maxContextTokens?: number;
  maxOutputTokens?: number;
}

const SEED_MODELS: SeedModel[] = [
  // OpenAI
  { provider: "openai", modelName: "gpt-4o-mini", displayName: "GPT-4o Mini", costPer1mInput: 0.15, costPer1mOutput: 0.60 },
  { provider: "openai", modelName: "gpt-5.2-codex", displayName: "GPT-5.2 Codex", costPer1mInput: 1.50, costPer1mOutput: 6.00 },
  { provider: "openai", modelName: "gpt-4o", displayName: "GPT-4o", costPer1mInput: 2.50, costPer1mOutput: 10.00, supportsVision: true },
  { provider: "openai", modelName: "text-embedding-3-large", displayName: "Text Embedding 3 Large", costPer1mInput: 0.13, costPer1mOutput: 0, supportsEmbeddings: true },

  // Anthropic
  { provider: "anthropic", modelName: "claude-3-5-haiku-latest", displayName: "Claude 3.5 Haiku", costPer1mInput: 0.80, costPer1mOutput: 4.00 },
  { provider: "anthropic", modelName: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", costPer1mInput: 3.00, costPer1mOutput: 15.00, supportsVision: true, supportsThinking: true, defaultThinkingEffort: "medium" },

  // xAI
  { provider: "xai", modelName: "grok-2-latest", displayName: "Grok 2", costPer1mInput: 2.00, costPer1mOutput: 10.00 },

  // DeepSeek
  { provider: "deepseek", modelName: "deepseek-chat", displayName: "DeepSeek Chat (V3)", costPer1mInput: 0.27, costPer1mOutput: 1.10 },
  { provider: "deepseek", modelName: "deepseek-reasoner", displayName: "DeepSeek Reasoner (R1)", costPer1mInput: 0.55, costPer1mOutput: 2.19, supportsThinking: true, defaultThinkingEffort: "medium" },

  // MiniMax
  { provider: "minimax", modelName: "MiniMax-Text-01", displayName: "MiniMax Text 01", costPer1mInput: 1.10, costPer1mOutput: 4.40 },

  // Ollama (local — zero cost)
  { provider: "ollama", modelName: "llama3.1", displayName: "Llama 3.1", costPer1mInput: 0, costPer1mOutput: 0, maxContextTokens: 131072 },
  { provider: "ollama", modelName: "llama3.2-vision", displayName: "Llama 3.2 Vision", costPer1mInput: 0, costPer1mOutput: 0, supportsVision: true, maxContextTokens: 131072 },
];

interface SeedPurpose {
  purpose: string;
  provider: string;
  modelName: string;
}

/**
 * Build purpose assignments from the current env var configuration.
 */
function buildSeedPurposes(): SeedPurpose[] {
  return [
    {
      purpose: "conversation",
      provider: config.query.conversationProvider,
      modelName: config.query.conversationModelName,
    },
    {
      purpose: "chat_codegen",
      provider: config.query.codegenProvider,
      modelName: config.query.codegenModelName,
    },
    {
      purpose: "workbench_codegen",
      provider: config.workbench.codegenProvider === "mock" ? config.query.codegenProvider : config.workbench.codegenProvider,
      modelName: config.workbench.codegenModelName,
    },
    {
      purpose: "vlm_eval",
      provider: config.workbench.evalVlmProvider,
      modelName: config.workbench.evalVlmModel,
    },
    {
      purpose: "embedding",
      provider: config.workbench.embeddingProvider,
      modelName: config.workbench.embeddingModel,
    },
  ];
}

// ── Seeder ───────────────────────────────────────────────────────────

/**
 * Seed LLM providers, models, and purpose assignments if tables are empty.
 * Safe to call on every startup — skips if data already exists.
 */
export async function seedLlmModels(): Promise<void> {
  // Check if models table already has rows
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM llm_models`,
  );
  const existingCount = Number(countResult.rows[0].count);

  if (existingCount > 0) {
    logger.info({ existingModels: existingCount }, "llm_models already seeded, skipping");
    return;
  }

  logger.info({ providerCount: SEED_PROVIDERS.length, modelCount: SEED_MODELS.length }, "seeding llm_providers and llm_models");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Seed providers first (api_key left NULL — admin will configure via UI)
    for (const p of SEED_PROVIDERS) {
      await client.query(
        `INSERT INTO llm_providers (name, display_name)
         VALUES ($1, $2)
         ON CONFLICT (name) DO NOTHING`,
        [p.name, p.displayName],
      );
    }

    // 2. Insert all seed models
    for (const m of SEED_MODELS) {
      await client.query(
        `INSERT INTO llm_models (
           provider, model_name, display_name,
           cost_per_1m_input, cost_per_1m_output,
           max_output_tokens, max_context_tokens,
           supports_thinking, default_thinking_effort,
           supports_vision, supports_embeddings
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (provider, model_name) DO NOTHING`,
        [
          m.provider,
          m.modelName,
          m.displayName,
          m.costPer1mInput,
          m.costPer1mOutput,
          m.maxOutputTokens ?? null,
          m.maxContextTokens ?? null,
          m.supportsThinking ?? false,
          m.defaultThinkingEffort ?? null,
          m.supportsVision ?? false,
          m.supportsEmbeddings ?? false,
        ],
      );
    }

    // 3. Insert purpose assignments
    const seedPurposes = buildSeedPurposes();
    for (const p of seedPurposes) {
      // Ensure the provider exists (in case env var references a provider not in seed data)
      await client.query(
        `INSERT INTO llm_providers (name, display_name)
         VALUES ($1, INITCAP($1))
         ON CONFLICT (name) DO NOTHING`,
        [p.provider],
      );

      // Look up the model ID
      const modelResult = await client.query<{ id: string }>(
        `SELECT id FROM llm_models WHERE provider = $1 AND model_name = $2 LIMIT 1`,
        [p.provider, p.modelName],
      );

      if (modelResult.rows.length === 0) {
        // Model not in seed data — insert it with zero pricing
        logger.warn(
          { purpose: p.purpose, provider: p.provider, modelName: p.modelName },
          "configured model not in seed data, adding with zero pricing",
        );
        const insertResult = await client.query<{ id: string }>(
          `INSERT INTO llm_models (
             provider, model_name, display_name,
             cost_per_1m_input, cost_per_1m_output
           ) VALUES ($1, $2, $3, 0, 0)
           ON CONFLICT (provider, model_name) DO UPDATE SET updated_at = NOW()
           RETURNING id`,
          [
            p.provider,
            p.modelName,
            `${p.provider}/${p.modelName}`,
          ],
        );
        const modelId = insertResult.rows[0].id;
        await client.query(
          `INSERT INTO llm_purpose_map (purpose, model_id) VALUES ($1, $2)
           ON CONFLICT (purpose) DO NOTHING`,
          [p.purpose, modelId],
        );
      } else {
        const modelId = modelResult.rows[0].id;
        await client.query(
          `INSERT INTO llm_purpose_map (purpose, model_id) VALUES ($1, $2)
           ON CONFLICT (purpose) DO NOTHING`,
          [p.purpose, modelId],
        );
      }

      logger.info({ purpose: p.purpose, model: `${p.provider}/${p.modelName}` }, "assigned purpose");
    }

    await client.query("COMMIT");
    logger.info("llm_providers, llm_models and llm_purpose_map seeded successfully");
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ err: error }, "failed to seed llm_models");
    throw error;
  } finally {
    client.release();
  }
}
