#!/bin/bash
# Counterfactual probe: re-run a prompt with multi-agent decomposition forced ON,
# bypassing the spec LLM's routing decision. Used to answer "would decomposition
# have helped on this prompt?" when the production run routed single_agent_default.
#
# The resulting workbench_example is tagged on its trace with
# complexityTriggerReason='forced_override' so probe runs are easy to filter in SQL:
#
#   SELECT * FROM generation_traces
#   WHERE trace->>'complexityTriggerReason' = 'forced_override';
#
# Usage:
#   scripts/probe-multi-agent.sh <promptId> [modelDisplayName]
#
# Defaults:
#   modelDisplayName = chat3d-build123d-02-synthetic-16k:ma
#     (the :ma fine-tune variant registered for N1 validation; must already exist
#      in llm_models. Pass any other display_name to probe a different model.)
#
# Example:
#   scripts/probe-multi-agent.sh 5c582d66-174e-4ddb-b588-34f98d1f0638
set -euo pipefail

PROMPT_ID="${1:?Usage: probe-multi-agent.sh <promptId> [modelDisplayName]}"
MODEL_DISPLAY_NAME="${2:-chat3d-build123d-02-synthetic-16k:ma}"
BASE_URL="${BASE_URL:-http://localhost}"
TOKEN_FILE="/tmp/chat3d-token.txt"

# Resolve auth token: reuse cached, refresh if expired/missing.
if [ -f "$TOKEN_FILE" ] && curl -sf "$BASE_URL/api/auth/me" \
    -H "Authorization: Bearer $(cat "$TOKEN_FILE")" >/dev/null 2>&1; then
  TOKEN=$(cat "$TOKEN_FILE")
else
  TOKEN=$(curl -s "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"admin@chat3d.local","password":"change-admin-password"}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
  echo "$TOKEN" > "$TOKEN_FILE"
fi

# Resolve modelId from display_name via the admin models listing.
MODEL_ID=$(curl -s "$BASE_URL/api/admin/llm-models" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
target = '$MODEL_DISPLAY_NAME'
resp = json.load(sys.stdin)
models = resp.get('models', resp) if isinstance(resp, dict) else resp
for m in models:
    if m.get('display_name') == target or m.get('model_name') == target:
        print(m['id']); sys.exit(0)
sys.exit(1)
")
if [ -z "${MODEL_ID:-}" ]; then
  echo "ERROR: model not found by display_name='$MODEL_DISPLAY_NAME' in /api/admin/llm-models" >&2
  exit 2
fi

echo "[probe] prompt=$PROMPT_ID model=$MODEL_DISPLAY_NAME (id=$MODEL_ID)"
echo "[probe] forceMultiAgent=true — bypassing spec LLM routing decision"

JOB_RESPONSE=$(curl -s -X POST "$BASE_URL/api/admin/workbench/generate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"promptId\":\"$PROMPT_ID\",\"forceMultiAgent\":true,\"codegenModelId\":\"$MODEL_ID\"}")

JOB_ID=$(echo "$JOB_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('jobId',''))" 2>/dev/null || echo "")
if [ -z "$JOB_ID" ]; then
  echo "ERROR: failed to start job. Response: $JOB_RESPONSE" >&2
  exit 3
fi
echo "[probe] job=$JOB_ID started, polling..."

MAX_WAIT=1800
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  STATUS_RESPONSE=$(curl -s "$BASE_URL/api/admin/workbench/generate/jobs/$JOB_ID" \
    -H "Authorization: Bearer $TOKEN")
  STATUS=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "unknown")
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "cancelled" ]; then
    break
  fi
  if [ $((WAITED % 30)) -eq 0 ]; then
    echo "[probe] still $STATUS (${WAITED}s elapsed)"
  fi
  sleep 5
  WAITED=$((WAITED + 5))
done

echo "[probe] job finished: status=$STATUS"
echo "[probe] full job response:"
echo "$STATUS_RESPONSE" | python3 -m json.tool

echo
echo "[probe] querying the probe trace + example..."
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
SELECT e.id AS example_id, e.render_status, e.eval_score,
       gt.trace->>'complexityTriggerReason' AS reason,
       gt.trace->>'pipelineType' AS pipeline,
       round(gt.total_cost_usd::numeric, 4) AS cost_usd,
       gt.total_duration_ms AS duration_ms,
       gt.final_status,
       e.llm_model
FROM workbench_examples e
LEFT JOIN generation_traces gt ON gt.workbench_example_id = e.id
WHERE e.prompt_id = '$PROMPT_ID'
ORDER BY e.created_at DESC
LIMIT 5;"
