---
name: improve-category
description: Use when a workbench category is below the 90–95% approval target and needs targeted improvement. Handles easy categories (gap seed prompts + regen) and hard categories (researches missing KB entries from datasheets, adds stepping-stone simpler prompts that the agent generates to prove its thesis, then re-runs originals against the enriched RAG).
arguments: [categoryId]
---

# Improve Workbench Category

Improve the workbench category **$categoryId** to reach 90-95% approval rate through a structured workflow. Stop when the target is reached or when further attempts show diminishing returns. Do not pursue 100% — cap effort at 3 full rounds.

**Gate + three escalation tiers, in order:**
0. **Phase 2.5 — validate prompts** (gate, runs before any improvement work). Detect prompts with contradicting instructions, physical impossibility, or unresolvable ambiguity. Propose minimal-diff fixes or removal for user approval. Invalid prompts are dead ends — nothing later in the workflow can rescue them. See `validate-prompts.md`. **This is the only phase that may alter or delete existing prompts, and only with user confirmation.**
1. **Phases 1, 3–5 — fix retrieval and regen** (easy categories usually end here). Identify pattern gaps, add seed prompts, regen with inter-round sub-skill drain. **Phase 2 (re-eval) is skipped by default** — assume the eval pipeline is stable, work with existing scores.
2. **Phase 3.5 — research missing knowledge** (hard categories with domain gaps). Detect missing boards / connectors / fasteners / build123d idioms; research authoritative sources; add reference entries; re-embed. See `research-missing-knowledge.md`.
3. **Phase 5.5 — simplify hard prompts** (failures that survived KB enrichment). For each stuck prompt, add a **simpler stepping-stone variant** to the category, generate a working example, then re-run the original against the enriched RAG. Original prompts are never altered here. See `simplify-hard-prompts.md`.
4. **Phase 5.7 — research from failures** (final escalation; runs once when Phase 5.5 stepping stones fail or when no Phase 5.5 candidates exist). Cluster eval-issue strings across remaining failing prompts to discover **specific build123d sub-pattern KB gaps** that entity-driven Phase 3.5 couldn't see. Author + validate + embed up to 5 new Cookbook entries, then auto-loop **once** back to Phase 5 against the saturated candidates. See `research-from-failures.md`.

**In-scope set: prompts where `bestApproval ∉ {auto_approved, human_approved}`** — i.e. `pending` or `rejected`. Every phase below — validation, re-eval candidate selection, gap analysis, regen rounds, stepping-stone generation — works on this set. `bestScore` is the sorting signal within scope (low scores first), but it is **not** the gate.

