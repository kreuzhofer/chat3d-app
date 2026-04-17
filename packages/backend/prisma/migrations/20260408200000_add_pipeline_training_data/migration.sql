-- Capture full LLM outputs across all pipeline stages for fine-tuning training data

-- Code review training data on workbench examples
ALTER TABLE "workbench_examples" ADD COLUMN "code_review_raw_response" TEXT;
ALTER TABLE "workbench_examples" ADD COLUMN "code_review_reasoning" TEXT;
ALTER TABLE "workbench_examples" ADD COLUMN "code_review_system_prompt" TEXT;

-- Agent codegen conversation history
ALTER TABLE "workbench_examples" ADD COLUMN "agent_conversation" JSONB;
ALTER TABLE "workbench_examples" ADD COLUMN "agent_system_prompt" TEXT;

-- Spec generation training data on prompts
ALTER TABLE "workbench_example_prompts" ADD COLUMN "spec_raw_response" TEXT;
ALTER TABLE "workbench_example_prompts" ADD COLUMN "spec_system_prompt" TEXT;

-- Spec enrichment training data on prompts
ALTER TABLE "workbench_example_prompts" ADD COLUMN "enrichment_raw_response" TEXT;
ALTER TABLE "workbench_example_prompts" ADD COLUMN "enrichment_system_prompt" TEXT;
ALTER TABLE "workbench_example_prompts" ADD COLUMN "enrichment_user_message" TEXT;
