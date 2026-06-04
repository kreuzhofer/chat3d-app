# Render-Error Classification Recovery — Design

**Date:** 2026-06-04
**Status:** Draft (awaiting user review)
**Source:** Brainstorming session after 3 runs of `improve-category` on PCB Cases (49% → 54%); cited by `docs/codegen-harness-audit.md` §2.13.1, §6.4.2, and ranked **N2 / S effort / High impact** in the audit's prioritized next-steps table.

## Motivation

PCB Cases has the highest render-failure rate in the dataset — 38.5% of generation attempts fail to render at all. Of those, **75% (187/251)** are persisted as the generic string `"Agent codegen failed to render"` with the underlying classification thrown away. This blocks every error-category hypothesis in `codegen-harness-audit.md` §2.13.x, because we cannot answer "which kind of render error dominates which category" from the existing data.

The structural irony: `packages/backend/src/services/render-errors.ts` already exposes a `classifyRenderError()` function with seven categories (`infrastructure`, `api_misuse`, `geometry`, `type_error`, `kernel_error`, `syntax`, `unknown`), and the classifier already runs during the codegen retry loop to drive escalation. The classification simply isn't persisted: `workbench-codegen.service.ts:800` writes a literal string instead of carrying the structured error through.

**Goal:** Make the render-error category survive into the database so analytics, the workbench UI, and future targeted-fix work can act on it. Recover what's possible from historical rows via the `agentConversation` field.

## Non-goals

