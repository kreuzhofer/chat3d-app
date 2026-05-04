---
name: improve-category
description: Analyze a workbench category, identify RAG gaps, add simple seed prompts for underrepresented patterns, regenerate failing examples, and iterate until 90-95% approval rate is reached.
arguments: [categoryId]
---

# Improve Workbench Category

Improve the workbench category **$categoryId** to reach 90-95% approval rate through a structured workflow. Stop when the target is reached or when further attempts show diminishing returns. Do not pursue 100% — cap effort at 3 full rounds.

## Resolve Category Input

The argument `$categoryId` may be:
- A UUID (e.g., `45d4d691-ef79-4a2c-a7bf-43856b29b22a`) — use directly
- A URL (e.g., `http://localhost/workbench/45d4d691-...`) — extract the UUID from the path
- A category name (e.g., `Boolean Operations`) — look up the UUID via `GET /api/admin/workbench/categories` and match by name (case-insensitive)

If the input is not a valid UUID, resolve it to one before proceeding. If no match is found, report an error and stop.

## Authentication

Use the token file approach from CLAUDE.md:
1. Check if `/tmp/chat3d-token.txt` exists and is valid (test with `GET /api/auth/me`)
2. If missing or expired, login using credentials from `scripts/test-prompt.sh` and save the token

```bash
TOKEN=$(curl -s http://localhost/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@chat3d.local","password":"change-admin-password"}' | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['token'])")
echo "$TOKEN" > /tmp/chat3d-token.txt
```

Then use: `TOKEN=$(cat /tmp/chat3d-token.txt)` in subsequent calls.

## Phase 1: Analyze Current State

1. **Fetch category info and prompts:**
   ```
   GET /api/admin/workbench/categories
   GET /api/admin/workbench/categories/$categoryId/prompts
   ```

2. **Compute metrics:**
   - Score distribution (histogram of <5, 5-6, 6-7, 7-7.5, 7.5-8, 8-9, 9-10)
   - Approval rate (auto_approved / total)
   - Pending count and score breakdown
   - Eval source distribution (composite vs assertion_fail vs code_only)

3. **Check data quality:**
   ```
   GET /api/admin/data-quality
   ```
   Look for missing VLM training data, missing specs, incomplete eval sources.

4. **If approval rate is already >= 90%, report success and stop.**

## Phase 1.5: Generate Missing Examples (if needed)

If there are prompts with 0 examples (exampleCount == 0), generate them first before analyzing quality:

1. **Count prompts without examples:**
   ```python
   no_example = [p for p in prompts if p['exampleCount'] == 0]
   ```

2. **If any exist, generate them in batch:**
   ```
   POST /api/admin/workbench/generate/batch
   {"categoryId": "$categoryId", "onlyMissing": true}
   ```

3. **Poll until complete.** This may take a while for large categories (3-10 min per prompt).

4. **Re-fetch prompts and recalculate metrics** before proceeding.

## Phase 2: Fix Eval Issues (Quick Wins)

Before regenerating anything, fix what we can with re-evals:

1. **Re-eval examples with missing VLM data** (assertion_fail or code_only eval source):
   ```
   POST /api/admin/workbench/re-evaluate/batch
   {"categoryId": "$categoryId", "mode": "missing"}
   ```

2. **Re-eval all examples** to pick up any pipeline improvements (checklist reconciliation, dimensional filtering, assertion swap detection):
   ```
   POST /api/admin/workbench/re-evaluate/batch
   {"categoryId": "$categoryId", "mode": "all"}
   ```

3. **Poll job until complete:**
   ```
   GET /api/admin/workbench/jobs/{jobId}
   ```
   Poll every 30s. Each re-eval takes ~20-30s per example.

4. **Re-check approval rate.** If >= 90%, stop.

## Phase 3: Identify RAG Gaps

Analyze the remaining pending prompts to find underrepresented patterns:

1. **Classify each pending prompt** by operation type (subtraction, fusion, intersection, pattern, etc.) and sub-pattern (slot, hole, groove, pocket, rounding, arch, angled-cut, shell/hollow, joinery, counterbore, profile-cut, etc.)

2. **Compare against approved prompts** to find patterns with:
   - 0 approved examples (hard gap)
   - 1 approved example (weak coverage)

3. **Report the gap analysis** before proceeding.

## Phase 4: Add RAG Seed Prompts

For each identified gap pattern:

