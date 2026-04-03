-- Add experiment type column (backward-compatible default)
ALTER TABLE "experiment_experiments"
  ADD COLUMN "type" VARCHAR(30) NOT NULL DEFAULT 'codegen';

-- Example selections for VLM experiments (selects existing examples, not prompts)
CREATE TABLE "vlm_experiment_example_selections" (
  "experiment_id"   UUID NOT NULL,
  "example_id"      UUID NOT NULL,
  "selection_order"  INT NOT NULL,
  PRIMARY KEY ("experiment_id", "example_id"),
  CONSTRAINT "fk_vlm_sel_exp" FOREIGN KEY ("experiment_id")
    REFERENCES "experiment_experiments"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_vlm_sel_ex" FOREIGN KEY ("example_id")
    REFERENCES "workbench_examples"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Per-run per-example VLM evaluation results
CREATE TABLE "vlm_experiment_results" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id"            UUID NOT NULL,
  "example_id"        UUID NOT NULL,
  "visual_score"      DECIMAL(3,1),
  "issues"            JSONB DEFAULT '[]',
  "suggestions"       JSONB DEFAULT '[]',
  "checklist_results" JSONB,
  "prompt_tokens"     INT,
  "completion_tokens" INT,
  "duration_ms"       INT,
  "error"             TEXT,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_vlm_res_run" FOREIGN KEY ("run_id")
    REFERENCES "experiment_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_vlm_res_ex" FOREIGN KEY ("example_id")
    REFERENCES "workbench_examples"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  UNIQUE ("run_id", "example_id")
);

CREATE INDEX "idx_vlm_res_run" ON "vlm_experiment_results"("run_id");
CREATE INDEX "idx_vlm_res_example" ON "vlm_experiment_results"("example_id");
