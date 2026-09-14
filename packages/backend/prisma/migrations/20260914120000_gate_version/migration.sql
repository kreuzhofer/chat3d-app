-- The approval gate's version (ADR 0001, issue #88).
--
-- The verdict is derived from the stored item answers; when the rule
-- changes, approval is recomputed from those answers and the version says
-- which rule a row's verdict came from. NULL: derived before versions
-- existed, or decided by a human.

ALTER TABLE workbench_examples ADD COLUMN gate_version VARCHAR(32);
COMMENT ON COLUMN workbench_examples.gate_version IS
  'The approval-gate rule that derived approval_status (ADR 0001). NULL = pre-versioning or a human decision.';