1. **Write 1-2 simple prompts** that demonstrate the pattern in its simplest form:
   - Basic geometric primitives + one clear operation
   - All explicit dimensions, no ambiguity
   - Should score 8+ on first generation attempt
   - Examples: "A block 80mm x 40mm x 20mm with a rectangular groove 6mm wide and 4mm deep..."

2. **Add prompts to the category:**
   ```
   POST /api/admin/workbench/categories/$categoryId/prompts
   {"prompts": ["prompt text 1", "prompt text 2", ...]}
   ```

3. **Generate examples for the new prompts:**
   ```
   POST /api/admin/workbench/generate/batch
   {"categoryId": "$categoryId", "onlyMissing": true}
   ```

4. **Poll until complete.** Each generation takes 3-10 minutes.

5. **Verify seed prompts passed** (check scores >= 7.5 and auto_approved). If any seed failed, note it but continue — it may still help as a partial example.

## Phase 5: Regenerate with Inter-Round Sub-Skill Drain

The pipeline already auto-decomposes failing prompts into sub-skill prompts in the `Missing Examples` category (`22fc7bd6-3f68-4b40-94a3-50a99ee8fe46`). Those sub-skills are useless until they have generated examples. The skill exploits this by capturing a timestamp before each regen round, then **draining** sub-skills spawned during that round before the next round retries the same prompts.

**Flow per round:**

1. **Capture round-start timestamp:**
   ```bash
   ROUND_START_TS=$(date -u +%FT%TZ)
   ```

2. **Select candidates** — pending prompts in the target category, sorted by `bestScore` desc (most likely to flip first). Take 4-6 per round.

3. **Regenerate one at a time** (via `POST /api/admin/workbench/generate`, poll job to completion).

4. **After the round (before the next round):** query `Missing Examples` for prompts created during this round that have no examples yet:
   ```bash
   curl -s "http://localhost/api/admin/workbench/categories/22fc7bd6-3f68-4b40-94a3-50a99ee8fe46/prompts" \
     -H "Authorization: Bearer $TOKEN" | python3 -c "
   import sys, json, os
   data = json.load(sys.stdin)
   prompts = data if isinstance(data, list) else data.get('prompts', [])
   ts = os.environ['ROUND_START_TS']
   spawned = [p for p in prompts if p.get('createdAt','') >= ts and p.get('exampleCount',0) == 0]
   for p in spawned: print(p['id'])
   "
   ```

5. **Generate examples for each spawned sub-skill** (one-at-a-time `POST /api/admin/workbench/generate`). Typically 0–10 per round. **Cap at 10 per round** to bound cost; if more were spawned, skip the rest.

6. **Then run the next round** (back to step 1) — the same failed prompts now retry against the freshly-populated sub-skill RAG.

**Rationale.** Sub-skills spawned during round N are exactly the building blocks the failing prompts need. Generating them between rounds turns the second attempt into a meaningfully different one — the agent sees new RAG content. Without this step, round 2 retries the same prompt against the same RAG and rarely succeeds.

**Stop when (in priority order):**
1. **Approval rate reaches 90-95%** — target hit, stop and report.
2. **Saturation signal: zero sub-skills spawned during the round AND zero new approvals.** This means the RAG already has the building blocks (no gaps the system can detect) but the agent still can't compose them. Further rounds against the same RAG will produce the same result — stop. The remaining failures are composition / reasoning problems, not RAG coverage problems.
3. **Diminishing returns: round N produced fewer than 2 new approvals** AND no sub-skills spawned. Same logic as above with a small tolerance for noise.
4. **3 full rounds completed** — hard cap regardless of outcome.

The saturation signal is the most useful new criterion: if no sub-skills got spawned, the inter-round drain phase will be a no-op, so round N+1 will see exactly the same RAG as round N. Cheaper to stop and report "RAG saturated, agent composition is the bottleneck" than to burn another ~$1.20 on a round that can't help.

Cost note: each spawned sub-skill is one extra generation (~$0.20). A round that regenerates 6 prompts and drains 5 sub-skills costs ~11 generations. Acceptable tradeoff if the drain enables 2-3 retries to succeed in the next round.

## Phase 6: Cleanup (MANDATORY — DO NOT SKIP)

**You MUST run this phase before reporting.** Cleanup is not optional. It runs even when:
- The target was reached early
- Only 1 round was needed
- Some regenerations failed
- The job hit the 3-round cap

