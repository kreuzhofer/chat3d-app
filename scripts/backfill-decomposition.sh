#!/bin/bash
# Backfill requires_decomposition + decomposition_reasoning across all categories
# that have prompts with cached specs predating the N1 routing change.
#
# Calls the spec LLM (purpose=spec_generation) once per affected prompt and writes
# only the two decomposition fields — preserves construction_spec, checklist,
# assertions, etc. so curated data isn't disturbed.
#
# Usage:
#   scripts/backfill-decomposition.sh [--dry-run]
#     --dry-run: print per-category prompt counts that would be backfilled, no calls
#
# Cost note: ~1 LLM call per missing-decomposition prompt. With ~2500 prompts the
# cost is bounded by the spec_generation model's pricing — typically O($25-100).
# Track via /api/admin/llm-usage or generation_settings cost dashboards.
set -euo pipefail

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=true; fi

BASE_URL="${BASE_URL:-http://localhost}"
TOKEN_FILE="/tmp/chat3d-token.txt"

# Auth (reuse cached token if still valid)
if [ -f "$TOKEN_FILE" ] && curl -sf "$BASE_URL/api/auth/me" \
    -H "Authorization: Bearer $(cat "$TOKEN_FILE")" >/dev/null 2>&1; then
  TOKEN=$(cat "$TOKEN_FILE")
else
  TOKEN=$(curl -s "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"admin@chat3d.local","password":"change-admin-password"}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
  echo "$TOKEN" > "$TOKEN_FILE"
fi

# Get per-category counts of prompts needing decomposition backfill (direct SQL — much
# faster than walking the workbench API and avoids per-category 404s on empty cats).
COUNT_SQL="
SELECT c.id, c.name, count(p.id) AS missing
FROM workbench_categories c
JOIN workbench_example_prompts p ON p.category_id = c.id
WHERE p.spec_interpretation IS NOT NULL
  AND p.requires_decomposition IS NULL
GROUP BY c.id, c.name
HAVING count(p.id) > 0
ORDER BY missing DESC;
"

echo "[backfill] computing per-category counts..."
docker compose exec -T postgres psql -U chat3d -d chat3d -c "$COUNT_SQL"

TOTAL=$(docker compose exec -T postgres psql -U chat3d -d chat3d -tA -c "
SELECT count(p.id)
FROM workbench_example_prompts p
WHERE p.spec_interpretation IS NOT NULL
  AND p.requires_decomposition IS NULL;
")

echo "[backfill] total prompts to backfill: $TOTAL"

if [ "$DRY_RUN" = true ]; then
  echo "[backfill] dry-run mode — exiting before firing jobs"
  exit 0
fi

# Fetch list of categories with missing rows (id,name) for the loop
CAT_LIST=$(docker compose exec -T postgres psql -U chat3d -d chat3d -tA -F'|' -c "
SELECT c.id, c.name
FROM workbench_categories c
JOIN workbench_example_prompts p ON p.category_id = c.id
WHERE p.spec_interpretation IS NOT NULL
  AND p.requires_decomposition IS NULL
GROUP BY c.id, c.name
HAVING count(p.id) > 0
ORDER BY count(p.id) DESC;
" | tr -d '\r')

if [ -z "$CAT_LIST" ]; then
  echo "[backfill] nothing to do"
  exit 0
fi

echo "[backfill] firing backfill jobs serially per category..."
while IFS='|' read -r CAT_ID CAT_NAME; do
  [ -z "$CAT_ID" ] && continue
  echo "[backfill] -> category=$CAT_NAME ($CAT_ID)"
  JOB=$(curl -s -X POST "$BASE_URL/api/admin/workbench/backfill-specs/batch" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"categoryId\":\"$CAT_ID\",\"missingDecomposition\":true}")
  JOB_ID=$(echo "$JOB" | python3 -c "import sys,json; print(json.load(sys.stdin).get('jobId',''))" 2>/dev/null || echo "")
  if [ -z "$JOB_ID" ]; then
    echo "[backfill]    ERROR starting job: $JOB"
    continue
  fi
  echo "[backfill]    job=$JOB_ID, polling..."

  # Poll this category's job until completion before moving to next.
  # No MAX_WAIT — spec_generation on a 1k+ prompt category can take 5-7h and
  # we want strict sequential serialization across categories so the LLM
  # provider only sees one backfill job at a time.
  WAITED=0
  while :; do
    STATUS_JSON=$(curl -s "$BASE_URL/api/admin/workbench/generate/jobs/$JOB_ID" \
      -H "Authorization: Bearer $TOKEN")
    STATUS=$(echo "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "unknown")
    if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "cancelled" ]; then break; fi
    if [ $((WAITED % 60)) -eq 0 ]; then
      DONE=$(echo "$STATUS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('completed',0)}/{d.get('total','?')} (failed={d.get('failed',0)})\")" 2>/dev/null || echo "?")
      echo "[backfill]    $STATUS $DONE (${WAITED}s)"
    fi
    sleep 10
    WAITED=$((WAITED + 10))
  done
  echo "[backfill]    finished: $STATUS"
done <<< "$CAT_LIST"

echo
echo "[backfill] final distribution:"
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
SELECT requires_decomposition,
       count(*),
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM workbench_example_prompts
WHERE spec_interpretation IS NOT NULL
GROUP BY requires_decomposition
ORDER BY 1 NULLS LAST;
"
