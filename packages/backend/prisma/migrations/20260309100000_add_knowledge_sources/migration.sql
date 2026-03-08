-- Knowledge Sources — configurable crawl sources managed via admin UI

CREATE TABLE knowledge_sources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(200) NOT NULL,
  strategy              VARCHAR(30) NOT NULL
                        CHECK (strategy IN ('github_file', 'github_test_functions', 'readthedocs', 'manual')),
  config                JSONB NOT NULL DEFAULT '{}',
  is_active             BOOLEAN NOT NULL DEFAULT true,
  last_crawl_at         TIMESTAMPTZ,
  last_crawl_status     VARCHAR(20) DEFAULT 'idle'
                        CHECK (last_crawl_status IN ('idle', 'running', 'success', 'error')),
  last_crawl_message    TEXT,
  last_crawl_added      INTEGER DEFAULT 0,
  last_crawl_skipped    INTEGER DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add source_id FK to knowledge entries
ALTER TABLE build123d_knowledge
  ADD COLUMN source_id UUID REFERENCES knowledge_sources(id) ON DELETE CASCADE;

CREATE INDEX idx_b123d_knowledge_source_id ON build123d_knowledge(source_id);

-- Expand source_type CHECK to include 'manual'
ALTER TABLE build123d_knowledge
  DROP CONSTRAINT IF EXISTS build123d_knowledge_source_type_check;
ALTER TABLE build123d_knowledge
  ADD CONSTRAINT build123d_knowledge_source_type_check
  CHECK (source_type IN ('docs', 'github_example', 'github_test', 'forum', 'blog', 'manual'));

-- Backfill: create sources for existing entries
INSERT INTO knowledge_sources (id, name, strategy, config, is_active, last_crawl_at, last_crawl_status, last_crawl_added)
SELECT
  gen_random_uuid(),
  CASE source_type
    WHEN 'github_example' THEN 'Build123d GitHub Examples'
    WHEN 'github_test'    THEN 'Build123d GitHub Tests'
    WHEN 'docs'           THEN 'Build123d ReadTheDocs'
  END,
  CASE source_type
    WHEN 'github_example' THEN 'github_file'
    WHEN 'github_test'    THEN 'github_test_functions'
    WHEN 'docs'           THEN 'readthedocs'
  END,
  CASE source_type
    WHEN 'github_example' THEN '{"repo":"gumyr/build123d","branch":"dev","directory":"examples","fileExtension":".py","skipPatterns":["*_algebra*"]}'::jsonb
    WHEN 'github_test'    THEN '{"repo":"gumyr/build123d","branch":"dev","directory":"tests","functionPrefix":"test_","minCodeLength":100}'::jsonb
    WHEN 'docs'           THEN '{"baseUrl":"https://build123d.readthedocs.io/en/latest","pages":["introductory_examples.html","tutorial_design.html","tutorial_selectors.html","tutorial_lego.html","tutorial_joints.html","tutorial_surface_modeling.html","key_concepts_builder.html","key_concepts_algebra.html","examples_1.html"]}'::jsonb
  END,
  true,
  MAX(updated_at),
  'success',
  COUNT(*)::integer
FROM build123d_knowledge
GROUP BY source_type;

-- Backfill: link existing entries to their sources
UPDATE build123d_knowledge k
SET source_id = s.id
FROM knowledge_sources s
WHERE (s.strategy = 'github_file' AND k.source_type = 'github_example')
   OR (s.strategy = 'github_test_functions' AND k.source_type = 'github_test')
   OR (s.strategy = 'readthedocs' AND k.source_type = 'docs');
