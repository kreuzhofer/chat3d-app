-- Convert eval score columns from integer to decimal(3,1) for float precision
ALTER TABLE "workbench_examples"
  ALTER COLUMN "eval_score" TYPE DECIMAL(3,1) USING "eval_score"::DECIMAL(3,1),
  ALTER COLUMN "visual_score" TYPE DECIMAL(3,1) USING "visual_score"::DECIMAL(3,1),
  ALTER COLUMN "code_eval_score" TYPE DECIMAL(3,1) USING "code_eval_score"::DECIMAL(3,1);
