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

## Phase 4.5: Decompose Complex Failing Prompts

**IMPORTANT: Do this BEFORE attempting to regenerate complex prompts.** Many failing prompts combine multiple techniques (e.g., "shell + selective fillet + flat cut"). Even with pattern-level RAG seeds, the LLM may fail because it has no example of the specific technique combination or of a specific sub-technique in isolation.

1. **For each pending prompt scoring < 7**, read the full prompt text and identify the individual techniques it combines. Examples:
   - "box shelled to 2mm with top rim filleted" → techniques: shell, selective edge fillet
   - "L-bracket with all outer edges filleted" → techniques: L-shape extrusion, uniform fillet on complex shape
   - "sphere shelled with flat cut" → techniques: sphere shell, boolean flat cut on curved surface
   - "cylinder with chamfer on top and fillet on bottom" → techniques: chamfer on circular edge, fillet on circular edge

2. **Check which individual techniques lack approved examples.** A technique is "covered" if there's an approved example that demonstrates it clearly in isolation.

3. **Write simple single-technique prompts** for each uncovered technique:
   - One technique per prompt
   - Simplest possible geometry (box, cylinder, sphere)
   - Clear dimensions, no ambiguity
   - Should pass easily on first attempt

4. **Add and generate** these technique prompts (same as Phase 4).

5. **Only after technique prompts are approved**, proceed to regenerate the complex originals. The RAG will now have relevant building blocks for each sub-technique.

This decomposition step is critical — it's the difference between "the LLM has seen a slot before" (pattern-level) and "the LLM has seen exactly how to fillet only the vertical edges of a box" (technique-level). The latter is what actually helps with complex prompts.

## Phase 5: Regenerate Failing Examples

With RAG seeds AND technique examples in place, regenerate the pending examples that match seeded patterns:

1. **Select candidates** — pending prompts that match seeded patterns, starting with highest-scoring (most likely to pass with RAG help).

2. **Regenerate one at a time:**
   ```
   POST /api/admin/workbench/generate
   {"promptId": "<prompt_id>"}
   ```

3. **Poll each job to completion.** Check the new score vs old score.

4. **Process in batches of 4-6** to limit cost per round. Check approval rate after each batch.

5. **After round 2, if still below 90%**: Run a second technique decomposition pass (Phase 4.5 again) on the remaining pending prompts. The first decomposition targeted patterns visible before any regeneration. After two rounds of regen, the remaining prompts are the hardest — they likely need even more specific technique seeds that weren't obvious initially. Decompose these, add technique seeds, generate them, then proceed to round 3.

6. **Stop when:**
   - Approval rate reaches 90-95%, OR
   - Last batch showed no improvement (all regenerated prompts still pending), OR
   - 3 full rounds completed (with the mid-round decomposition counting as part of the process, not a separate round)

## Phase 6: Cleanup

After all improvement rounds are complete (target reached or 3 rounds done), run cleanup to keep only the best example per prompt and delete inferior attempts + their files:

```
POST /api/admin/workbench/cleanup/batch
{"categoryId": "$categoryId"}
```

This retains the best example per prompt (priority: human_approved > auto_approved > pending > rejected, then by eval_score DESC) and deletes all others, freeing storage. Poll the job until complete.

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
