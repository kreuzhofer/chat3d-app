-- Persist spec generation outputs on prompts so re-render/re-eval can use them
ALTER TABLE workbench_example_prompts
  ADD COLUMN code_assertions JSONB,
  ADD COLUMN verification_checklist JSONB,
  ADD COLUMN verification_criteria JSONB;
