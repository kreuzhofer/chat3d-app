-- Add streaming_enabled flag to llm_models (default true for backward compatibility)
ALTER TABLE "llm_models" ADD COLUMN "streaming_enabled" BOOLEAN NOT NULL DEFAULT true;
