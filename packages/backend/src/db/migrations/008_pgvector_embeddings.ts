import type { Migration } from "./types.js";

export const migration008PgvectorEmbeddings: Migration = {
  id: "008_pgvector_embeddings",
  up: [
    // Enable the pgvector extension (requires pgvector binaries in the Docker image)
    `CREATE EXTENSION IF NOT EXISTS vector;`,

    // Add embedding column to workbench_example_prompts
    // 1536 dimensions — text-embedding-3-large with dimensions=1536
    // (better quality than text-embedding-3-small at same dimension via Matryoshka Representation Learning)
    `ALTER TABLE workbench_example_prompts
     ADD COLUMN IF NOT EXISTS embedding vector(1536);`,

    // Create an HNSW index for cosine similarity search
    `CREATE INDEX IF NOT EXISTS idx_wb_prompts_embedding
     ON workbench_example_prompts
     USING hnsw (embedding vector_cosine_ops);`,
  ],
  down: [
    `DROP INDEX IF EXISTS idx_wb_prompts_embedding;`,
    `ALTER TABLE workbench_example_prompts DROP COLUMN IF EXISTS embedding;`,
    // Don't drop the vector extension — it might be used elsewhere
  ],
};
