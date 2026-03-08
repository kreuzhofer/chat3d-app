-- Build123d Knowledge Base
-- External knowledge entries (docs, examples, tests, forum posts) for agent RAG

CREATE TABLE build123d_knowledge (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url          TEXT NOT NULL,
  source_type         VARCHAR(20) NOT NULL
                      CHECK (source_type IN ('docs', 'github_example', 'github_test', 'forum', 'blog')),
  title               VARCHAR(500) NOT NULL,
  description         TEXT,
  code                TEXT NOT NULL,
  concepts            TEXT[] NOT NULL DEFAULT '{}',
  build123d_version   VARCHAR(20),
  validated_at        TIMESTAMPTZ,
  validation_status   VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (validation_status IN ('pending', 'valid', 'invalid', 'error')),
  quality_score       INTEGER CHECK (quality_score BETWEEN 1 AND 10),
  embedding           vector(1536),
  embedding_model     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_b123d_knowledge_embedding ON build123d_knowledge
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_b123d_knowledge_concepts ON build123d_knowledge
  USING gin (concepts);
CREATE INDEX idx_b123d_knowledge_source_type ON build123d_knowledge(source_type);
CREATE INDEX idx_b123d_knowledge_validation ON build123d_knowledge(validation_status);
