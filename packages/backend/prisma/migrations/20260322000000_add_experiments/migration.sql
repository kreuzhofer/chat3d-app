-- Experiment tables for LLM model comparison benchmarks

CREATE TABLE "experiment_experiments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(255) NOT NULL,
  "category_id" UUID NOT NULL,
  "prompt_count" INT NOT NULL,
  "prompt_seed" INT NOT NULL DEFAULT 42,
  "tested_purpose" VARCHAR(50) NOT NULL DEFAULT 'workbench_codegen',
  "status" VARCHAR(20) NOT NULL DEFAULT 'created',
  "created_by" UUID,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_experiments_category" FOREIGN KEY ("category_id")
    REFERENCES "workbench_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_experiments_created_by" FOREIGN KEY ("created_by")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX "idx_experiments_category" ON "experiment_experiments"("category_id");
CREATE INDEX "idx_experiments_status" ON "experiment_experiments"("status");

CREATE TABLE "experiment_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "experiment_id" UUID NOT NULL,
  "model_id" UUID NOT NULL,
  "model_label" VARCHAR(255) NOT NULL,
  "run_order" INT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_exp_runs_experiment" FOREIGN KEY ("experiment_id")
    REFERENCES "experiment_experiments"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_exp_runs_model" FOREIGN KEY ("model_id")
    REFERENCES "llm_models"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "idx_exp_runs_experiment" ON "experiment_runs"("experiment_id");

CREATE TABLE "experiment_prompt_selections" (
  "experiment_id" UUID NOT NULL,
  "prompt_id" UUID NOT NULL,
  "selection_order" INT NOT NULL,

  PRIMARY KEY ("experiment_id", "prompt_id"),

  CONSTRAINT "fk_exp_prompts_experiment" FOREIGN KEY ("experiment_id")
    REFERENCES "experiment_experiments"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_exp_prompts_prompt" FOREIGN KEY ("prompt_id")
    REFERENCES "workbench_example_prompts"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Link workbench examples to experiment runs
ALTER TABLE "workbench_examples"
  ADD COLUMN "experiment_run_id" UUID;

ALTER TABLE "workbench_examples"
  ADD CONSTRAINT "fk_wb_examples_experiment_run"
  FOREIGN KEY ("experiment_run_id")
  REFERENCES "experiment_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE INDEX "idx_wb_examples_experiment_run" ON "workbench_examples"("experiment_run_id");
