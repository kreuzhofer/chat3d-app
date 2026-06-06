# Phase 0 Hygiene + Phase 1 Gate Contract Fix — Design

**Date:** 2026-06-06
**Status:** Draft (awaiting user review)
**Predecessor:** v2 in-loop semantic eval ([`2026-06-06-in-loop-semantic-eval-design-v2.md`](2026-06-06-in-loop-semantic-eval-design-v2.md)) shipped to `main` at `bcef9a4` with a +0.85 multi-agent Δ but surfaced one killer regression: `2d902495` (M3 screw) dropped from 5.6 → 2.0.

## Why both phases ship together

External audit from Codex flagged ten findings across operational hygiene and harness correctness. Four are mechanical hygiene issues (F3, F4, F5, F10) — none individually large, all distort the measurements we use to evaluate model changes. One (F6 — the gate's contract mismatch between component-local checklist items and assembled-render visual evaluation) is the structural cause of the M3 screw regression. The remaining findings (F1/F2/F7/F8/F9) are real but lower-priority and deferred to later phases.

Combining the two phases into one brainstorm + plan + implementation cycle is cheaper than sequencing them through two separate cycles, AND Phase 0 must land before Phase 1's A/B can be trusted (F3 affects multi-agent counting, F5 affects category queries).

## Phase 0 (hygiene) — goals

1. **F3:** `generation_traces.pipeline_type` column reflects the real value, both going forward and backfilled for historical rows.
2. **F4:** 23 stale `running` traces from March 2026 are closed (set to `failed` with a note) so operational dashboards reflect reality.
3. **F5:** Test-only categories (`render-err-test-*`, `backfill-test-*`, and any other name-pattern matches) are hard-deleted along with their prompts, workbench_examples, storage files, and generation_traces. After this, `workbench_categories` count matches the public API's 16 (~+/- a few).
4. **F10:** `/health` returns backend JSON, not frontend HTML.

## Phase 1 (gate contract fix) — goal

Resolve the gate's contract mismatch: items emitted by decomposition are "component-local" (checkable against just the component's geometry), but the gate evaluates them against the assembled render where component internals are occluded. Tag each item with `assemblyVisibility: "visible" | "occluded"`. The dispatcher routes occluded items to code-only verification (visual is unreliable when occluded). Items that the LLM can't tell either way default to "visible" (i.e., existing behavior). Isolated component rendering (the higher-fidelity alternative) is **deferred** to Phase 1b or Phase 2.

## Non-goals

- **No isolated component rendering in this phase.** That's the higher-fidelity alternative we explicitly chose to defer to validate the cheaper annotation hypothesis first.
- **No changes to the assembler's repair authority.** It can still modify sub-component code, etc.
- **No changes to the forced gate's structure** at submit_result. Same try/catch, same component-grouped rejection message, same UNCERTAIN-doesn't-block rule.
- **No changes to the post-submit canonical scoring.** Composite eval, eval_plan weighting, clamp suppression — all unchanged.
- **No KB / curriculum / single-agent / search-tool work.** F1, F2, F7, F8, F9 are real but defer to later phases.

## Phase 0: concrete approach

### F3 — `pipeline_type` persistence

**Forward fix** in `packages/backend/src/services/trace-persistence.service.ts:119`. The row currently gets written with `pipeline_type='single_agent'` early in the flow. Change the persistence path so the final value is written at trace-finalize time from `trace.pipelineType`. Keep the early stub if the row needs to exist mid-flight, but UPDATE on finalize with the real value.

**Backfill historical rows** via a new script `packages/backend/scripts/backfill-pipeline-type.ts` (mirrors `backfill-render-errors.ts`):

```sql
UPDATE generation_traces
SET pipeline_type = trace->>'pipelineType'
WHERE trace->>'pipelineType' IS NOT NULL
  AND pipeline_type != trace->>'pipelineType';
```

`--dry-run` shows the count + sample. `--commit` runs the update inside a transaction.

### F4 — stale running traces

One-time SQL via a new script `packages/backend/scripts/close-stale-traces.ts`:

```sql
UPDATE generation_traces
SET status = 'failed',
    error_message = 'stale; closed by hygiene pass 2026-06-06'
WHERE status = 'running'
  AND updated_at < NOW() - INTERVAL '7 days';
```

Same `--dry-run` / `--commit` pattern.

### F5 — test-category hard delete

Script `packages/backend/scripts/delete-test-categories.ts`. **Order matters** for foreign-key safety:

