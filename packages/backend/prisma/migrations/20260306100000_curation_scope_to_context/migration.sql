-- Rescope curation_candidates from chat_item to chat_context.
-- A curation candidate represents a conversation, not a single response.

-- Drop existing data, indexes, and column
DELETE FROM curation_candidates;
DROP INDEX IF EXISTS idx_curation_candidates_item_unique;
ALTER TABLE curation_candidates DROP COLUMN chat_item_id;

-- Add chat_context_id column
ALTER TABLE curation_candidates ADD COLUMN chat_context_id UUID NOT NULL REFERENCES chat_contexts(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX idx_curation_candidates_context_unique ON curation_candidates(chat_context_id);
