-- Add remix origin tracking to chat_contexts
ALTER TABLE chat_contexts
  ADD COLUMN remixed_from_prompt_id UUID
  REFERENCES workbench_example_prompts(id) ON DELETE SET NULL;

CREATE INDEX idx_chat_contexts_remix_origin
  ON chat_contexts(remixed_from_prompt_id)
  WHERE remixed_from_prompt_id IS NOT NULL;

-- Add remix origin tracking to curation_candidates (propagated from context)
ALTER TABLE curation_candidates
  ADD COLUMN remixed_from_prompt_id UUID
  REFERENCES workbench_example_prompts(id) ON DELETE SET NULL;

CREATE INDEX idx_curation_candidates_remix_origin
  ON curation_candidates(remixed_from_prompt_id)
  WHERE remixed_from_prompt_id IS NOT NULL;
