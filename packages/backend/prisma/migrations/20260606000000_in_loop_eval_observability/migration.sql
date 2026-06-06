-- Add in-loop evaluation observability fields to workbench_examples
-- sub_agent_verifications: per-component pass/fail counts + failed items (multi-agent only)
-- pre_submit_verification: single-agent evaluate_checklist tool-usage stats

ALTER TABLE "workbench_examples" ADD COLUMN IF NOT EXISTS "sub_agent_verifications" JSONB;
ALTER TABLE "workbench_examples" ADD COLUMN IF NOT EXISTS "pre_submit_verification" JSONB;
