-- Add provider_type column to llm_providers for OpenAI-compatible providers
ALTER TABLE "llm_providers" ADD COLUMN "provider_type" VARCHAR(50);
