-- Add download count to chat items for curation signal tracking
ALTER TABLE chat_items ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;

-- Soft-delete support for chat contexts
ALTER TABLE chat_contexts ADD COLUMN deleted_at TIMESTAMPTZ;

-- Curation candidates table for admin review queue
CREATE TABLE curation_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_item_id UUID NOT NULL REFERENCES chat_items(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_curation_candidates_item_unique ON curation_candidates(chat_item_id);
CREATE INDEX idx_curation_candidates_status ON curation_candidates(status);

-- Partial index for fast candidate sync query
CREATE INDEX idx_chat_items_curation_signals ON chat_items(rating, download_count)
  WHERE role = 'assistant' AND (rating >= 1 OR download_count >= 1);
