-- Delete orphan `pending` workbench_examples that have a sibling non-pending
-- row for the same (experiment_run_id, prompt_id).
--
-- Background: persistAbortedPipeline used to insert a fresh row instead of
-- updating the early placeholder created at pipeline start, leaving a
-- {pending, error} pair tied to the same (prompt, run). The duplicates
-- corrupted the per-prompt comparison table's column rendering on the
-- admin UI. The codegen path now reuses earlyExampleId; this migration
-- removes the historical stragglers.

DELETE FROM workbench_examples AS p
USING workbench_examples AS s
WHERE p.render_status = 'pending'
  AND s.render_status <> 'pending'
  AND p.experiment_run_id IS NOT NULL
  AND p.experiment_run_id = s.experiment_run_id
  AND p.prompt_id = s.prompt_id
  AND p.id <> s.id;