This definition naturally picks up **human rejections**: when the user manually rejects an auto-approved example via the workbench UI (because the eval pipeline rated it 8/10 but the result is functionally wrong — common for mechanisms like hinges, gears, snap-fits where the VLM can't judge function), the prompt's `bestApproval` flips to `rejected` and re-enters scope on the next run. The skill cannot judge functional correctness on its own; it relies on user rejections as ground truth. Categories where the user suspects systematic false positives (the agent self-evaluated broken results as good) should be audited via a quick browse of the workbench before invoking this skill — reject the bad ones, then run `improve-category`.

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
   - Approval rate ((`auto_approved` + `human_approved`) / total)
   - Pending count and score breakdown
   - **Rejected count** — prompts with `bestApproval = rejected`. Surface this prominently: a high rejected count is the user telling the skill "the auto-eval was wrong here". If this is >0, the run will re-attempt those prompts in Phase 5; do not treat them as terminal failures
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

## Phase 2: Re-eval (SKIPPED BY DEFAULT)

**Default behavior: skip this phase entirely.** Assume the eval pipeline has not changed since the existing scores were computed and work with the data as-is. Re-evaluating burns ~$2–5 per category and ~25–40 minutes producing the same scores in the steady state.

Only run re-eval when **explicitly requested by the user**, typically because the eval pipeline (checklist reconciliation, dimensional filtering, assertion swap detection, VLM prompt) has been improved since these scores were computed. The skill does not auto-detect this — the user must direct it.

When explicitly requested:
```bash
# mode:missing → fill examples lacking VLM data (rare in steady state)
# mode:all → apply current eval logic to all renders without re-rendering
curl -s -X POST "http://localhost/api/admin/workbench/re-evaluate/batch" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"categoryId\":\"$categoryId\",\"mode\":\"all\"}"
```

Poll the returned `jobId` like any other async job. After completion, re-fetch prompts and re-check the approval rate before proceeding.

## Phase 2.5: Validate Prompts (gate — runs before any further work)

Before spending any more budget on gap analysis, KB research, or regen rounds, screen the in-scope prompts (`bestScore < 7.5`) for prompts that are dead ends: contradicting dimensions, physical impossibility, or unresolvable ambiguity. No amount of RAG enrichment or stepping stones can rescue an internally inconsistent prompt — it must be repaired or removed.

The `validate-prompts` sub-skill:
1. Runs an optional Pass 1 text-only check on prompts with 0 examples (catches blatant contradictions cheaply, before Phase 1.5 spends ~$0.20 generating against broken text)
2. Runs Pass 2 over all prompts with `bestScore < 5` or with eval issues matching impossibility keywords (`contradict`, `exceeds`, `doesn't fit`, `geometric impossibility`, `wall too thin`, etc.)
3. Classifies each flagged prompt as **Valid**, **Repairable**, **Reject**, or **Needs Input**
4. Presents a fix-proposal table to the user — **no PATCH or DELETE happens without explicit confirmation**
5. On confirmation: `PATCH /workbench/prompts/:id` for Repairable, `DELETE /workbench/prompts/:id` for Reject, follow-up question for Needs Input
6. After PATCH, deletes the prompt's existing examples (they were generated against broken text) so Phase 1.5 / 5 regenerate fresh
7. Returns a recomputed prompt list and approval rate

**Read the playbook:** `.claude/skills/improve-category/validate-prompts.md` for the keyword list, classification rules, minimal-diff fix examples, and the user-confirmation protocol.

Skip Phase 2.5 entirely when no prompts scored <5 and no eval issues mention impossibility keywords — most categories pass the gate immediately and proceed to Phase 3.

**This is the only phase that may alter or delete an existing prompt**, and only with user confirmation. Every later phase treats the post-gate prompt list as immutable.

## Phase 3: Identify RAG Gaps

Analyze the remaining pending prompts to find underrepresented patterns:

1. **Classify each pending prompt** by operation type (subtraction, fusion, intersection, pattern, etc.) and sub-pattern (slot, hole, groove, pocket, rounding, arch, angled-cut, shell/hollow, joinery, counterbore, profile-cut, etc.)

2. **Compare against approved prompts** to find patterns with:
   - 0 approved examples (hard gap)
   - 1 approved example (weak coverage)

3. **Report the gap analysis** before proceeding.

## Phase 3.5: Research Missing Knowledge (hard categories only)

If the category is **hard** — approval rate <70% after Phase 2 and pending prompts cite specific real-world entities (boards, connectors, fasteners, library parts) or build123d idioms — pause before seeding new prompts and run the `research-missing-knowledge` sub-skill instead.

The sub-skill:
1. Extracts named entities and recurring techniques from the failing pending prompts
2. Detects which are missing or partially covered in the knowledge base (`GET /api/admin/knowledge?search=...`)
3. Researches authoritative sources (WebFetch on vendor datasheets, WebSearch for cross-checks, `gh search code` for build123d idioms)
4. Adds up to 5 new reference / cookbook entries per round, citing sources
5. Re-embeds and spot-checks RAG retrieval before handing back

**Read the playbook:** `.claude/skills/improve-category/research-missing-knowledge.md` for the full procedure (gap detection, reference source IDs, entry templates, and stop conditions).

Skip Phase 3.5 entirely when:
- Approval rate is already ≥70% (Phase 4 seed prompts are usually sufficient)
- All cited entities verifiably exist in the KB and the failure mode is composition, not domain knowledge — jump to Phase 4
- Average score is <5 across the board (composition is broken, no KB fix helps) — also skip to Phase 4, then expect Phase 5.5 to activate

After Phase 3.5 completes, continue with Phase 4. The new KB entries take effect on the next generation round.

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

2. **Select candidates** — in-scope prompts (`bestApproval ∈ {pending, rejected}`) in the target category, sorted by `bestScore` desc (most likely to flip first; `rejected` prompts often have high scores but failed human review, surface them too). Take 4-6 per round. Prompts with `bestApproval ∈ {auto_approved, human_approved}` are excluded.

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

## Phase 5.5: Simplify Hard Prompts (after saturation, target not reached)

Run this phase **only if both**:
- The 90–95% target was not reached
- Either the saturation signal hit (no sub-skills spawned, no new approvals) or 3 full rounds completed

The pattern is different from Phase 4. Phase 4 adds seed prompts for *underrepresented patterns*. Phase 5.5 adds **simpler stepping-stone variants of specific failing prompts** — same category, same theme, fewer or fully-dimensioned features — so the agent can prove (via a generated example) that the building block works, and then re-attempt the original with that example in RAG. **Original prompts are never altered.**

The `simplify-hard-prompts` sub-skill:
1. Classifies stuck prompts as **Vague**, **Compound**, **Unrealistic**, or **Composable-but-hard** using their best-example eval issues
2. For up to 5 Vague/Compound candidates per round, drafts a simpler version that preserves the core technique
3. POSTs each simpler version as a **new prompt** in the same category (curriculum stepping stone)
4. Generates a single example for it; classifies pass/fail at the 7.5 score threshold
5. For every simpler version that passes, re-runs the original prompt once (no edit) — the new simpler example is now in RAG
6. Reports per-candidate outcomes: simpler-pass, original-re-run delta, net effect

**Read the playbook:** `.claude/skills/improve-category/simplify-hard-prompts.md` for classification rules, draft templates, cost cap, and what NOT to do.

Skip Phase 5.5 when:
- Average pending score is ≥7.0 — these are detail-level near-misses (Composable-but-hard); stepping stones won't help, stop and report
- Phase 3.5 just added KB entries and Phase 5 has not yet retried — give the new KB a chance before adding stepping stones

Cost note: each simplification candidate costs ~2 generations (~$0.40) — one for the simpler version, one for the original re-run. Cap at 5 candidates = ~$2 per round.

## Phase 5.7: Research From Failures (final escalation, runs once)

Run this phase when **either**:
- Phase 5.5 stepping stones all failed (3 of 3 simpler variants scored <7.5) — composition complexity is NOT the bottleneck; the failures are specific missing build123d sub-pattern idioms
- Phase 5 hit saturation and there were no Phase 5.5 candidates (all remaining failures classified `Composable-but-hard` or `Unrealistic`)

Skip when:
- Approval rate already at 90–95% target
- All remaining failures are dimensional (`[PARAM]` mismatches, agent miscalculations) — KB additions can't fix agent execution bugs
- Eval issues across failing prompts don't form clusters (every prompt's issues are unique) — no signal, researching one-offs is too expensive

