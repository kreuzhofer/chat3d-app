-- Backfill experiment_runs.model_label to use llm_models.display_name instead of model_name.
-- Preserves the "(N ex)" few-shot suffix.

UPDATE experiment_runs er
SET model_label = m.provider || '/' || m.display_name ||
  CASE
    WHEN er.few_shot_count IS NOT NULL
      THEN ' (' || er.few_shot_count || ' ex)'
    ELSE ''
  END
FROM llm_models m
WHERE er.model_id = m.id;
