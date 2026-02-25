import type { Migration } from "./types.js";

export const migration011LlmProvidersTable: Migration = {
  id: "011_llm_providers_table",
  up: [
    // ── LLM Providers registry ─────────────────────────────────────────
    `
    CREATE TABLE IF NOT EXISTS llm_providers (
      name          VARCHAR(50) PRIMARY KEY,
      display_name  VARCHAR(100),
      api_key       TEXT,
      endpoint_url  TEXT,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,

    // Seed providers from existing distinct provider values in llm_models
    `
    INSERT INTO llm_providers (name, display_name, endpoint_url)
    SELECT DISTINCT
      provider,
      INITCAP(provider),
      endpoint_url
    FROM llm_models
    ON CONFLICT (name) DO NOTHING;
    `,

    // Drop provider-level columns from llm_models
    `ALTER TABLE llm_models DROP COLUMN IF EXISTS endpoint_url;`,
    `ALTER TABLE llm_models DROP COLUMN IF EXISTS api_key_env_var;`,

    // Add FK from llm_models.provider to llm_providers.name
    `
    ALTER TABLE llm_models
      ADD CONSTRAINT fk_llm_models_provider
      FOREIGN KEY (provider) REFERENCES llm_providers(name)
      ON UPDATE CASCADE ON DELETE RESTRICT;
    `,
  ],
  down: [
    // Remove FK
    `ALTER TABLE llm_models DROP CONSTRAINT IF EXISTS fk_llm_models_provider;`,

    // Restore columns on llm_models
    `ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS endpoint_url TEXT;`,
    `ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS api_key_env_var VARCHAR(100);`,

    // Drop llm_providers
    `DROP TABLE IF EXISTS llm_providers;`,
  ],
};
