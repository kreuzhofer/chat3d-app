-- Provenance for the visual judge's checklist (issue #34).
--
-- Until issue #33 was fixed, spec enrichment turned every verification
-- criterion into the literal string "undefined", and that placeholder list
-- replaced the real checklist before it reached the judge. 1,333 production
-- examples -- 1,210 of them auto-approved into the fine-tuning set -- hold
-- scores produced that way.
--
-- Those rows were previously identifiable only by
-- `vlm_system_prompt LIKE '%. undefined%'`, a string match against a prompt
-- template that is free to change. This column records the fact durably.

ALTER TABLE workbench_examples
  ADD COLUMN eval_checklist_state VARCHAR(16);

COMMENT ON COLUMN workbench_examples.eval_checklist_state IS
  'Which checklist the visual judge was shown: real | empty | placeholder. '
  '"placeholder" marks pre-#33 rows whose scores are not comparable (issue #34).';

-- Backfill from the stored judge prompt.
--
-- Order matters: the placeholder test must run before the "has a checklist
-- block" test, because a placeholder prompt contains the heading too.
--
-- The list marker in '%. undefined%' is load-bearing. The bare word appears in
-- legitimate prompt prose ("do NOT flag them as undefined or unavailable"),
-- and matching that would misclassify every bd_warehouse example as defective.
UPDATE workbench_examples
SET eval_checklist_state = CASE
  WHEN vlm_system_prompt LIKE '%. undefined%'          THEN 'placeholder'
  WHEN vlm_system_prompt ILIKE '%verification checklist%' THEN 'real'
  ELSE 'empty'
END
WHERE vlm_system_prompt IS NOT NULL AND vlm_system_prompt <> '';

-- Rows with no stored prompt stay NULL: "we cannot tell" is not "no checklist".

CREATE INDEX idx_wb_examples_checklist_state
  ON workbench_examples (eval_checklist_state)
  WHERE eval_checklist_state IS NOT NULL;
