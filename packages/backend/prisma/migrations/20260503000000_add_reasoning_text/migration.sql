-- Persist the model's chain-of-thought (reasoning_text) for high-value
-- training-relevant purposes (agent_orchestration, spec_generation).
-- Other purposes leave this NULL to keep storage small. PostgreSQL's
-- TOAST handles long text efficiently; no explicit compression needed.

ALTER TABLE "llm_usage_events" ADD COLUMN "reasoning_text" TEXT;
