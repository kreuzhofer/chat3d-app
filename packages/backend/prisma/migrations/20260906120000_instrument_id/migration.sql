-- The instrument every evaluation was answered under (issue #36, ADR 0003),
-- and the judge's thinking setting beside it (issue #58, ADR 0004).
--
-- 3,228 stored evaluations were produced under 3,015 distinct system prompts,
-- so no two ratings in the corpus were known to be comparable. From here on
-- the judge answers under one instrument, identified by a name plus a content
-- hash of the whole procedure (template, response schema, zoom follow-up
-- prompt and settings), and every rating records that id. A rating whose id
-- is not the current one is Stale: still readable, excluded from the
-- fine-tuning filter, re-rated in batches. Rows from before ids existed keep
-- NULL and read as pre-versioning.
--
-- `vlm_model` stores provider/model_name only, so two model rows of one model
-- that differ in their thinking setting write the same string; the effective
-- thinking effort is stamped so a qualified judge's rows can be told from a
-- provisional one's.

ALTER TABLE workbench_examples
  ADD COLUMN vlm_instrument_id VARCHAR(80),
  ADD COLUMN vlm_thinking_effort VARCHAR(16);

COMMENT ON COLUMN workbench_examples.vlm_instrument_id IS
  'Instrument id the visual judge answered under: <name>@<hash12> of the whole procedure (ADR 0003). NULL = rated before ids existed, or not rated.';
COMMENT ON COLUMN workbench_examples.vlm_thinking_effort IS
  'The visual judge''s effective thinking effort for this rating (off | low | medium | high | max); NULL = server default or pre-versioning.';

CREATE INDEX idx_wb_examples_vlm_instrument
  ON workbench_examples (vlm_instrument_id);

ALTER TABLE vlm_experiment_results
  ADD COLUMN instrument_id VARCHAR(80),
  ADD COLUMN thinking_effort VARCHAR(16);

COMMENT ON COLUMN vlm_experiment_results.instrument_id IS
  'Instrument id this result was answered under: the run''s variant id, or production, plus the procedure hash (ADR 0003).';
COMMENT ON COLUMN vlm_experiment_results.thinking_effort IS
  'The judge''s effective thinking effort for this result; NULL = server default or pre-versioning.';