- **No targeted-fix loop.** Building a category-specific retry strategy (audit §2.13.2) is deferred until we see what the data actually shows after recovery.
- **No agent-loop changes.** Retry escalation already uses `fixGuidance` in memory; persistence is purely additive.
- **No VLM-evaluation work.** Visual-eval reliability (audit's correlation-0.14 finding for PCB Cases) is a separate workstream; this spec is scoped to render failures only.
- **No raw-traceback recovery from application logs.** Backfill uses only data stored in the database (`agentConversation` + the row's own `render_error`).

## Architecture / data flow

```
build123d service ──raw error──▶ classifyRenderError() ──ClassifiedRenderError──▶
   ┌─ persistence: write category + capturedDetail to new columns
   │                + raw message to existing render_error column (replacing the lossy literal)
   ├─ agent retry loop: uses fixGuidance (unchanged)
   └─ admin/data-quality: GROUP BY render_error_category for the histogram
                          drill-down endpoint lists examples per category
```

## Schema

One knex migration on `workbench_examples`:

```sql
ALTER TABLE workbench_examples
  ADD COLUMN render_error_category TEXT NULL
    CHECK (render_error_category IN
      ('infrastructure','api_misuse','geometry','type_error',
       'kernel_error','syntax','unknown')),
  ADD COLUMN render_error_detail TEXT NULL;

CREATE INDEX idx_workbench_examples_render_error_category
  ON workbench_examples(render_error_category)
  WHERE render_error_category IS NOT NULL;
```

**Rationale:**
- `TEXT + CHECK` matches the existing `RenderErrorCategory` TypeScript enum without a native Postgres `ENUM` type (avoids the migration pain of altering enums later).
- Partial index: most rows have `render_error_category IS NULL` (successful renders); the index stays small and answers the "histogram per category" query fast.
- Both columns nullable — successful examples keep them null, no backfill churn on the success path.
- Down migration drops index + both columns; raw `render_error` is untouched.

## Code changes

Three files, small edits each.

### `packages/shared/src/types.ts`
Add the two new fields to the `WorkbenchExample` shape:
```ts
render_error_category?: RenderErrorCategory | null;
render_error_detail?: string | null;
```
Re-export `RenderErrorCategory` from shared so the frontend can use the enum values for the UI tab.

### `packages/backend/src/services/workbench-codegen.service.ts` around line 800
Currently:
```ts
const renderError = currentResult.renderSuccess ? null : "Agent codegen failed to render";
```
The `ClassifiedRenderError` is computed upstream by `classifyRenderError()` inside the render attempt loop but only its `fixGuidance` field is used in-memory for retry escalation — the full classification doesn't reach the persistence step. The fix: thread the `ClassifiedRenderError` through whatever struct currently carries `renderSuccess` (likely the return type of the render attempt function), adding an optional `classifiedError: ClassifiedRenderError | null` field. The implementation plan will identify the precise type and call sites; this spec assumes the change is local to the codegen service and does not require modifying `render-errors.ts`. On the failure path:
```ts
const renderError = currentResult.renderSuccess
  ? null
  : currentResult.classifiedError?.rawMessage ?? "Agent codegen failed to render";
const renderErrorCategory = currentResult.classifiedError?.category ?? null;
const renderErrorDetail = currentResult.classifiedError?.capturedDetail ?? null;
```
The literal-string fallback is kept only as a defensive default if the classifier somehow returned nothing (shouldn't happen — `classifyRenderError()` always returns `UNKNOWN` at worst).

### `packages/backend/src/services/workbench-catalog.service.ts` (or wherever `insertExample` lives)
Add `renderErrorCategory` and `renderErrorDetail` to the insert payload alongside the existing `renderError`. Knex does the rest.

## Backfill script

Standalone TypeScript script at `packages/backend/scripts/backfill-render-errors.ts`. Run-once, idempotent.

**Algorithm:**
```
for each workbench_example where render_status = 'error'
                              and render_error_category IS NULL:

  raw_msg = null

  # Source 1: parse agentConversation
  if row.agentConversation:
    raw_msg = extract_render_tool_result(row.agentConversation)

  # Source 2 (fallback): the row's own render_error if it's NOT the lossy literal
  if not raw_msg and row.render_error and
     row.render_error != "Agent codegen failed to render":
    raw_msg = row.render_error

  # Classify
  if raw_msg:
    classified = classifyRenderError(raw_msg)
    UPDATE row SET
      render_error_category = classified.category,
      render_error_detail = classified.capturedDetail,
      render_error = raw_msg
  else:
    UPDATE row SET render_error_category = 'unknown'
    # row stays UNKNOWN; nothing recoverable
```

**`extract_render_tool_result`** parses the `agentConversation` JSON array looking for tool-result messages from the render tool. The render tool's failure path returns the build123d Python traceback as the tool result text. The parser walks messages newest-first and returns the most recent render-tool failure result. If no render-tool failure is found, returns null.

**Edge handling:**
- JSON parse error on `agentConversation` → log, skip the row (don't overwrite category).
- Render tool's tool-result text contains markdown formatting (occasional) → strip it before passing to `classifyRenderError()`.
- Multiple render attempts in the conversation → the LAST one is the persisted failure; pick that one.

**Run modes (CLI flags):**
- `--dry-run` (default): print intended writes, no DB changes.
- `--commit`: write.
- `--category <id>`: limit to one workbench category (so PCB Cases can be the test target before running the rest).
- `--limit N`: process at most N rows; useful for smoke-testing on a small subset.

**Reports** at the end: `{recovered_from_conversation, recovered_from_render_error, still_unknown, parse_errors}` per workbench category.

## Admin / data-quality surface

### Backend: extend `GET /api/admin/data-quality`
Add to the existing per-category stats object:
```ts
renderErrorCategoryHistogram: {
  api_misuse: number;
  geometry: number;
  kernel_error: number;
  type_error: number;
  syntax: number;
  infrastructure: number;
  unknown: number;
}
```
Counts failed examples only (`render_status = 'error'`). Successful examples are not represented in this histogram — they live in the existing `promptsWithExamples` / `assertionsRan` etc. stats. One additional `GROUP BY render_error_category WHERE render_status = 'error'` query per category. ~30 lines added to the existing data-quality service.

### Backend: new endpoint `GET /api/admin/render-errors/examples`
Query params: `categoryId` (workbench category UUID), `errorCategory` (`RenderErrorCategory`), `limit` (default 50, max 200).
Returns:
```ts
{
  examples: Array<{
    id: string;
    promptId: string;
    promptText: string;
    renderError: string;          // the raw message
    renderErrorDetail: string | null;
    createdAt: string;
  }>;
  total: number;
}
```
~40 lines.

### Frontend: new admin tab `Render Errors`
- Table: rows = workbench categories, columns = error categories, cells = counts (the histogram).
- Click a cell → drawer with the example list (raw message + the prompt that produced it, link to the workbench example).
- Reuses the existing admin shell + table component already used in `KnowledgeTab.tsx`.
- One new `.tsx` file (~200 lines) + one drawer/modal component.

## Testing

- **Backend unit tests** for the persistence path: mock a render failure with each of the seven categories and assert the inserted row has the right `render_error_category` and `render_error_detail`.
- **Backfill script test** with a small fixture DB: one row per known case (`KERNEL_ERROR` recoverable from raw, `API_MISUSE` recoverable from agentConversation, the lossy `"Agent codegen failed to render"` with recoverable conversation, the lossy literal with no recoverable data → still UNKNOWN). Assert correct counts in dry-run output. Then re-run in commit mode and assert rows updated.
- **`/api/admin/data-quality` integration test**: insert a handful of rows with known categories, hit the endpoint, assert the histogram.
- **`/api/admin/render-errors/examples` integration test**: query by `errorCategory`, assert pagination + filtering correctness.
- **Frontend**: visual smoke test only (read-only diagnostic surface; no new business logic).

## Migration & rollout

1. Ship the schema migration.
2. Ship the persistence change (line 800 in `workbench-codegen.service.ts`).
3. Run backfill in `--dry-run --category <PCB Cases UUID>` first; sanity-check the recovered classifications against a few known cases.
4. Run backfill in `--commit` across all categories.
5. Ship the API + UI.
6. Open the new tab. Look at the dominant failure mode in PCB Cases (and other hard categories). This is the data that unblocks the §2.13.x audit hypotheses and informs whether a category-specific targeted-fix loop is warranted.

**Rollback:** drop the two columns + the index; revert line 800 to the literal string. No data loss on the success path (those rows have nulls in the new columns).

## Follow-ups (out of scope but enabled)

- **Audit §2.13.2:** Sub-classify `GEOMETRY` errors (zero-area sketch vs degenerate wire vs ValueError vs other). Needs the data this spec ships.
- **Audit §7 item 9:** Near-miss targeted-fix loop scoped to PCB Cases + bd_warehouse. Independent of this spec but its prioritization depends on knowing whether render failures or eval near-misses dominate.
- **Promote anti-drift + composite-idiom KB patterns from `improve-category` into `codegen-harness-audit.md` §2.6** as a constructive KB-authoring playbook. Independent of this spec; separate PR.
- **VLM eval reliability for PCB Cases (correlation 0.14):** the second-most important signal-quality problem after render-error classification. Separate spec.

## Success criteria

- All new render failures land in the database with a non-null `render_error_category`.
- Backfill report shows >50% of the 187 historical UNKNOWN rows recovered (target; actual depends on `agentConversation` survival rate).
- The new admin tab loads under 1s with the histogram populated.
- We can answer the question "what is the dominant render-failure category in PCB Cases?" with a single click in the UI.
