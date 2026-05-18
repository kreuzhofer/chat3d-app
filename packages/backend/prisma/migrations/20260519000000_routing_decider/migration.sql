-- Add model tier to llm_models (admin-set; null = treat as 'mid')
ALTER TABLE "llm_models"
  ADD COLUMN "tier" VARCHAR(20);
COMMENT ON COLUMN "llm_models"."tier" IS
  'Model capability tier (frontier|mid|small) used by the decomposition decider to set decompose thresholds.';

-- Add per-run routing override to experiment_runs
ALTER TABLE "experiment_runs"
  ADD COLUMN "routing_override" VARCHAR(20) NOT NULL DEFAULT 'auto';
COMMENT ON COLUMN "experiment_runs"."routing_override" IS
  'Per-run override of the live decomposition decider; auto = use decider, force_decompose/force_single bypass it.';

-- Decision cache, version-stamped so bumping the decider system prompt auto-invalidates rows.
CREATE TABLE "decomposition_decisions" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "prompt_id"        UUID NOT NULL REFERENCES "workbench_example_prompts"("id") ON DELETE CASCADE,
  "model_id"         UUID NOT NULL REFERENCES "llm_models"("id") ON DELETE CASCADE,
  "decider_version"  VARCHAR(40) NOT NULL,
  "decompose"        BOOLEAN NOT NULL,
  "reasoning"        TEXT NOT NULL,
  "created_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "decomp_decisions_prompt_model_unique"
  ON "decomposition_decisions"("prompt_id", "model_id");
CREATE INDEX "idx_decomp_decisions_version"
  ON "decomposition_decisions"("decider_version");
COMMENT ON TABLE "decomposition_decisions" IS
  'Cache of live decomposition decider verdicts. Unique on (prompt_id, model_id); decider_version mismatch treated as cache miss and overwritten via ON CONFLICT.';
