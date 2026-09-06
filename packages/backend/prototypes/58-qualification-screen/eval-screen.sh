#!/bin/zsh
# Evaluate the #58 screen: both arms vs the zoom-enabled reference 786b6e3c (zoom mode),
# plus glm new-run vs its earlier control run 3b5edb08 (stability pair: same judge, same instrument).
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
S=/private/tmp/claude-501/-Users-daniel-src-github-kreuzhofer-chat3d-app/6a00f744-3581-4c93-9f28-9b93d0535273/scratchpad
EXP=$(cat "$S/exp58.txt")
REF=786b6e3c-ffce-48b1-83db-288bd833be3f
GLM_OLD=3b5edb08-de0b-4494-9abf-3e87d4d180a3
docker compose exec -T postgres psql -U chat3d -d chat3d -Atc "select r.id||' '||r.model_label from experiment_runs r where r.experiment_id='$EXP' order by run_order" > "$S/runs58.txt"
QWEN=$(grep -i qwen "$S/runs58.txt" | cut -d' ' -f1); GLM=$(grep -i glm "$S/runs58.txt" | cut -d' ' -f1)
for pair in "QWEN-vs-REF $QWEN $REF" "GLM-vs-REF $GLM $REF" "GLM-new-vs-GLM-control(stability) $GLM $GLM_OLD"; do
  read -r label cand ref <<< "$pair"
  echo; echo "################ $label ################"
  python3 "$S/compare-items.py" "$cand" "$ref" 2>&1 | grep -vE "^\s*$"
done
echo; echo "################ follow-up parser fallbacks (prose before JSON) ################"
docker compose exec -T postgres psql -U chat3d -d chat3d -Atc "
select r.model_label, count(*) filter (where x.error is not null) errors,
 count(*) filter (where x.checklist_results is null or jsonb_typeof(x.checklist_results)<>'array' or jsonb_array_length(x.checklist_results)=0) missing_cl,
 round(avg(x.duration_ms)/1000.0,1) s_per_ex, round(avg(x.completion_tokens)) out_tok, sum(x.prompt_tokens) in_tok
from vlm_experiment_results x join experiment_runs r on r.id=x.run_id where r.experiment_id='$EXP' group by r.model_label, r.run_order order by r.run_order"
echo; echo "################ ITEM GATE (ADR 0001): all items pass, examples with >=3 items ################"
echo "glm control 3b5edb08 vs REF: $(python3 "$S/gate58.py" $GLM_OLD $REF)"
echo "QWEN vs REF:                 $(python3 "$S/gate58.py" $QWEN $REF)"
echo "GLM new vs REF:              $(python3 "$S/gate58.py" $GLM $REF)"
echo "GLM new vs GLM control:      $(python3 "$S/gate58.py" $GLM $GLM_OLD)"
echo; echo "################ zoom follow-up details: fallback heuristic (raw text <=200 chars containing a brace or 'pass') ################"
docker compose exec -T postgres psql -U chat3d -d chat3d -Atc "
select r.model_label, count(*) zoomed,
 count(*) filter (where length(i->>'detail') <= 210 and ((i->>'detail') like '%{%' or (i->>'detail') ilike '%\"pass\"%')) suspect_fallback
from vlm_experiment_results x join experiment_runs r on r.id=x.run_id, jsonb_array_elements(x.checklist_results) i
where r.experiment_id='$EXP' and (i->>'detail') like '[2x zoom]%' group by r.model_label, r.run_order order by r.run_order"
