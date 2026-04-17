-- Add vlm_eval_preamble column to llm_models for per-model VLM evaluation prompt customization
ALTER TABLE "llm_models" ADD COLUMN "vlm_eval_preamble" TEXT;
