-- Enhance llm_usage_events as centralized cost ledger with source context

ALTER TABLE "llm_usage_events" ADD COLUMN "experiment_id" UUID;
ALTER TABLE "llm_usage_events" ADD COLUMN "experiment_run_id" UUID;
ALTER TABLE "llm_usage_events" ADD COLUMN "source" VARCHAR(20);
ALTER TABLE "llm_usage_events" ADD COLUMN "source_label" VARCHAR(255);

-- No FK constraints — ledger must survive all deletions

CREATE INDEX idx_usage_events_source ON llm_usage_events(source, created_at);
CREATE INDEX idx_usage_events_experiment ON llm_usage_events(experiment_id);

-- Backfill existing data
UPDATE llm_usage_events SET source = 'workbench' WHERE workbench_example_id IS NOT NULL AND source IS NULL;
UPDATE llm_usage_events SET source = 'chat' WHERE chat_item_id IS NOT NULL AND source IS NULL;
UPDATE llm_usage_events SET source = 'system' WHERE source IS NULL AND purpose IN ('embeddings', 'knowledge_embedding');
UPDATE llm_usage_events SET source = 'workbench' WHERE source IS NULL;
