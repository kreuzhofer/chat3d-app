ALTER TABLE "workbench_example_prompts"
  ADD COLUMN "eval_plan" JSONB NULL;

CREATE INDEX "idx_wb_prompts_eval_plan_weight"
  ON "workbench_example_prompts" (((eval_plan->>'suggestedCodeWeight')::float))
  WHERE eval_plan IS NOT NULL;

COMMENT ON COLUMN "workbench_example_prompts"."eval_plan" IS
  'Per-prompt eval plan from spec LLM: {systemPrompt, inspectionPlan, suggestedCodeWeight}. Null = legacy global pipeline.';

ALTER TABLE "workbench_examples"
  ADD COLUMN "composite_weight_source" VARCHAR(20) NULL;

ALTER TABLE "workbench_examples"
  ADD CONSTRAINT "workbench_examples_composite_weight_source_check"
  CHECK (
    "composite_weight_source" IS NULL OR
    "composite_weight_source" IN ('eval_plan', 'adaptive', 'global')
  );

COMMENT ON COLUMN "workbench_examples"."composite_weight_source" IS
  'Which weight resolution branch produced this example''s composite score.';
