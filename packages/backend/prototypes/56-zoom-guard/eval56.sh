#!/bin/zsh
# Evaluate the #56 run: the guarded follow-up on glm and qwen (thinking off, control instrument, the 125).
# Pairs: new glm vs its two earlier runs under the same setup (stability, and where the change shows: zoom-resolved items),
# new qwen vs #58's qwen run, both vs the zoom-enabled reference 786b6e3c; the gate; fallback heuristics; angle distribution.
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
S=${S:-$(cd "$(dirname "$0")" && pwd)}   # runs56.txt/exp56.txt/start56.txt beside this script; compare-items.py from prototypes/50-pass-bias, gate58.py from prototypes/58-qualification-screen
EXP=$(cat "$S/exp56.txt"); START=$(cat "$S/start56.txt")
REF=786b6e3c-ffce-48b1-83db-288bd833be3f
GLM_50=3b5edb08-de0b-4494-9abf-3e87d4d180a3      # #50 control run, 09-05, unguarded follow-up
GLM_58=1f9f3817-3940-4b9e-988c-c49da5c77511      # #58 screen glm run, 09-06, unguarded follow-up
QWEN_58=b05bb3c6-fe87-4bbf-9704-93c63bd4dd75     # #58 screen qwen run, 09-06, unguarded follow-up
GLM=$(grep -i glm "$S/runs56.txt" | cut -d' ' -f1); QWEN=$(grep -i qwen "$S/runs56.txt" | cut -d' ' -f1)
psql() { docker compose exec -T postgres psql -U chat3d -d chat3d -Atc "$1"; }

echo "################ run summary ################"
psql "select r.model_label, r.status, count(x.id) rows, count(*) filter (where x.error is not null) errors,
 count(*) filter (where x.checklist_results is null or jsonb_typeof(x.checklist_results)<>'array' or jsonb_array_length(x.checklist_results)=0) missing_cl,
 round(avg(x.duration_ms)/1000.0,1) s_per_ex, round(avg(x.completion_tokens)) out_tok, sum(x.prompt_tokens) in_tok,
 to_char(r.started_at,'HH24:MI:SS')||'-'||to_char(r.completed_at,'HH24:MI:SS') time_window
from experiment_runs r left join vlm_experiment_results x on x.run_id=r.id where r.experiment_id='$EXP' group by r.id order by r.run_order"

for pair in "GLM-new-vs-GLM-#50-control(3b5edb08) $GLM $GLM_50" "GLM-new-vs-GLM-#58-run(1f9f3817) $GLM $GLM_58" "GLM-new-vs-REF $GLM $REF" \
            "QWEN-new-vs-QWEN-#58-run(b05bb3c6) $QWEN $QWEN_58" "QWEN-new-vs-REF $QWEN $REF"; do
  read -r label cand ref <<< "$pair"
  echo; echo "################ $label ################"
  python3 "$S/compare-items.py" "$cand" "$ref" 2>&1 | grep -vE "^\s*$"
done

echo; echo "################ ITEM GATE (ADR 0001): all items pass, examples with >=3 items ################"
echo "GLM new vs REF:               $(python3 "$S/gate58.py" $GLM $REF)"
echo "GLM #58 run vs REF:           $(python3 "$S/gate58.py" $GLM_58 $REF)"
echo "GLM new vs GLM #58 run:       $(python3 "$S/gate58.py" $GLM $GLM_58)"
echo "GLM new vs GLM #50 control:   $(python3 "$S/gate58.py" $GLM $GLM_50)"
echo "QWEN new vs REF:              $(python3 "$S/gate58.py" $QWEN $REF)"
echo "QWEN #58 run vs REF:          $(python3 "$S/gate58.py" $QWEN_58 $REF)"
echo "QWEN new vs QWEN #58 run:     $(python3 "$S/gate58.py" $QWEN $QWEN_58)"