The `research-from-failures` sub-skill:
1. Collects eval issues from all in-scope prompts (`bestApproval ∈ {pending, rejected}`, `bestScore < 7.5`)
2. Clusters issues by underlying build123d sub-pattern (the orchestrator does this in its thinking — no separate LLM API cost)
3. Filters to clusters with ≥3 distinct prompts (signal threshold), caps at top 5 by frequency
4. Researches each cluster: KB search first (re-title existing entries with better keywords if a near-match exists), then `gh search code` on build123d/bd_warehouse repos, then WebSearch
5. Authors minimal Cookbook entries with keyword-rich titles matching eval-issue phrasing
6. POSTs to `/api/admin/knowledge/entries`, validates via `/api/admin/knowledge/validate`, embeds via `/api/admin/knowledge/embed`
7. **Auto-loops back to Phase 5 once** with the candidates whose eval issues matched the new clusters (4–6 prompts, same stop conditions as a normal Phase 5 round)
8. Reports per-cluster: entries added, validation pass/fail, loop-back delta per prompt

**Read the playbook:** `.claude/skills/improve-category/research-from-failures.md` for the clustering rules, filter list (drop `[PARAM]` / dimensional issues), and what NOT to author.

**Cost cap:** ~$1.10 per pass (mostly the loop-back generations; LLM clustering is free since the orchestrator does it). Only ONE Phase 5.7 pass per `improve-category` run — no nesting, no second loop. If saturation persists after the loop-back, stop and surface the remaining failure clusters to the user as follow-ups.

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
- Remaining in-scope prompts (`bestScore < 7.5`) and their scores
- RAG seeds added and their scores
- **Validation outcomes (if Phase 2.5 ran):** prompts PATCHed (with the minimal-diff edit shown), prompts DELETEd, prompts deferred to follow-ups
- **KB entries added (if Phase 3.5 ran):** titles, source, count
- **Stepping stones added (if Phase 5.5 ran):** simpler-version pass/fail and original-re-run delta per candidate
- **Failure-driven KB entries (if Phase 5.7 ran):** clusters discovered, entries added (with validation pass/fail), loop-back round delta
- Cost estimate (approximate based on number of generations/re-evals)
- **Unresolved follow-ups for the user:** prompts flagged as `Needs Input` (Phase 2.5), `Reject` proposals the user declined, `Unrealistic` (Phase 5.5 classification — overlaps with Phase 2.5; if surfaced here, they slipped past validation), or `Composable-but-hard` (detail-level fails) — all need human review

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
| Edit prompt text | PATCH | /api/admin/workbench/prompts/:id (Phase 2.5 only) |
| Delete prompt | DELETE | /api/admin/workbench/prompts/:id (Phase 2.5 only) |
| Delete prompt examples | DELETE | /api/admin/workbench/prompts/:id/examples |
| Generate single | POST | /api/admin/workbench/generate |
| Generate batch | POST | /api/admin/workbench/generate/batch |
| Re-eval batch | POST | /api/admin/workbench/re-evaluate/batch |
| Job status | GET | /api/admin/workbench/jobs/:jobId |
| Data quality | GET | /api/admin/data-quality |
| Example detail | GET | /api/admin/workbench/examples/:id |
| Cleanup batch | POST | /api/admin/workbench/cleanup/batch |
| KB sources | GET | /api/admin/knowledge/sources |
| KB search | GET | /api/admin/knowledge?search=&sourceType= |
| Add reference entry | POST | /api/admin/knowledge/reference |
| Add manual code entry | POST | /api/admin/knowledge/entries |
| Re-embed KB | POST | /api/admin/knowledge/embed |
| Validate KB | POST | /api/admin/knowledge/validate |

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
- **In-scope set is `bestApproval ∈ {pending, rejected}`** — all validation, regen, seeding, and simplification work happens on this set; auto-approved and human-approved prompts are never touched. Human rejections automatically re-enter scope on the next run
- **Report cost** — each generation costs ~0.10-0.30 USD in LLM tokens, each re-eval ~0.02-0.05 USD
- **Never alter existing prompt text, with one exception:** Phase 2.5 may PATCH or DELETE prompts flagged as invalid (contradictions, impossible geometry) **only with explicit user confirmation**. Every other phase only *adds* new prompts (Phase 4 seeds, Phase 5.5 stepping stones)
- **Use background tasks** for long-running jobs (generation batches, full re-evals)
- **Verify category exists** before starting — fail fast with a clear error if the ID is wrong
- **Cite sources** for every KB entry added in Phase 3.5 — entries without `sourceUrl` are not auditable
- **Phase 5.7 runs at most once** per `improve-category` run, with at most one auto-loop back to Phase 5 — no nesting, no recursion
- **Anti-drift rule for all authored Cookbook entries (Phase 3.5 idioms, Phase 5.7 cluster entries):** use generic parameter names, mark every concrete dimension as illustrative via inline comment, keep connector/fastener dimensions OUT of idiom entries, and end every description with the mandatory guard sentence: *"Use the idiom and arithmetic shown; substitute the prompt's own dimensions throughout — concrete numbers below are illustrative, not normative."* Observed failure on 2026-06-04: a Blue Pill prompt regressed from score 7 → 3 because the agent copied a Cookbook entry's USB-A example dimensions instead of the prompt's USB-C spec
