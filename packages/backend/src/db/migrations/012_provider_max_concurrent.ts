import type { Migration } from "./types.js";

export const migration012ProviderMaxConcurrent: Migration = {
  id: "012_provider_max_concurrent",
  up: [
    `ALTER TABLE llm_providers ADD COLUMN IF NOT EXISTS max_concurrent INTEGER DEFAULT NULL;`,
  ],
  down: [
    `ALTER TABLE llm_providers DROP COLUMN IF EXISTS max_concurrent;`,
  ],
};
