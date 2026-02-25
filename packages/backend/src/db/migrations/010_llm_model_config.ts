import type { Migration } from "./types.js";

export const migration010LlmModelConfig: Migration = {
  id: "010_llm_model_config",
  up: [
    // ── LLM Models registry ─────────────────────────────────────────
    `
    CREATE TABLE IF NOT EXISTS llm_models (
      id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider               VARCHAR(50) NOT NULL,
      model_name             VARCHAR(255) NOT NULL,
      display_name           VARCHAR(255),
      cost_per_1m_input      NUMERIC(12, 4) NOT NULL DEFAULT 0,
      cost_per_1m_output     NUMERIC(12, 4) NOT NULL DEFAULT 0,
      max_output_tokens      INTEGER,
      max_context_tokens     INTEGER,
      supports_thinking      BOOLEAN NOT NULL DEFAULT FALSE,
      default_thinking_effort VARCHAR(20),
      supports_vision        BOOLEAN NOT NULL DEFAULT FALSE,
      supports_embeddings    BOOLEAN NOT NULL DEFAULT FALSE,
      endpoint_url           TEXT,
      api_key_env_var        VARCHAR(100) NOT NULL,
      is_active              BOOLEAN NOT NULL DEFAULT TRUE,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider, model_name)
    );
    `,

    // ── Purpose-to-model assignment map ─────────────────────────────
    `
    CREATE TABLE IF NOT EXISTS llm_purpose_map (
      id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      purpose                     VARCHAR(50) NOT NULL UNIQUE,
      model_id                    UUID NOT NULL REFERENCES llm_models(id) ON DELETE RESTRICT,
      override_max_output_tokens  INTEGER,
      override_thinking_effort    VARCHAR(20),
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,

    // ── Chat items token usage columns ──────────────────────────────
    `ALTER TABLE chat_items ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER DEFAULT 0;`,
    `ALTER TABLE chat_items ADD COLUMN IF NOT EXISTS completion_tokens INTEGER DEFAULT 0;`,
    `ALTER TABLE chat_items ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(12, 8) DEFAULT 0;`,
  ],
  down: [
    `ALTER TABLE chat_items DROP COLUMN IF EXISTS estimated_cost_usd;`,
    `ALTER TABLE chat_items DROP COLUMN IF EXISTS completion_tokens;`,
    `ALTER TABLE chat_items DROP COLUMN IF EXISTS prompt_tokens;`,
    `DROP TABLE IF EXISTS llm_purpose_map;`,
    `DROP TABLE IF EXISTS llm_models;`,
  ],
};
