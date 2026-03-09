-- Add 'reference_upload' strategy to knowledge_sources
ALTER TABLE knowledge_sources
  DROP CONSTRAINT IF EXISTS knowledge_sources_strategy_check;
ALTER TABLE knowledge_sources
  ADD CONSTRAINT knowledge_sources_strategy_check
  CHECK (strategy IN ('github_file', 'github_test_functions', 'readthedocs', 'manual', 'reference_upload'));

-- Add 'reference' source_type to build123d_knowledge
ALTER TABLE build123d_knowledge
  DROP CONSTRAINT IF EXISTS build123d_knowledge_source_type_check;
ALTER TABLE build123d_knowledge
  ADD CONSTRAINT build123d_knowledge_source_type_check
  CHECK (source_type IN ('docs', 'github_example', 'github_test', 'forum', 'blog', 'manual', 'reference'));
