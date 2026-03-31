-- Add output tokens per second column to usage events
ALTER TABLE "llm_usage_events"
ADD COLUMN "output_tokens_per_second" DECIMAL(10, 2);
