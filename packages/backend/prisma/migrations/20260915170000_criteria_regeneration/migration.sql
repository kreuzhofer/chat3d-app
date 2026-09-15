-- Criteria regeneration under ADR 0002 (issue #89).
--
-- A prompt's criteria are regenerated as requirement atoms; the old list is
-- kept beside the new so before/after coverage is measurable, and the moment
-- is recorded so the run is resumable. An example rated against the old items
-- is Stale by items, not by instrument: the flag joins the Stale predicate and
-- the re-rating clears it.

ALTER TABLE workbench_example_prompts
  ADD COLUMN verification_criteria_previous JSONB,
  ADD COLUMN criteria_regenerated_at TIMESTAMPTZ;

ALTER TABLE workbench_examples
  ADD COLUMN rating_items_stale BOOLEAN NOT NULL DEFAULT false;
