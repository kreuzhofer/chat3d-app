-- Add 'reference_url' strategy to knowledge_sources
ALTER TABLE knowledge_sources
  DROP CONSTRAINT IF EXISTS knowledge_sources_strategy_check;
ALTER TABLE knowledge_sources
  ADD CONSTRAINT knowledge_sources_strategy_check
  CHECK (strategy IN ('github_file', 'github_test_functions', 'readthedocs', 'manual', 'reference_upload', 'reference_url'));
