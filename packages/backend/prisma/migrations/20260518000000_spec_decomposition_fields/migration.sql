ALTER TABLE "workbench_example_prompts"
  ADD COLUMN "requires_decomposition" BOOLEAN,
  ADD COLUMN "decomposition_reasoning" TEXT;

COMMENT ON COLUMN "workbench_example_prompts"."requires_decomposition" IS
  'Spec LLM verdict — true means the prompt was routed to multi-agent codegen';
COMMENT ON COLUMN "workbench_example_prompts"."decomposition_reasoning" IS
  'Spec LLM''s short rationale for the requires_decomposition decision';
