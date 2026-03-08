-- Add eval_checklist_results JSONB column to workbench_examples
-- Stores ChecklistResult[] from VLM verification: [{question, pass, detail}]
ALTER TABLE "workbench_examples"
  ADD COLUMN "eval_checklist_results" JSONB;

-- Add detected_operations TEXT[] column to workbench_example_prompts
-- Stores operation keys detected from the prompt text (e.g. 'fillets', 'loft', 'sweep')
ALTER TABLE "workbench_example_prompts"
  ADD COLUMN "detected_operations" TEXT[] DEFAULT '{}';

-- GIN index for operation-filtered queries
CREATE INDEX "idx_wb_prompts_operations" ON "workbench_example_prompts" USING gin ("detected_operations");