1. **Identify** categories matching name pattern `*test*` (case-insensitive). Output: id, name, prompt count, example count, file count, estimated disk freed.
2. **Dry-run mode (default):** print the inventory + total summary. Exit.
3. **Commit mode (`--commit`):** inside a database transaction:
   - For each matched category:
     - For each `WorkbenchPrompt` in the category:
       - For each `WorkbenchExample` for that prompt:
         - Delete the four storage files at `/data/storage/modelcreator/{example.id}.{b123d,3mf,step,stl}` (use try/catch per file; log warn on missing — don't abort)
         - Delete linked `generation_traces` rows
         - Delete the `workbench_examples` row
       - Delete the `workbench_prompts` row (JSONB fields cascade by being in-row)
     - Delete the `workbench_categories` row
   - Commit transaction.
4. **Log every step** via pino. One line per deleted entity at info level, one summary line at end.

**File-deletion safety:** filesystem operations happen INSIDE the DB transaction. If the transaction rolls back the DB returns to consistent state but files are already gone — accept this asymmetry; orphaned DB rows (rollback case) point at missing files which is also fine (`/api/files/:path` already handles missing-file gracefully). The alternative (delete files AFTER commit) leaves files orphaned if the script crashes between commit and file deletion. Pick file-then-DB-commit semantics; document.

Honors CLAUDE.md: no `console.*`, uses `createLogger("delete-test-categories")`.

### F10 — `/health` endpoint

Add to nginx config (verify file location at implementation — likely `packages/frontend/nginx.conf` or similar):

```nginx
location = /health {
  proxy_pass http://backend:3001/api/health;
  proxy_http_version 1.1;
  access_log off;
}
```

The backend's `/api/health` already exists per Codex's audit. Verify and adjust port/upstream name if the actual nginx config differs.

## Phase 1: concrete approach

### Schema change

Extend `ComponentChecklistItemSchema` in `packages/backend/src/utils/component-checklist.ts`:

```typescript
export const AssemblyVisibilityEnum = z.enum(["visible", "occluded"]);
export type AssemblyVisibility = z.infer<typeof AssemblyVisibilityEnum>;

export const ComponentChecklistItemSchema = z.object({
  item: z.string().min(1),
  visibility: ChecklistVisibilityEnum,                  // existing: visual | code | both
  componentName: z.string().min(1).optional(),          // existing: from v2 Task 1
  assemblyVisibility: AssemblyVisibilityEnum.optional(),// NEW
});
```

`assemblyVisibility` is optional. Items without it (pre-existing rows, older LLM outputs) default to `visible` semantically — i.e., dispatcher behavior matches v2 / v4. New code generates with the field populated.

### Decomposition prompt update

Extend `DECOMPOSE_CHECKLIST_ADDENDUM` in `packages/backend/src/services/agent-multi-parser.ts`. Append after the existing visibility instructions:

```
For each item, ALSO emit "assemblyVisibility":
  - "visible" if the feature remains externally visible in the final assembled object
    (e.g. external dimensions, port cutouts, surface features on the outer skin).
  - "occluded" if the feature is hidden inside the assembly or covered by other
    components (e.g. hollow interior of a case body once the lid is on, screw threads
    inside a tapped hole, PCB-mounting standoffs covered by the PCB).

Default to "visible" when unsure. The dispatcher uses this to skip VLM verification
for occluded items (visual evaluation cannot see hidden features) and rely on
code-eval instead.
```

### Dispatcher routing

In `packages/backend/src/services/checklist-eval.service.ts`, the per-item dispatch in `runChecklistEval` (which already branches on `visibility`) gets a pre-filter on `assemblyVisibility`:

```typescript
const isOccluded = entry.assemblyVisibility === "occluded";

const wantVisual = (entry.visibility === "visual" || entry.visibility === "both") && !isOccluded;
const wantCode = entry.visibility === "code" || entry.visibility === "both"
              || (isOccluded && entry.visibility === "visual");
```

Behavior matrix:

| `visibility` | `assemblyVisibility` | Routed as |
|---|---|---|
| `visual` | `visible` (or absent) | VLM only (unchanged from v4) |
| `visual` | `occluded` | **Code-only** (NEW — was VLM under v4) |
| `code` | (either) | Code only (unchanged) |
| `both` | `visible` (or absent) | Visual + code combined (unchanged) |
| `both` | `occluded` | **Code-only** (NEW — was visual+code under v4) |

UNCERTAIN-doesn't-block rule is unchanged. Items downgraded to code-only that code-eval can't judge return UNCERTAIN, which passes through.

### Result `reasoning` text annotation

When an item is routed to code-only because of occlusion, prepend a marker in the reasoning so the agent sees why:

```typescript
if (isOccluded && entry.visibility !== "code") {
  result.reasoning = `[occluded — code-only verification] ${result.reasoning}`;
}
```

This helps the agent reason about why a `visual` item didn't get a visual check.

### Observability

No new DB columns. `sub_agent_verifications` already records per-component pass/fail/uncertain counts. The breakdown by routing decision (visual vs code vs both vs occluded-downgraded) lives implicitly in `componentChecklist` JSONB on the prompt row + verification result JSONB on the example row — derivable via SQL for analytics.

## Sequence + dependencies

```
Day 1: Phase 0
  1. F4 close stale traces (smallest, riskless, builds confidence)
  2. F3 pipeline_type forward fix + backfill script
  3. F10 nginx /health
  4. F5 delete-test-categories script — DRY-RUN, user reviews, then --commit
  Phase 0 verification queries pass before Day 2.

Day 2: Phase 1 implementation
  1. assemblyVisibility schema (~30 min)
  2. DECOMPOSE_CHECKLIST_ADDENDUM update (~15 min)
  3. Dispatcher routing in runChecklistEval (~1 hr including unit tests)
  4. Reasoning text annotation for downgraded items
  5. Commit each. End-of-day: occluded items route to code-only.

Day 3: Phase 1 smoke + A/B
  1. Smoke test against M3 screw prompt (`2d902495`) specifically — confirm fix mechanism
  2. If smoke confirms, regen v2 30-prompt test set
  3. Capture v4 → v5 deltas, write results doc
```

## A/B test methodology

**Test set:** Same 30 prompts at `docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt`.

**Baseline (v4):** Current `main` with the v2 in-loop eval landed. Scores captured in `docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md`.

**Treatment (v5):** v4 + Phase 0 hygiene + Phase 1 assemblyVisibility routing.

**Execution:** Regenerate all 30 prompts fresh. Phase 0 hygiene shouldn't affect generation behavior, but its DB cleanup is required for the A/B's per-pipeline_type aggregation to be honest.

**Primary success criteria** (deltas measured against v4, NOT v3):

| Criterion | Target | Why |
|---|---|---|
| M3 screw (`2d902495`) recovery | Score ≥ 5 (was 5.6 in v3, dropped to 2.0 in v4) | The killer regression that motivated this phase |
| Multi-agent prompts mean Δ | ≥ 0.0 (no regression) | v4 shipped +0.85; Phase 1 should not give that back |
| Multi-agent mean Δ stretch goal | ≥ +0.2 | Annotation may unlock additional lift via fewer phantom failures |
| % checklist items annotated occluded | ≥ 15% across multi-agent runs | Confirms the LLM actually uses the new annotation |
| % occluded items returning UNCERTAIN | < 50% | If most occluded items also stump code-eval, the fix is moot → escalate to isolated rendering |
| Cost per generation | ≤ 1.0× v4 (should be slightly lower) | Code-eval is cheaper than VLM |

**Failure-mode interpretation:**

| Signal | Diagnosis |
|---|---|
| M3 screw stays at 2.0 | Annotation didn't tag the right items as occluded — prompt template needs sharpening |
| % annotated occluded < 5% | LLM reluctant to mark items occluded — prompt template needs explicit examples |
| Multi-agent regression vs v4 | Code-only verification for occluded items is too lenient — escalate to isolated rendering (Phase 1b) |
| Cost increased | Decomposition cost went up — investigate prompt-size increase |

**Phase 0 verification (separate from A/B):**
- After F3: `SELECT pipeline_type, COUNT(*) FROM generation_traces GROUP BY 1` returns a realistic split, not 95% single_agent
- After F4: `SELECT COUNT(*) FROM generation_traces WHERE status='running'` returns 0 except for actively in-flight jobs
- After F5: `SELECT COUNT(*) FROM workbench_categories` is in the low double digits (~16), not 521
- After F10: `curl -s http://localhost/health | jq` returns backend JSON, not frontend HTML

## Follow-ups enabled (not in scope)

- **Phase 1b: isolated component rendering.** If Phase 1 A/B shows the "% occluded items returning UNCERTAIN" exceeds 50%, the annotation alone isn't enough — escalate to rendering each sub-component in isolation pre-gate. Architectural change.
- **F1/F2 hard categories: KB enrichment.** Use the `improve-category` skill's research subskills on PCB Cases, Hinges, Gridfinity, Generic Enclosures, bd_warehouse. Orthogonal workstream.
- **F7 agent contract: sub-agent search tools.** Sub-agents are told they can use lookup/search tools but the runtime disables search. Either enable or remove the instruction.
- **F8 docs cleanup.** Stale references to v1 behavior in `docs/`. Doc-only pass.
- **F9 eval_plan rollout.** Only a small fraction of prompts have eval_plan today; backfill for hard prompts where semantic-heavy scoring matters.
- **Codex Phase 2/3/4:** controlled benchmark suite, eval_plan rollout, contract cleanup. Sequenced after Phase 1's A/B confirms direction.
