-- The code reviewer's answers to the code-routed items (ADR 0001, issue #105).
--
-- The gate counts every item "across whichever evaluators answered them";
-- until now only the visual judge's answers were stored, so code-routed
-- criteria were outside the gate and a six-atom prompt reached it with two
-- items. The reviewer's answers live beside the judge's, not inside them:
-- the judge's list is the instrument's, the screen pairs it by position,
-- and the adjudications index into it.

ALTER TABLE workbench_examples ADD COLUMN code_checklist_results JSONB;
COMMENT ON COLUMN workbench_examples.code_checklist_results IS
  'Code reviewer answers per code-routed criterion: [{question, pass (true/false/null = unanswered), detail}] (ADR 0001, #105).';
