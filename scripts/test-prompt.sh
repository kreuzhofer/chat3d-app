#!/bin/bash
# Usage: ./scripts/test-prompt.sh <promptId> [iteration_label]
# Triggers generation, polls until complete, prints eval results

set -euo pipefail

PROMPT_ID="${1:?Usage: test-prompt.sh <promptId> [label]}"
LABEL="${2:-baseline}"
BASE_URL="http://localhost"

# Get token
TOKEN=$(curl -s "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@chat3d.local","password":"change-admin-password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

echo "[$LABEL] Starting generation for prompt $PROMPT_ID..."

# Start generation
JOB_RESPONSE=$(curl -s -X POST "$BASE_URL/api/admin/workbench/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"promptId\": \"$PROMPT_ID\"}")

JOB_ID=$(echo "$JOB_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('jobId',''))" 2>/dev/null || echo "")

if [ -z "$JOB_ID" ]; then
  echo "ERROR: Failed to start job. Response: $JOB_RESPONSE"
  exit 1
fi

echo "[$LABEL] Job started: $JOB_ID"

# Poll until complete
MAX_WAIT=900  # 15 minutes
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  STATUS_RESPONSE=$(curl -s "$BASE_URL/api/admin/workbench/jobs/$JOB_ID" \
    -H "Authorization: Bearer $TOKEN")

  STATUS=$(echo "$STATUS_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "unknown")

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "error" ]; then
    break
  fi

  # Print progress every 30 seconds
  if [ $((WAITED % 30)) -eq 0 ]; then
    PROGRESS=$(echo "$STATUS_RESPONSE" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print(f'Status: {d.get(\"status\",\"?\")}')
" 2>/dev/null || echo "polling...")
    echo "[$LABEL] $PROGRESS (${WAITED}s elapsed)"
  fi

  sleep 5
  WAITED=$((WAITED + 5))
done

echo "[$LABEL] Job finished with status: $STATUS"

# Get the example result
sleep 2  # Brief delay for DB to settle

EXAMPLES_RESPONSE=$(curl -s "$BASE_URL/api/admin/workbench/prompts/$PROMPT_ID/examples" \
  -H "Authorization: Bearer $TOKEN")

python3 -c "
import sys, json

data = json.loads('''$EXAMPLES_RESPONSE''')
if not isinstance(data, list) or len(data) == 0:
    print('No examples found')
    sys.exit(1)

# Get the latest example
ex = sorted(data, key=lambda x: x.get('createdAt',''), reverse=True)[0]
print(f'')
print(f'=== Results [{\"$LABEL\"}] ===')
print(f'Example ID: {ex[\"id\"]}')
print(f'Eval Score: {ex.get(\"evalScore\", \"N/A\")}')
print(f'Visual Score: {ex.get(\"visualScore\", \"N/A\")}')
print(f'Code Eval Score: {ex.get(\"codeEvalScore\", \"N/A\")}')
print(f'Assertion Pass Rate: {ex.get(\"assertionPassRate\", \"N/A\")}')
print(f'Render Status: {ex.get(\"renderStatus\", \"N/A\")}')
print(f'Approval: {ex.get(\"approvalStatus\", \"N/A\")}')
print(f'Model: {ex.get(\"llmModel\", \"N/A\")}')
"

# Also get full details
EXAMPLE_ID=$(echo "$EXAMPLES_RESPONSE" | python3 -c "
import sys,json
data = json.load(sys.stdin)
if isinstance(data, list) and len(data) > 0:
    ex = sorted(data, key=lambda x: x.get('createdAt',''), reverse=True)[0]
    print(ex['id'])
" 2>/dev/null || echo "")

if [ -n "$EXAMPLE_ID" ]; then
  DETAIL=$(curl -s "$BASE_URL/api/admin/workbench/examples/$EXAMPLE_ID" \
    -H "Authorization: Bearer $TOKEN")

  python3 -c "
import sys,json
d = json.loads(sys.stdin.read())
print()
print('=== Issues ===')
for i in (d.get('evalIssues') or []):
    print(f'  - {i}')
print()
print('=== Suggestions ===')
for s in (d.get('evalSuggestions') or []):
    print(f'  - {s}')
print()
print('=== Checklist ===')
for c in (d.get('evalChecklistResults') or []):
    status = 'PASS' if c['pass'] else 'FAIL'
    print(f'  [{status}] {c.get(\"question\",\"?\")}')
    detail = c.get('detail','')[:120]
    print(f'         {detail}')
print()
print('=== Code (first 50 lines) ===')
code = d.get('code','')
for i, line in enumerate(code.split(chr(10))[:50], 1):
    print(f'  {i:3d}| {line}')
" <<< "$DETAIL"
fi
