-- Add construction spec and spec embedding columns for internal remix matching.
-- construction_spec stores the geometric blueprint from spec generation.
-- spec_embedding stores the vector embedding of construction_spec for cosine similarity search.

ALTER TABLE "workbench_example_prompts"
  ADD COLUMN "construction_spec" TEXT,
  ADD COLUMN "spec_embedding" vector(1536),
  ADD COLUMN "spec_embedding_model" TEXT;

-- HNSW index for cosine similarity search on spec embeddings (remix matching)
CREATE INDEX idx_wb_prompts_spec_embedding
  ON workbench_example_prompts USING hnsw (spec_embedding vector_cosine_ops)
  WHERE spec_embedding IS NOT NULL;
