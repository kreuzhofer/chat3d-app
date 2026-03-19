-- Add eval breakdown columns to workbench_examples
ALTER TABLE "workbench_examples"
  ADD COLUMN "visual_score" DECIMAL(3,1),
  ADD COLUMN "code_eval_score" DECIMAL(3,1),
  ADD COLUMN "assertion_pass_rate" DECIMAL(3,2),
  ADD COLUMN "eval_source" VARCHAR(20);

-- Change eval_score from integer to decimal(3,1) for weighted float scores
ALTER TABLE "workbench_examples"
  ALTER COLUMN "eval_score" TYPE DECIMAL(3,1) USING "eval_score"::DECIMAL(3,1);
