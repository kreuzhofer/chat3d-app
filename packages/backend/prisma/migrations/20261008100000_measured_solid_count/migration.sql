-- The measured solid count (issue #137): the number of separate solids the
-- Build123d service counted on root_part, the model written to STEP/STL, at
-- the render the evaluation judged. A diagnostic beside the spec's expected
-- body count until the Gate makes it a structural item (ADR 0001's
-- 2026-10-05 amendment). NULL = rendered before #137, or nothing measured.

ALTER TABLE workbench_examples
  ADD COLUMN measured_solid_count INTEGER,
  ADD CONSTRAINT workbench_examples_measured_solid_count_nonnegative CHECK (measured_solid_count >= 0);