Skip only if the entire skill failed before any regeneration ran (e.g., bad category ID).

Run cleanup to keep only the best example per prompt and delete inferior attempts + their files:

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
RESP=$(curl -s -X POST "http://localhost/api/admin/workbench/cleanup/batch" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"categoryId\":\"$categoryId\"}")
JOB=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['jobId'])")
for i in $(seq 1 60); do
  S=$(curl -s "http://localhost/api/admin/workbench/jobs/$JOB" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; j=json.load(sys.stdin); print(j['status'])" 2>/dev/null)
  if [ "$S" = "completed" ] || [ "$S" = "failed" ]; then echo "Cleanup: $S"; break; fi
  sleep 10
done
```

This retains the best example per prompt (priority: human_approved > auto_approved > pending > rejected, then by eval_score DESC) and deletes all others, freeing storage.

**Confirm cleanup ran in your final report** — include "Cleanup: completed" as a line in Phase 7 output. If you cannot confirm cleanup ran, the task is incomplete.

## Phase 7: Report

After each round, report:
- Approval rate: before -> after
- Avg score: before -> after
- Number of prompts improved
- Remaining pending prompts and their scores
- RAG seeds added and their scores
- Cost estimate (approximate based on number of generations/re-evals)

## Polling Jobs

All generation and re-eval jobs are async. Use this pattern:

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
JOB_ID="..." 
for i in $(seq 1 200); do
  RESULT=$(curl -s "http://localhost/api/admin/workbench/jobs/$JOB_ID" -H "Authorization: Bearer $TOKEN")
  STATUS=$(echo "$RESULT" | python3 -c "import sys,json; j=json.load(sys.stdin); print(j.get('status','?'))" 2>/dev/null)
  PROGRESS=$(echo "$RESULT" | python3 -c "import sys,json; j=json.load(sys.stdin); print(f\"{j.get('completed',0)}/{j.get('total',0)}\")" 2>/dev/null)
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "cancelled" ]; then break; fi
  sleep 30
done
```

For generation jobs, use `run_in_background` and wait for task notifications rather than blocking the conversation with repeated polls.

## Key API Endpoints

| Action | Method | Path |
|--------|--------|------|
| List categories | GET | /api/admin/workbench/categories |
| List prompts | GET | /api/admin/workbench/categories/:id/prompts |
| Add prompts | POST | /api/admin/workbench/categories/:id/prompts |
| Generate single | POST | /api/admin/workbench/generate |
| Generate batch | POST | /api/admin/workbench/generate/batch |
| Re-eval batch | POST | /api/admin/workbench/re-evaluate/batch |
| Job status | GET | /api/admin/workbench/jobs/:jobId |
| Data quality | GET | /api/admin/data-quality |
| Example detail | GET | /api/admin/workbench/examples/:id |
| Cleanup batch | POST | /api/admin/workbench/cleanup/batch |

## Pattern Classification Reference

Common sub-patterns for boolean operations categories:
- **slot**: rectangular or shaped slot cuts
- **through-hole**: cylindrical holes, drilled bores
- **groove**: V-groove, U-groove, circumferential channels
- **pocket**: rectangular or shaped recesses
- **shell/hollow**: hollowed-out shapes, wall thickness
- **angled-cut**: chamfer planes, wedge cuts, saddle cuts
- **rounding**: filleted/rounded edges and corners
- **joinery**: dovetail, mortise-tenon, finger joints
- **counterbore**: stepped bores, countersinks
- **intersection**: boolean intersection of primitives
- **profile-cut**: D-shaped, key-shaped, custom profile cuts
- **pattern**: repeated features (holes, fins, slots)
- **fusion**: union of multiple solids, composite shapes
- **arch**: arch-shaped voids (semicircular, pointed, gothic)

Adjust classification for other categories (extrusions, surface modifications, etc.) based on the category's domain.

## Important Rules

- **Never modify credentials or auth tokens** — use documented test credentials only
- **Cap at 3 rounds** of the analyze-seed-regenerate cycle
- **Stop at 90-95% approval** — don't chase 100%
- **Report cost** — each generation costs ~0.10-0.30 USD in LLM tokens, each re-eval ~0.02-0.05 USD
- **Don't modify prompts that are already approved** — focus only on pending ones
- **Use background tasks** for long-running jobs (generation batches, full re-evals)
- **Verify category exists** before starting — fail fast with a clear error if the ID is wrong
