-- Judge-prompt variants on VLM experiment runs (issue #35).
--
-- A run is one model under one instrument. Until now the instrument was
-- always production's, assembled per example, so two judge prompts could not
-- be compared under identical conditions. A run may now carry its own
-- instrument template; the short id is the grouping key for its results.
-- Both NULL means production's instrument, as before.

ALTER TABLE experiment_runs
  ADD COLUMN judge_prompt_variant_id VARCHAR(64),
  ADD COLUMN judge_prompt_template TEXT;

COMMENT ON COLUMN experiment_runs.judge_prompt_variant_id IS
  'Judge-prompt variant this run judges under (issue #35). NULL = production instrument.';
COMMENT ON COLUMN experiment_runs.judge_prompt_template IS
  'The variant''s instrument template with specimen slots. NULL = production instrument.';
