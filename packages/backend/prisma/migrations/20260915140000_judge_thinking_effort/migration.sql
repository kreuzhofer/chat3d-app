-- The thinking effort a VLM experiment run judges at (issue #99).
--
-- An experiment resolves its judge from a model row, not from the vlm_eval
-- purpose, so the row's default_thinking_effort used to decide what the run
-- measured — and under ADR 0004 a different thinking setting is a different
-- judge. A run now carries its effort explicitly; the executor runs at "off"
-- unless the run asks otherwise. NULL is a run created before this column,
-- which ran at whatever its row said and is stamped so on its results.

ALTER TABLE experiment_runs
  ADD COLUMN judge_thinking_effort VARCHAR(16);

COMMENT ON COLUMN experiment_runs.judge_thinking_effort IS
  'Thinking effort the run''s judge is run at (issue #99): off | low | medium | high | max. NULL = created before the column; ran at the model row''s default.';
