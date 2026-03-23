-- Add description field to workbench_example_prompts
-- Describes the techniques demonstrated and purpose (separate from the prompt which describes the model)
ALTER TABLE workbench_example_prompts ADD COLUMN IF NOT EXISTS description text;
