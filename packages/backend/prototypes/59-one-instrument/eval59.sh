#!/bin/zsh
# Evaluate the #59 run: the first instrument revision (one instrument, eight views, evidence clause, no plan
# text) on glm-5.3-flash (thinking off), the 125. Pairs: NEW vs #56's guarded run 60cdd170 (same guards, old
# instrument text: isolates the revision), NEW vs #50's control 3b5edb08 (the ticket's control), NEW vs the
# zoom-enabled reference 786b6e3c; the item gate; the plan-carrying 33 vs the rest; evidence and '...' rates;
# one instrument id per run; the views each run's prompt promised.
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
S=${S:-$(cd "$(dirname "$0")" && pwd)}
NEW=$(cat "$S/run59.txt")
REF=786b6e3c-ffce-48b1-83db-288bd833be3f
GLM_56=60cdd170-0000-0000-0000-000000000000   # placeholder, resolved below
GLM_50=3b5edb08-de0b-4494-9abf-3e87d4d180a3
psql() { docker compose exec -T postgres psql -U chat3d -d chat3d -Atc "$1"; }
GLM_56=$(psql "select id from experiment_runs where id::text like '60cdd170%'")

echo "################ run summary ################"
psql "select left(r.id::text,8) run, r.model_label, r.status, count(x.id) rows, count(*) filter (where x.error is not null) errors,
 count(*) filter (where x.checklist_results is null or jsonb_typeof(x.checklist_results)<>'array' or jsonb_array_length(x.checklist_results)=0) missing_cl,
 count(distinct x.instrument_id) instrument_ids, min(x.instrument_id) instrument_id, min(x.thinking_effort) effort,
 round(avg(x.duration_ms)/1000.0,1) s_per_ex, round(avg(x.completion_tokens)) out_tok
from experiment_runs r left join vlm_experiment_results x on x.run_id=r.id where r.id in ('$NEW','$GLM_56','$GLM_50','$REF') group by r.id order by r.started_at"

echo; echo "################ views promised by the stored prompt, per run ################"
psql "select left(r.id::text,8) run, coalesce(substring(x.system_prompt from 'You are provided ([0-9]+ )?labeled views'), '?') views, count(*)
from vlm_experiment_results x join experiment_runs r on r.id=x.run_id where r.id in ('$NEW','$GLM_56','$GLM_50','$REF') group by 1,2 order by 1,2"

for pair in "NEW-vs-GLM-#56-guarded(60cdd170) $NEW $GLM_56" "NEW-vs-GLM-#50-control(3b5edb08) $NEW $GLM_50" "NEW-vs-REF $NEW $REF" "GLM-#56-guarded-vs-REF $GLM_56 $REF"; do
  read -r label cand ref <<< "$pair"
  echo; echo "################ $label ################"
  python3 "$S/compare-items.py" "$cand" "$ref" 2>&1 | grep -vE "^\s*$"
done

echo; echo "################ ITEM GATE (ADR 0001): all items pass, examples with >=3 items ################"
echo "NEW vs REF:                 $(python3 "$S/gate58.py" $NEW $REF)"
echo "GLM #56 guarded vs REF:     $(python3 "$S/gate58.py" $GLM_56 $REF)"
echo "GLM #50 control vs REF:     $(python3 "$S/gate58.py" $GLM_50 $REF)"
echo "NEW vs GLM #56 guarded:     $(python3 "$S/gate58.py" $NEW $GLM_56)"
echo "NEW vs GLM #50 control:     $(python3 "$S/gate58.py" $NEW $GLM_50)"

echo; echo "################ the 33 plan-carrying examples vs the rest ################"
psql "select s.example_id from vlm_experiment_example_selections s join workbench_examples e on e.id=s.example_id join workbench_example_prompts p on p.id=e.prompt_id
where s.experiment_id='7337a398-425c-40ed-8455-a8b4ff0d1ec4' and p.eval_plan is not null" > "$S/plan33.txt"
for pair in "NEW-vs-REF $NEW $REF" "GLM-#56-vs-REF $GLM_56 $REF" "NEW-vs-GLM-#56 $NEW $GLM_56"; do
  read -r label cand ref <<< "$pair"
  echo; echo "---- $label ----"
  python3 "$S/subset59.py" "$cand" "$ref" "$S/plan33.txt"
done

echo; echo "################ zoom details: evidence completeness ('...' or < 10 chars after the prefix) ################"
psql "select left(r.id::text,8) run, count(*) zoomed,
 count(*) filter (where length(trim(replace(i->>'detail','[2x zoom]',''))) < 10) degenerate_lt10,
 count(*) filter (where trim(replace(i->>'detail','[2x zoom]','')) = '...') dots,
 round(avg(length(i->>'detail'))) avg_len, count(*) filter (where i->>'pass'='true') passes, count(*) filter (where i->>'pass'='false') fails
from vlm_experiment_results x join experiment_runs r on r.id=x.run_id, jsonb_array_elements(x.checklist_results) i
where r.id in ('$NEW','$GLM_56','$GLM_50','$REF') and (i->>'detail') like '[2x zoom]%' group by r.id order by r.id"

echo; echo "################ residual uncertain after zoom, new run ################"
psql "select count(*) filter (where i->>'pass' is null or jsonb_typeof(i->'pass')='null') residual_uncertain, count(*) items
from vlm_experiment_results x, jsonb_array_elements(x.checklist_results) i where x.run_id='$NEW'"
