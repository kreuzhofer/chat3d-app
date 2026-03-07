-- Post-migration SQL: constraints and indexes that Prisma cannot express.
-- Run after `prisma migrate deploy` or `prisma migrate reset`.

-- CHECK constraints
ALTER TABLE chat_items DROP CONSTRAINT IF EXISTS chat_items_role_check;
ALTER TABLE chat_items ADD CONSTRAINT chat_items_role_check CHECK (role IN ('user', 'assistant'));

ALTER TABLE chat_items DROP CONSTRAINT IF EXISTS chat_items_rating_check;
ALTER TABLE chat_items ADD CONSTRAINT chat_items_rating_check CHECK (rating IN (-1, 0, 1));

ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_id_check;
ALTER TABLE app_settings ADD CONSTRAINT app_settings_id_check CHECK (id = TRUE);

ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_quota_check;
ALTER TABLE app_settings ADD CONSTRAINT app_settings_quota_check CHECK (invitation_quota_per_user >= 0);

ALTER TABLE workbench_categories DROP CONSTRAINT IF EXISTS workbench_categories_complexity_check;
ALTER TABLE workbench_categories ADD CONSTRAINT workbench_categories_complexity_check CHECK (complexity BETWEEN 1 AND 10);

ALTER TABLE workbench_examples DROP CONSTRAINT IF EXISTS workbench_examples_render_status_check;
ALTER TABLE workbench_examples ADD CONSTRAINT workbench_examples_render_status_check CHECK (render_status IN ('pending', 'rendering', 'success', 'error'));

ALTER TABLE workbench_examples DROP CONSTRAINT IF EXISTS workbench_examples_approval_status_check;
ALTER TABLE workbench_examples ADD CONSTRAINT workbench_examples_approval_status_check CHECK (approval_status IN ('pending', 'auto_approved', 'human_approved', 'rejected'));

ALTER TABLE workbench_examples DROP CONSTRAINT IF EXISTS workbench_examples_eval_score_check;
ALTER TABLE workbench_examples ADD CONSTRAINT workbench_examples_eval_score_check CHECK (eval_score BETWEEN 1 AND 10);

ALTER TABLE curation_candidates DROP CONSTRAINT IF EXISTS curation_candidates_status_check;
ALTER TABLE curation_candidates ADD CONSTRAINT curation_candidates_status_check
  CHECK (status IN ('pending', 'reviewing', 'approved', 'rejected', 'dismissed'));

ALTER TABLE curation_candidate_tags DROP CONSTRAINT IF EXISTS curation_candidate_tags_suggested_by_check;
ALTER TABLE curation_candidate_tags ADD CONSTRAINT curation_candidate_tags_suggested_by_check
  CHECK (suggested_by IN ('llm', 'admin'));

-- HNSW vector index for cosine similarity search on prompt embeddings
CREATE INDEX IF NOT EXISTS idx_wb_prompts_embedding
  ON workbench_example_prompts USING hnsw (embedding vector_cosine_ops);
