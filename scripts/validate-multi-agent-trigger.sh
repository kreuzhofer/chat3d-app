#!/usr/bin/env bash
# Validate the new spec-LLM multi-agent trigger against experiment d8ac9bae.
# Assumes the new "fake" model(s) have been registered (manually) and added as
# runs on the experiment.
#
# Usage: scripts/validate-multi-agent-trigger.sh <experiment_id>
set -euo pipefail

EXPERIMENT_ID="${1:-d8ac9bae-3f42-4fb0-9af1-aaaa8d7cb536}"

echo "=== Validation report for experiment ${EXPERIMENT_ID} ==="
echo

echo "1. Routing distribution on new runs (by model + trigger reason):"
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
SELECT er.display_name AS model,
       gt.trace->>'complexityTriggerReason' AS trigger_reason,
       count(*) AS n,
       round(avg(e.eval_score)::numeric, 2) AS avg_score,
       round(avg(gt.total_cost_usd)::numeric, 4) AS avg_cost_usd
FROM experiments x
JOIN experiment_runs er ON er.experiment_id = x.id
JOIN workbench_examples e ON e.experiment_run_id = er.id
JOIN generation_traces gt ON gt.workbench_example_id = e.id
WHERE x.id = '${EXPERIMENT_ID}'
GROUP BY er.display_name, trigger_reason
ORDER BY er.display_name, trigger_reason;
"

echo
echo "2. Per-prompt score deltas — original vs :ma columns:"
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
WITH per_prompt AS (
  SELECT p.id AS prompt_id, p.prompt,
         er.display_name AS model_label,
         e.eval_score, gt.total_cost_usd,
         gt.trace->>'complexityTriggerReason' AS reason
  FROM experiments x
  JOIN experiment_runs er ON er.experiment_id = x.id
  JOIN workbench_examples e ON e.experiment_run_id = er.id
  JOIN workbench_example_prompts p ON p.id = e.prompt_id
  JOIN generation_traces gt ON gt.workbench_example_id = e.id
  WHERE x.id = '${EXPERIMENT_ID}'
)
SELECT
  left(prompt, 60) AS prompt,
  max(CASE WHEN model_label NOT LIKE '%(multi-agent)%' AND model_label NOT LIKE '%:ma%' THEN eval_score END) AS score_orig,
  max(CASE WHEN model_label LIKE '%(multi-agent)%' OR model_label LIKE '%:ma%' THEN eval_score END) AS score_ma,
  max(CASE WHEN model_label LIKE '%(multi-agent)%' OR model_label LIKE '%:ma%' THEN reason END) AS ma_reason
FROM per_prompt
GROUP BY prompt_id, prompt
HAVING max(CASE WHEN model_label LIKE '%(multi-agent)%' OR model_label LIKE '%:ma%' THEN eval_score END) IS NOT NULL
ORDER BY (max(CASE WHEN model_label LIKE '%(multi-agent)%' OR model_label LIKE '%:ma%' THEN eval_score END) - max(CASE WHEN model_label NOT LIKE '%(multi-agent)%' AND model_label NOT LIKE '%:ma%' THEN eval_score END)) DESC NULLS LAST
LIMIT 30;
"

echo
echo "3. Headline summary — only prompts routed to multi-agent:"
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
WITH ma_prompts AS (
  SELECT DISTINCT e.prompt_id
  FROM experiments x
  JOIN experiment_runs er ON er.experiment_id = x.id
  JOIN workbench_examples e ON e.experiment_run_id = er.id
  JOIN generation_traces gt ON gt.workbench_example_id = e.id
  WHERE x.id = '${EXPERIMENT_ID}'
    AND gt.trace->>'complexityTriggerReason' IN ('spec_llm_decision','multi_part_pattern')
)
SELECT er.display_name AS model,
       count(*) AS n_prompts,
       round(avg(e.eval_score)::numeric, 2) AS avg_score,
       round(avg(gt.total_cost_usd)::numeric, 4) AS avg_cost_usd
FROM ma_prompts m
JOIN workbench_examples e ON e.prompt_id = m.prompt_id
JOIN experiment_runs er ON er.id = e.experiment_run_id
JOIN generation_traces gt ON gt.workbench_example_id = e.id
WHERE er.experiment_id = '${EXPERIMENT_ID}'
GROUP BY er.display_name
ORDER BY er.display_name;
"
