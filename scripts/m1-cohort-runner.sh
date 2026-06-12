#!/bin/bash
# M1 cohort runner — serial 30-prompt workbench eval against the active workbench_codegen model.
# Usage: m1-cohort-runner.sh <vllm_model_name> [work_dir]
# Survives /tmp wipes by living in the repo (strategy doc, milestone M0).
set -u
cd "$(dirname "$0")/.."

VLLM_MODEL="${1:?usage: m1-cohort-runner.sh <vllm_model_name> [work_dir]}"
WORK="${2:-/tmp/nemo-ab}"
PER_PROMPT_TIMEOUT=3600  # 60 min

mkdir -p "$WORK"
[ -f "$WORK/cohort.txt" ] || cp docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt "$WORK/cohort.txt"
[ -f "$WORK/results.csv" ] || echo "prompt_id,example_id,render_status,eval_score,eval_source,code_len,wallclock_s,started_at,finished_at" > "$WORK/results.csv"

TOKEN=$(cat /tmp/chat3d-token.txt 2>/dev/null)
if ! curl -s --max-time 10 http://localhost/api/auth/me -H "Authorization: Bearer $TOKEN" >/dev/null; then
  TOKEN=$(curl -s http://localhost/api/auth/login -H "Content-Type: application/json" \
    -d '{"email":"admin@chat3d.local","password":"change-admin-password"}' | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['token'])")
  echo "$TOKEN" > /tmp/chat3d-token.txt
fi

DONE=$(cut -d, -f1 "$WORK/results.csv" | tail -n +2 | sort -u)
comm -23 <(sort "$WORK/cohort.txt") <(echo "$DONE" | sort) > "$WORK/remaining.txt"
N_REMAIN=$(wc -l < "$WORK/remaining.txt" | xargs)
echo "=== M1 RUN model=$VLLM_MODEL $(date) — $N_REMAIN prompts remaining ===" | tee -a "$WORK/log.txt"

VLLM_FAIL_STREAK=0
COUNT=0
for PID in $(cat "$WORK/remaining.txt"); do
  COUNT=$((COUNT + 1))
  echo "=== [$(date)] [${COUNT}/${N_REMAIN}] $PID ===" | tee -a "$WORK/log.txt"
  T_START=$(date +%s)
  T_START_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  if ! curl -s --max-time 8 http://localhost/api/auth/me -H "Authorization: Bearer $TOKEN" >/dev/null; then
    TOKEN=$(curl -s http://localhost/api/auth/login -H "Content-Type: application/json" \
      -d '{"email":"admin@chat3d.local","password":"change-admin-password"}' | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['token'])")
    echo "$TOKEN" > /tmp/chat3d-token.txt
  fi

  RESP=$(curl -s -X POST "http://localhost/api/admin/workbench/generate" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"promptId\": \"$PID\"}" -w "HTTP=%{http_code}")
  HTTP_CODE=$(echo "$RESP" | grep -oE 'HTTP=[0-9]+' | cut -d= -f2)
  echo "  dispatch HTTP=$HTTP_CODE" | tee -a "$WORK/log.txt"
  if [ "$HTTP_CODE" != "202" ] && [ "$HTTP_CODE" != "200" ]; then
    echo "$PID,,dispatch_failed,,,,0,$T_START_ISO,$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$WORK/results.csv"
    continue
  fi

  while true; do
    NOW=$(date +%s); ELAPSED=$(( NOW - T_START ))
    [ "$ELAPSED" -gt "$PER_PROMPT_TIMEOUT" ] && { echo "  TIMEOUT ${ELAPSED}s" | tee -a "$WORK/log.txt"; break; }
    ROW=$(docker compose exec -T postgres psql -U chat3d -d chat3d -t -A -F'|' -c \
      "SELECT id, render_status, eval_score, eval_source, COALESCE(length(code), 0) \
       FROM workbench_examples WHERE prompt_id::text = '$PID' \
       AND created_at >= to_timestamp($T_START) ORDER BY created_at DESC LIMIT 1;" 2>/dev/null | head -1)
    RS=$(echo "$ROW" | cut -d'|' -f2); SCORE=$(echo "$ROW" | cut -d'|' -f3); LEN=$(echo "$ROW" | cut -d'|' -f5)
    if [ -n "$SCORE" ] && [ "$SCORE" != " " ]; then
      echo "  [${ELAPSED}s] SCORED score=$SCORE len=$LEN" | tee -a "$WORK/log.txt"; break
    fi
    [ "$RS" = "error" ] && { echo "  [${ELAPSED}s] ERRORED len=$LEN" | tee -a "$WORK/log.txt"; break; }
    echo "  [${ELAPSED}s] state=$RS" | tee -a "$WORK/log.txt"
    sleep 30
  done

  T_END_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ); WALL=$(( $(date +%s) - T_START ))
  ROW=$(docker compose exec -T postgres psql -U chat3d -d chat3d -t -A -F'|' -c \
    "SELECT id, render_status, eval_score, eval_source, COALESCE(length(code), 0) \
     FROM workbench_examples WHERE prompt_id::text = '$PID' \
     AND created_at >= to_timestamp($T_START) ORDER BY created_at DESC LIMIT 1;" 2>/dev/null | head -1)
  echo "$PID,$(echo "$ROW" | cut -d'|' -f1 | xargs),$(echo "$ROW" | cut -d'|' -f2 | xargs),$(echo "$ROW" | cut -d'|' -f3 | xargs),$(echo "$ROW" | cut -d'|' -f4 | xargs),$(echo "$ROW" | cut -d'|' -f5 | xargs),$WALL,$T_START_ISO,$T_END_ISO" >> "$WORK/results.csv"

  if [ $((COUNT % 3)) -eq 0 ]; then
    VLLM_CODE=$(curl -s --max-time 15 -X POST http://192.168.44.36:8000/v1/chat/completions \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"$VLLM_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"OK\"}],\"max_tokens\":5}" \
      -w "%{http_code}" -o /dev/null)
    if [ "$VLLM_CODE" != "200" ]; then
      VLLM_FAIL_STREAK=$((VLLM_FAIL_STREAK + 1))
      echo "  vLLM health: HTTP=$VLLM_CODE (streak=$VLLM_FAIL_STREAK)" | tee -a "$WORK/log.txt"
      [ $VLLM_FAIL_STREAK -ge 2 ] && { echo "  vLLM DOWN — aborting at ${COUNT}/${N_REMAIN}" | tee -a "$WORK/log.txt"; break; }
    else
      VLLM_FAIL_STREAK=0
    fi
  fi
done
echo "=== M1 RUN COMPLETE $(date) ===" | tee -a "$WORK/log.txt"
