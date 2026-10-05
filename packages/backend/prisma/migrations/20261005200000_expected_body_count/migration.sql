-- The spec's expected body count (issue #136, ADR 0001's 2026-10-05
-- amendment): the number of separate solid bodies the request implies, the
-- figure the measured solid count is checked against. NULL = a spec written
-- before #136 (the marking pass, #141, fills those). The atoms' roles live in
-- verification_criteria beside text and visibility; no column needed.

ALTER TABLE workbench_example_prompts
  ADD COLUMN expected_body_count INTEGER,
  ADD CONSTRAINT workbench_example_prompts_expected_body_count_positive CHECK (expected_body_count >= 1);
