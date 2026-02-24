import type { Migration } from "./types.js";

export const migration009EmbeddingModelColumn: Migration = {
  id: "009_embedding_model_column",
  up: [
    // Track which embedding model generated each vector so we can detect
    // stale embeddings when the model changes and selectively re-embed.
    `ALTER TABLE workbench_example_prompts
     ADD COLUMN IF NOT EXISTS embedding_model TEXT;`,
  ],
  down: [
    `ALTER TABLE workbench_example_prompts DROP COLUMN IF EXISTS embedding_model;`,
  ],
};
