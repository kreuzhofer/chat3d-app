-- Phase 2: LLM Prompt Summarization + Tagging

-- Tags system
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tags_name ON tags(name);

-- Tag assignments for curation candidates
CREATE TABLE curation_candidate_tags (
  candidate_id UUID NOT NULL REFERENCES curation_candidates(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  suggested_by VARCHAR(20) NOT NULL DEFAULT 'llm',
  PRIMARY KEY (candidate_id, tag_id)
);

-- Add distilled/original prompt columns to curation_candidates
ALTER TABLE curation_candidates ADD COLUMN distilled_prompt TEXT;
ALTER TABLE curation_candidates ADD COLUMN original_prompt TEXT;
