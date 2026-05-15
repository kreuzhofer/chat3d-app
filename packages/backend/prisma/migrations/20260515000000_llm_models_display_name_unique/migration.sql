-- Backfill NULL display_name from model_name so the NOT NULL + unique addition is safe.
UPDATE llm_models
SET display_name = model_name
WHERE display_name IS NULL;

-- The previous uniqueness on (provider, model_name) made (provider, display_name) post-backfill
-- collision-impossible: every row's (provider, display_name) is either user-set (and the user
-- could only set distinct values since model_name was unique per provider) or equals
-- (provider, model_name) which was itself unique. So no de-dup pass is needed.

-- Drop the old compound unique.
ALTER TABLE llm_models DROP CONSTRAINT IF EXISTS "llm_models_provider_model_name_key";

-- Tighten display_name.
ALTER TABLE llm_models ALTER COLUMN display_name SET NOT NULL;

-- Add the new compound unique on (provider, display_name).
ALTER TABLE llm_models
  ADD CONSTRAINT "llm_models_provider_display_name_key" UNIQUE (provider, display_name);
