-- Capture full VLM evaluation output, reasoning, and system prompt for training data
ALTER TABLE "workbench_examples" ADD COLUMN "vlm_raw_response" TEXT;
ALTER TABLE "workbench_examples" ADD COLUMN "vlm_reasoning" TEXT;
ALTER TABLE "workbench_examples" ADD COLUMN "vlm_system_prompt" TEXT;

ALTER TABLE "vlm_experiment_results" ADD COLUMN "raw_response" TEXT;
ALTER TABLE "vlm_experiment_results" ADD COLUMN "reasoning" TEXT;
ALTER TABLE "vlm_experiment_results" ADD COLUMN "system_prompt" TEXT;
