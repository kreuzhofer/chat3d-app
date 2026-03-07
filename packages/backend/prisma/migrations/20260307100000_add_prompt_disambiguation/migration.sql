-- Add disambiguation columns to workbench_example_prompts
ALTER TABLE "workbench_example_prompts"
  ADD COLUMN "disambiguation_questions" JSONB,
  ADD COLUMN "disambiguation_status" VARCHAR(20),
  ADD COLUMN "spec_interpretation" TEXT;
