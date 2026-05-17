-- One row per retrieved snippet per workbench_example generation.
-- "used" is populated post-loop by the attribution pass.

CREATE TABLE rag_retrieval_events (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  workbench_example_id UUID NOT NULL,
  source              VARCHAR(40) NOT NULL,
  snippet_ref         TEXT,
  snippet_summary     TEXT NOT NULL,
  identifiers         JSONB NOT NULL,
  retrieval_step      INTEGER,
  used                BOOLEAN NOT NULL DEFAULT FALSE,
  use_evidence        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rag_retrieval_events_pkey PRIMARY KEY (id),
  CONSTRAINT rag_retrieval_events_workbench_example_fk
    FOREIGN KEY (workbench_example_id)
    REFERENCES workbench_examples(id)
    ON DELETE CASCADE
);

CREATE INDEX idx_rag_retrieval_events_example ON rag_retrieval_events (workbench_example_id);
CREATE INDEX idx_rag_retrieval_events_source_used ON rag_retrieval_events (source, used);
-- Partial index: indexed only when snippet_ref is set. This is not represented
-- in schema.prisma because Prisma DSL has no WHERE-clause support. If you see
-- a future migration trying to drop this index and recreate it as a full
-- index, that migration is wrong — discard it.
CREATE INDEX idx_rag_retrieval_events_snippet_ref ON rag_retrieval_events (source, snippet_ref) WHERE snippet_ref IS NOT NULL;