echo; echo "################ zoom details: fallback heuristic (<=210 chars with a brace or '\"pass\"'), old runs and new ################"
psql "select r.id::text||' '||r.model_label as run, count(*) zoomed,
 count(*) filter (where length(i->>'detail') <= 210 and ((i->>'detail') like '%{%' or (i->>'detail') ilike '%\"pass\"%')) suspect_fallback,
 count(*) filter (where (i->>'detail') like '%{%') any_brace
from vlm_experiment_results x join experiment_runs r on r.id=x.run_id, jsonb_array_elements(x.checklist_results) i
where r.id in ('$GLM','$QWEN','$GLM_50','$GLM_58','$QWEN_58') and (i->>'detail') like '[2x zoom]%' group by r.id, r.model_label, r.experiment_id order by r.experiment_id, r.model_label"

echo; echo "################ zoom details: evidence completeness (detail after the prefix < 10 chars, or exactly '...') ################"
psql "select left(r.id::text,8)||' '||r.model_label as run, count(*) zoomed,
 count(*) filter (where length(trim(replace(i->>'detail','[2x zoom]',''))) < 10) degenerate_lt10,
 count(*) filter (where trim(replace(i->>'detail','[2x zoom]','')) = '...') dots,
 round(avg(length(i->>'detail'))) avg_len, count(*) filter (where i->>'pass'='true') passes, count(*) filter (where i->>'pass'='false') fails
from vlm_experiment_results x join experiment_runs r on r.id=x.run_id, jsonb_array_elements(x.checklist_results) i
where r.id in ('$GLM','$QWEN','$GLM_50','$GLM_58','$QWEN_58','$REF') and (i->>'detail') like '[2x zoom]%' group by r.id, r.model_label order by r.model_label, r.id"

echo; echo "################ residual uncertain after zoom (items with pass null), new runs ################"
psql "select r.model_label, count(*) filter (where i->>'pass' is null or jsonb_typeof(i->'pass')='null') residual_uncertain, count(*) items
from vlm_experiment_results x join experiment_runs r on r.id=x.run_id, jsonb_array_elements(x.checklist_results) i
where r.id in ('$GLM','$QWEN') group by r.model_label, r.run_order order by r.run_order"

echo; echo "################ backend log: follow-up outcomes since $START ################"
docker compose logs backend --since "$START" 2>/dev/null | sed -n 's/^[^{]*{/{/p' > "$S/backend56.jsonl"
python3 - "$S/backend56.jsonl" "$S/runs56.txt" <<'PY'
import json, sys, collections
lines = [json.loads(l) for l in open(sys.argv[1]) if l.strip().startswith("{")]
def win(label):
    import subprocess
    return None
resolved = [l for l in lines if l.get("msg") == "uncertain item resolved via zoom"]
unread = [l for l in lines if l.get("msg") == "zoom follow-up reply could not be read, keeping uncertain"]
failed = [l for l in lines if l.get("msg") == "zoom follow-up failed, keeping uncertain"]
noimg = [l for l in lines if l.get("msg") == "no high-res image for angle, skipping follow-up"]
print(f"resolved {len(resolved)} | unreadable {len(unread)} | threw {len(failed)} | no image {len(noimg)}")
for l in unread: print("  UNREADABLE:", l.get("angle"), l.get("reason", "")[:200])
for l in failed: print("  THREW:", l.get("err", "")[:200])
# angle distribution per run, split by time: the runs are sequential, so split at the first qwen log line
def ts(l): return l.get("time") or l.get("timestamp") or 0
starts = [l for l in lines if l.get("msg") == "starting VLM run"]
bounds = [(ts(l), l.get("model")) for l in starts]
def run_of(l):
    t = ts(l); name = None
    for b, m in bounds:
        if t >= b: name = m
    return name
by_run = collections.defaultdict(collections.Counter)
by_run_pass = collections.defaultdict(collections.Counter)
for l in resolved:
    by_run[run_of(l)][l.get("angle")] += 1
    by_run_pass[run_of(l)]["pass" if l.get("pass") else "fail"] += 1
for r, c in by_run.items():
    print(f"  angles [{r}]: " + ", ".join(f"{a}:{n}" for a, n in c.most_common()) + f" | answers {dict(by_run_pass[r])}")
PY
