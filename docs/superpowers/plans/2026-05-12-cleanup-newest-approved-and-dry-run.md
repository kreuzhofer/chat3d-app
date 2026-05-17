# Cleanup: newest-approved Preference + Dry-Run Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cleanupExamplesForPrompt` deterministic for "regenerate-all-then-clean" workflows by adding a `prefer="newest-approved"` ordering mode and a `dryRun=true` preview mode that surfaces per-prompt detail (including which prompts fell back to an older example because regeneration didn't produce an approved result).

**Architecture:** Two additive options on the existing per-prompt cleanup function (`prefer`, `dryRun`). When `prefer="newest-approved"`: among examples with `approval_status IN ('auto_approved','human_approved')`, sort by `created_at DESC` instead of `eval_score DESC`. When `dryRun=true`: skip the deletes and return full kept/dropped detail. Thread both through `startBatchCleanup` so each per-prompt result carries the preview rows; surface them in the existing in-memory `BatchJob.results` blob. Frontend gets a `CleanupPreviewTable` component and the existing confirm-cleanup modal becomes a two-step flow (Preview → Apply).

**Tech Stack:** TypeScript backend (Express + Prisma + raw SQL via `prisma.$queryRaw`), TypeScript React frontend (no React Query — direct fetch wrappers), vitest for tests.

---

## File Structure

**Backend:**
- Modify: `packages/backend/src/services/workbench-examples.service.ts:340-403` — `cleanupExamplesForPrompt` gains `prefer` + `dryRun` options; returns extended detail.
- Modify: `packages/backend/src/services/workbench-batch.service.ts:985-1051` (`startBatchCleanup`) and `:1053-1115` (`runBatchCleanup`) — accept and pass through the new options; capture per-prompt preview rows into the existing `job.results` array.
- Modify: `packages/backend/src/routes/workbench.routes.ts:597-619` — accept `prefer` + `dryRun` in the POST body.
- Create: `packages/backend/src/__tests__/cleanup-examples.integration.test.ts` — DB-backed tests for the new modes.

**Frontend:**
- Modify: `packages/frontend/src/api/workbench.api.ts:279-287` — extend `startBatchCleanup` to forward the new params; extend `BatchPromptResult` type to include preview detail.
- Create: `packages/frontend/src/components/admin/CleanupPreviewTable.tsx` — renders aggregate header + per-prompt detail; emits an `onApply` callback when the user confirms.
- Modify: `packages/frontend/src/components/WorkbenchCategoryPage.tsx:371-385` and the cleanup-confirm modal block around `:661-680` — replace single confirm with two-step flow.

**No DB schema changes. No new endpoints.**

---

## Task 1: Add `prefer` option to `cleanupExamplesForPrompt`

**Files:**
- Modify: `packages/backend/src/services/workbench-examples.service.ts:340-403`
- Test: `packages/backend/src/__tests__/cleanup-examples.integration.test.ts`

The current ORDER BY discriminator is `eval_score DESC, created_at DESC`. We're adding a mode where, among approved examples, `created_at DESC` becomes the primary discriminator after the approval-status tier.

- [ ] **Step 1: Create the integration test file with the failing test**

File: `packages/backend/src/__tests__/cleanup-examples.integration.test.ts`

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../db/prisma.js";
import { cleanupExamplesForPrompt } from "../services/workbench-examples.service.js";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let categoryId = "";
let promptId = "";

async function insertExample(
  promptId: string,
  approvalStatus: "auto_approved" | "human_approved" | "pending" | "rejected",
  evalScore: number,
  createdAtIso: string,
) {
  const row = await prisma.workbenchExample.create({
    data: {
      promptId,
      code: "from build123d import *\nroot_part = Box(10,10,10)\n",
      renderStatus: "success",
      approvalStatus,
      evalScore,
      createdAt: new Date(createdAtIso),
    },
    select: { id: true },
  });
  return row.id;
}

beforeAll(async () => {
  const cat = await prisma.workbenchCategory.create({
    data: { name: `cleanup-test-${suffix}`, complexity: 1, description: "test" },
    select: { id: true },
  });
  categoryId = cat.id;

  const prompt = await prisma.workbenchExamplePrompt.create({
    data: { categoryId, index: 0, prompt: "Test prompt for cleanup ordering" },
    select: { id: true },
  });
  promptId = prompt.id;
});

afterAll(async () => {
  await prisma.workbenchExample.deleteMany({ where: { promptId } });
  await prisma.workbenchExamplePrompt.deleteMany({ where: { categoryId } });
  await prisma.workbenchCategory.delete({ where: { id: categoryId } });
});

describe("cleanupExamplesForPrompt — prefer='newest-approved'", () => {
  it("keeps the newest auto_approved example, not the highest-scoring older one", async () => {
    // Older approved at higher score (the "old high-water mark")
    const olderHighScore = await insertExample(promptId, "auto_approved", 9.2, "2026-04-03T10:00:00Z");
    // Newer approved at lower score (the "regenerated with trace" case)
    const newerLowerScore = await insertExample(promptId, "auto_approved", 8.5, "2026-05-11T10:00:00Z");

    const result = await cleanupExamplesForPrompt(promptId, { prefer: "newest-approved" });

    expect(result.keptId).toBe(newerLowerScore);
    expect(result.deleted).toBe(1);

    // Verify only the newer one remains
    const remaining = await prisma.workbenchExample.findMany({
      where: { promptId },
      select: { id: true },
    });
    expect(remaining.map(r => r.id)).toEqual([newerLowerScore]);

    // Cleanup the kept example for the next test
    await prisma.workbenchExample.delete({ where: { id: newerLowerScore } });
    // olderHighScore was already deleted by cleanup
    void olderHighScore;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend && NODE_OPTIONS='--max-old-space-size=8192' npx vitest run src/__tests__/cleanup-examples.integration.test.ts
```

Expected: FAIL — `cleanupExamplesForPrompt` does not accept a second `options` argument; TypeScript compile error OR runtime "options is not defined". This proves the option doesn't exist yet.

- [ ] **Step 3: Add the `prefer` option to the service function**

File: `packages/backend/src/services/workbench-examples.service.ts:348` — replace the existing function signature + raw SQL block.

Replace this block (the entire `cleanupExamplesForPrompt` function, lines 348-403):

```typescript
export async function cleanupExamplesForPrompt(promptId: string): Promise<{
  keptId: string | null;
  deleted: number;
  filesDeleted: number;
}> {
  // Complex ORDER BY CASE → stays as raw SQL
  const rows = await prisma.$queryRaw<CleanupExampleRow[]>`
    SELECT e.id, e.stl_path, e.step_path, e.threemf_path,
            e.screenshot_front, e.screenshot_back, e.screenshot_left, e.screenshot_right,
            e.screenshot_top, e.screenshot_bottom, e.screenshot_ortho_45, e.screenshot_ortho_45_bottom,
            e.screenshot_iso, e.screenshot_iso_back,
            p.category_id
     FROM workbench_examples e
     JOIN workbench_example_prompts p ON p.id = e.prompt_id
     WHERE e.prompt_id = ${promptId}::uuid AND e.experiment_run_id IS NULL
     ORDER BY
       CASE e.approval_status
         WHEN 'human_approved' THEN 1
         WHEN 'auto_approved' THEN 2
         WHEN 'pending' THEN 3
         WHEN 'rejected' THEN 4
       END ASC,
       e.eval_score DESC NULLS LAST,
       e.created_at DESC
  `;
```

with:

```typescript
export type CleanupPrefer = "score" | "newest-approved";

export async function cleanupExamplesForPrompt(
  promptId: string,
  options: { prefer?: CleanupPrefer } = {},
): Promise<{
  keptId: string | null;
  deleted: number;
  filesDeleted: number;
}> {
  const prefer: CleanupPrefer = options.prefer ?? "score";

  // Complex ORDER BY CASE → stays as raw SQL. The newest-approved mode inserts
  // an extra discriminator before eval_score: when the row is approved
  // (auto or human), prefer the newest created_at. Non-approved rows fall
  // through to the eval_score / created_at chain unchanged.
  const rows = prefer === "newest-approved"
    ? await prisma.$queryRaw<CleanupExampleRow[]>`
        SELECT e.id, e.stl_path, e.step_path, e.threemf_path,
                e.screenshot_front, e.screenshot_back, e.screenshot_left, e.screenshot_right,
                e.screenshot_top, e.screenshot_bottom, e.screenshot_ortho_45, e.screenshot_ortho_45_bottom,
                e.screenshot_iso, e.screenshot_iso_back,
                p.category_id
         FROM workbench_examples e
         JOIN workbench_example_prompts p ON p.id = e.prompt_id
         WHERE e.prompt_id = ${promptId}::uuid AND e.experiment_run_id IS NULL
         ORDER BY
           CASE e.approval_status
             WHEN 'human_approved' THEN 1
             WHEN 'auto_approved' THEN 1
             WHEN 'pending'       THEN 3
             WHEN 'rejected'      THEN 4
           END ASC,
           CASE WHEN e.approval_status IN ('human_approved','auto_approved')
                THEN e.created_at
                ELSE NULL
           END DESC NULLS LAST,
           e.eval_score DESC NULLS LAST,
           e.created_at DESC
      `
    : await prisma.$queryRaw<CleanupExampleRow[]>`
        SELECT e.id, e.stl_path, e.step_path, e.threemf_path,
                e.screenshot_front, e.screenshot_back, e.screenshot_left, e.screenshot_right,
                e.screenshot_top, e.screenshot_bottom, e.screenshot_ortho_45, e.screenshot_ortho_45_bottom,
                e.screenshot_iso, e.screenshot_iso_back,
                p.category_id
         FROM workbench_examples e
         JOIN workbench_example_prompts p ON p.id = e.prompt_id
         WHERE e.prompt_id = ${promptId}::uuid AND e.experiment_run_id IS NULL
         ORDER BY
           CASE e.approval_status
             WHEN 'human_approved' THEN 1
             WHEN 'auto_approved' THEN 2
             WHEN 'pending'       THEN 3
             WHEN 'rejected'      THEN 4
           END ASC,
           e.eval_score DESC NULLS LAST,
           e.created_at DESC
      `;
```

Per the user's spec (decision #1): in `newest-approved` mode, `human_approved` and `auto_approved` get the **same status tier (rank 1)** so the date discriminator picks between them; in the default `score` mode the existing `human_approved > auto_approved` priority is preserved.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend && NODE_OPTIONS='--max-old-space-size=8192' npx vitest run src/__tests__/cleanup-examples.integration.test.ts
```

Expected: PASS (1 test). The newer approved row at score 8.5 wins over the older approved row at score 9.2.

- [ ] **Step 5: Add a second test for the score-mode fallback**

Append to `packages/backend/src/__tests__/cleanup-examples.integration.test.ts` inside the existing `describe` block:

```typescript
describe("cleanupExamplesForPrompt — default prefer='score'", () => {
  it("keeps the highest-scoring approved example even if older", async () => {
    const olderHighScore = await insertExample(promptId, "auto_approved", 9.2, "2026-04-03T10:00:00Z");
    const newerLowerScore = await insertExample(promptId, "auto_approved", 8.5, "2026-05-11T10:00:00Z");

    const result = await cleanupExamplesForPrompt(promptId);  // default: prefer="score"

    expect(result.keptId).toBe(olderHighScore);
    expect(result.deleted).toBe(1);

    await prisma.workbenchExample.delete({ where: { id: olderHighScore } });
    void newerLowerScore;
  });
});

describe("cleanupExamplesForPrompt — prefer='newest-approved' fallback when no approved", () => {
  it("falls back to score ordering when no example is approved", async () => {
    const pendingHigh = await insertExample(promptId, "pending", 7.0, "2026-04-03T10:00:00Z");
    const pendingLow = await insertExample(promptId, "pending", 6.0, "2026-05-11T10:00:00Z");

    const result = await cleanupExamplesForPrompt(promptId, { prefer: "newest-approved" });

    // No approved examples → falls through to eval_score DESC → pendingHigh wins
    expect(result.keptId).toBe(pendingHigh);
    expect(result.deleted).toBe(1);

    await prisma.workbenchExample.delete({ where: { id: pendingHigh } });
    void pendingLow;
  });
});
```

- [ ] **Step 6: Run all tests to verify both pass**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend && NODE_OPTIONS='--max-old-space-size=8192' npx vitest run src/__tests__/cleanup-examples.integration.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app && git add packages/backend/src/services/workbench-examples.service.ts packages/backend/src/__tests__/cleanup-examples.integration.test.ts && git commit -m "$(cat <<'EOF'
Add prefer='newest-approved' mode to cleanupExamplesForPrompt

Default ordering (status > score > date) still wins when prefer='score'
(the default). When prefer='newest-approved', auto_approved and human_approved
collapse to the same tier and created_at DESC becomes the primary discriminator
among approved examples — so a regenerate-all that produces an approved
example with a captured agent trace replaces older approved examples even if
the new score is slightly lower.

Falls back to score-based ordering when no example is approved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `dryRun` option to `cleanupExamplesForPrompt` + return preview detail

**Files:**
- Modify: `packages/backend/src/services/workbench-examples.service.ts` (extend signature + return shape, no DB writes when `dryRun=true`)
- Test: `packages/backend/src/__tests__/cleanup-examples.integration.test.ts`

The function currently returns `{ keptId, deleted, filesDeleted }`. We need a richer shape that the UI can render. Keep the existing shape when `dryRun=false` (default) for backwards compatibility; on `dryRun=true` add a `preview` field with per-example detail.

- [ ] **Step 1: Add the failing test**

Append to `packages/backend/src/__tests__/cleanup-examples.integration.test.ts`:

```typescript
describe("cleanupExamplesForPrompt — dryRun=true", () => {
  it("returns kept + dropped detail without deleting anything", async () => {
    const older = await insertExample(promptId, "auto_approved", 9.2, "2026-04-03T10:00:00Z");
    const newer = await insertExample(promptId, "auto_approved", 8.5, "2026-05-11T10:00:00Z");
    const rejected = await insertExample(promptId, "rejected", 4.0, "2026-04-02T10:00:00Z");

    const result = await cleanupExamplesForPrompt(promptId, {
      prefer: "newest-approved",
      dryRun: true,
    });

    expect(result.keptId).toBe(newer);
    expect(result.deleted).toBe(0);          // nothing deleted in dry-run
    expect(result.filesDeleted).toBe(0);
    expect(result.preview).toBeDefined();
    expect(result.preview!.kept.id).toBe(newer);
    expect(result.preview!.kept.approvalStatus).toBe("auto_approved");
    expect(result.preview!.dropped.map(d => d.id).sort()).toEqual([older, rejected].sort());
    // fellBackToOlder=false because the kept row is newer than every dropped row
    expect(result.preview!.fellBackToOlder).toBe(false);

    // Verify NOTHING was actually deleted
    const rows = await prisma.workbenchExample.findMany({ where: { promptId }, select: { id: true } });
    expect(rows.map(r => r.id).sort()).toEqual([older, newer, rejected].sort());

    // Cleanup test data
    await prisma.workbenchExample.deleteMany({ where: { promptId } });
  });

  it("flags fellBackToOlder=true when regenerate didn't produce an approved example", async () => {
    const olderApproved = await insertExample(promptId, "auto_approved", 8.5, "2026-04-03T10:00:00Z");
    const newerPending = await insertExample(promptId, "pending", 7.0, "2026-05-11T10:00:00Z");

    const result = await cleanupExamplesForPrompt(promptId, {
      prefer: "newest-approved",
      dryRun: true,
    });

    // Pending doesn't qualify as approved → falls back to older approved
    expect(result.keptId).toBe(olderApproved);
    expect(result.preview!.fellBackToOlder).toBe(true);
    expect(result.preview!.dropped.map(d => d.id)).toEqual([newerPending]);

    await prisma.workbenchExample.deleteMany({ where: { promptId } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend && NODE_OPTIONS='--max-old-space-size=8192' npx vitest run src/__tests__/cleanup-examples.integration.test.ts
```

Expected: FAIL — `result.preview` is undefined; TypeScript compile error on `dryRun` option not being accepted.

- [ ] **Step 3: Extend the function with `dryRun` and the preview return shape**

In `packages/backend/src/services/workbench-examples.service.ts`, near the top of the file (after the existing `CleanupExampleRow` type or near the `cleanupExamplesForPrompt` declaration), add new types:

```typescript
export interface CleanupPreviewExample {
  id: string;
  approvalStatus: "auto_approved" | "human_approved" | "pending" | "rejected";
  evalScore: number | null;
  createdAt: string;        // ISO
  hasAgentTrace: boolean;
}

export interface CleanupPreview {
  kept: CleanupPreviewExample;
  dropped: CleanupPreviewExample[];
  /** True iff the kept example is older than at least one dropped example
   *  (i.e. regenerate didn't beat the threshold for this prompt). */
  fellBackToOlder: boolean;
}
```

The SELECT in both ordering branches needs to also fetch the columns we use to build `CleanupPreviewExample`. Add to both raw-SQL branches (the SELECT list):

```
e.approval_status, e.eval_score, e.created_at,
(e.agent_conversation IS NOT NULL) AS has_agent_trace,
```

So the `CleanupExampleRow` type (likely defined elsewhere in the file — find it and extend it) gets those columns. If it's defined inline as `interface CleanupExampleRow { id: string; stl_path: string | null; ... }`, add:

```typescript
approval_status: string;
eval_score: number | null;
created_at: Date;
has_agent_trace: boolean;
```

Then replace the function body (after the existing `const rows = …` block) to compute preview when requested and skip deletes:

```typescript
  if (rows.length <= 1) {
    return {
      keptId: rows[0]?.id ?? null,
      deleted: 0,
      filesDeleted: 0,
      preview: options.dryRun
        ? rows[0]
          ? {
              kept: toPreview(rows[0]),
              dropped: [],
              fellBackToOlder: false,
            }
          : undefined
        : undefined,
    };
  }

  const [keeper, ...toPurge] = rows;

  if (options.dryRun) {
    const droppedRows = toPurge.map(toPreview);
    const fellBackToOlder = droppedRows.some(
      d => new Date(d.createdAt).getTime() > new Date(keeper.created_at).getTime(),
    );
    return {
      keptId: keeper.id,
      deleted: 0,
      filesDeleted: 0,
      preview: {
        kept: toPreview(keeper),
        dropped: droppedRows,
        fellBackToOlder,
      },
    };
  }

  // ... existing delete logic unchanged ...
```

And add a small helper at the bottom of the file (or near the function):

```typescript
function toPreview(row: CleanupExampleRow): CleanupPreviewExample {
  return {
    id: row.id,
    approvalStatus: row.approval_status as CleanupPreviewExample["approvalStatus"],
    evalScore: row.eval_score == null ? null : Number(row.eval_score),
    createdAt: row.created_at.toISOString(),
    hasAgentTrace: row.has_agent_trace,
  };
}
```

Update the function signature:

```typescript
export async function cleanupExamplesForPrompt(
  promptId: string,
  options: { prefer?: CleanupPrefer; dryRun?: boolean } = {},
): Promise<{
  keptId: string | null;
  deleted: number;
  filesDeleted: number;
  preview?: CleanupPreview;
}>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend && NODE_OPTIONS='--max-old-space-size=8192' npx vitest run src/__tests__/cleanup-examples.integration.test.ts
```

Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app && git add packages/backend/src/services/workbench-examples.service.ts packages/backend/src/__tests__/cleanup-examples.integration.test.ts && git commit -m "$(cat <<'EOF'
Add dryRun option + preview detail to cleanupExamplesForPrompt

When dryRun=true, no deletes happen and the return shape includes a
preview blob: { kept, dropped[], fellBackToOlder }. Each entry carries
approval_status, eval_score, created_at, and a hasAgentTrace flag derived
from whether agent_conversation is populated.

fellBackToOlder is true iff the kept example is older than at least one
dropped example — i.e., regenerate didn't beat the current best so the
older example survives. This is the diagnostic for "which prompts still
need re-running."

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Thread options through `startBatchCleanup` and surface preview in BatchJob

**Files:**
- Modify: `packages/backend/src/services/workbench-batch.service.ts:52-60` (extend `BatchPromptResult` type), `:985-1115` (extend `startBatchCleanup` + `runBatchCleanup`).

The existing `BatchJob.results: BatchPromptResult[]` array is the natural carrier for per-prompt preview data. Extend `BatchPromptResult` with an optional `preview` field; the batch runner populates it when dry-running.

- [ ] **Step 1: Extend the `BatchPromptResult` interface**

In `packages/backend/src/services/workbench-batch.service.ts:52-60`, replace:

```typescript
export interface BatchPromptResult {
  promptId: string;
  promptText: string;
  status: "success" | "error" | "skipped" | "rejected" | "disambiguation";
  exampleId: string | null;
  evalScore: number | null;
  approvalStatus: string | null;
  error: string | null;
}
```

with:

```typescript
import type { CleanupPreview } from "./workbench-examples.service.js";  // add near other workbench-examples imports

export interface BatchPromptResult {
  promptId: string;
  promptText: string;
  status: "success" | "error" | "skipped" | "rejected" | "disambiguation";
  exampleId: string | null;
  evalScore: number | null;
  approvalStatus: string | null;
  error: string | null;
  /** Present only on dry-run cleanup jobs. */
  cleanupPreview?: CleanupPreview;
}
```

If `CleanupPreview` is already imported via `cleanupExamplesForPrompt` import at the top of the file (line 16), just add `CleanupPreview` to the same import.

- [ ] **Step 2: Extend `startBatchCleanup` signature**

In `packages/backend/src/services/workbench-batch.service.ts:985`, replace:

```typescript
export async function startBatchCleanup(categoryId: string): Promise<BatchJobSummary> {
```

with:

```typescript
export async function startBatchCleanup(
  categoryId: string,
  options: { prefer?: "score" | "newest-approved"; dryRun?: boolean } = {},
): Promise<BatchJobSummary> {
```

- [ ] **Step 3: Pass options into `runBatchCleanup`**

In the same file, find the `void runBatchCleanup(job, prompts);` call (around line 1043). Replace:

```typescript
  void runBatchCleanup(job, prompts);
```

with:

```typescript
  void runBatchCleanup(job, prompts, options);
```

And update the `runBatchCleanup` signature (line 1053):

```typescript
async function runBatchCleanup(
  job: BatchJob,
  prompts: Array<{ id: string; prompt: string }>,
  options: { prefer?: "score" | "newest-approved"; dryRun?: boolean } = {},
): Promise<void> {
```

- [ ] **Step 4: Pass options into `cleanupExamplesForPrompt` and capture preview**

In `runBatchCleanup`, find the call:

```typescript
      const result = await cleanupExamplesForPrompt(prompt.id);
      totalDeleted += result.deleted;
      totalFilesDeleted += result.filesDeleted;

      job.completed += 1;
      job.results.push({
        promptId: prompt.id,
        promptText: prompt.prompt,
        status: "success",
        exampleId: result.keptId,
        evalScore: null,
        approvalStatus: null,
        error: null,
      });
```

and replace with:

```typescript
      const result = await cleanupExamplesForPrompt(prompt.id, options);
      totalDeleted += result.deleted;
      totalFilesDeleted += result.filesDeleted;

      job.completed += 1;
      job.results.push({
        promptId: prompt.id,
        promptText: prompt.prompt,
        status: "success",
        exampleId: result.keptId,
        evalScore: result.preview?.kept.evalScore ?? null,
        approvalStatus: result.preview?.kept.approvalStatus ?? null,
        error: null,
        cleanupPreview: result.preview,
      });
```

- [ ] **Step 5: Type-check the backend**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend && NODE_OPTIONS='--max-old-space-size=8192' npx tsc --noEmit -p tsconfig.json
```

Expected: clean (exit 0). If `CleanupPreview` import path is wrong, fix the import and re-run.

- [ ] **Step 6: Run existing tests to make sure nothing broke**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend && NODE_OPTIONS='--max-old-space-size=8192' npx vitest run src/__tests__/cleanup-examples.integration.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app && git add packages/backend/src/services/workbench-batch.service.ts && git commit -m "$(cat <<'EOF'
Thread prefer + dryRun through startBatchCleanup; surface preview per prompt

BatchPromptResult.cleanupPreview now carries the per-prompt detail
(kept + dropped[] + fellBackToOlder) when the batch job runs with
dryRun=true. The existing job-status polling endpoint already returns
job.results, so the UI can read preview rows from there without any
new endpoint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Accept `prefer` + `dryRun` in the `/cleanup/batch` route

**Files:**
- Modify: `packages/backend/src/routes/workbench.routes.ts:597-619`

- [ ] **Step 1: Replace the route body parsing + call**

In `packages/backend/src/routes/workbench.routes.ts`, replace the existing handler at line 597:

```typescript
workbenchRouter.post("/cleanup/batch", async (req, res) => {
  try {
    const { categoryId } = req.body as { categoryId?: string };
    if (!categoryId || typeof categoryId !== "string") {
      res.status(400).json({ error: "categoryId is required" });
      return;
    }
    const job = await startBatchCleanup(categoryId);
    res.status(202).json(job);
  } catch (error) {
    // ... existing error handling unchanged
  }
});
```

with:

```typescript
workbenchRouter.post("/cleanup/batch", async (req, res) => {
  try {
    const { categoryId, prefer, dryRun } = req.body as {
      categoryId?: string;
      prefer?: "score" | "newest-approved";
      dryRun?: boolean;
    };
    if (!categoryId || typeof categoryId !== "string") {
      res.status(400).json({ error: "categoryId is required" });
      return;
    }
    if (prefer !== undefined && prefer !== "score" && prefer !== "newest-approved") {
      res.status(400).json({ error: "prefer must be 'score' or 'newest-approved'" });
      return;
    }
    const job = await startBatchCleanup(categoryId, {
      prefer,
      dryRun: dryRun === true,
    });
    res.status(202).json(job);
  } catch (error) {
    if (error instanceof WorkbenchCatalogError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 600) {
      res.status(statusCode).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    logger.error({ err: error }, "batch cleanup failed");
    res.status(500).json({ error: "Batch cleanup failed", detail: String(error) });
  }
});
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend && NODE_OPTIONS='--max-old-space-size=8192' npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0.

- [ ] **Step 3: Manual smoke test against the live API**

```bash
docker compose build backend && docker compose up -d backend
sleep 6
TOKEN=$(cat /tmp/chat3d-token.txt)
# Find a category with multiple examples per prompt
curl -s "http://localhost/api/admin/workbench/categories" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; cats=json.load(sys.stdin); [print(c['id'], c['name']) for c in cats if c.get('promptCount',0) > 5][:3]"
# Pick one CATEGORY_ID from the list above, then:
curl -s -X POST "http://localhost/api/admin/workbench/cleanup/batch" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"categoryId\":\"<CATEGORY_ID>\",\"prefer\":\"newest-approved\",\"dryRun\":true}" \
  | python3 -m json.tool
```

Expected: HTTP 202 with a job object. Then poll the job:

```bash
JOB_ID=<from-previous-response>
curl -s "http://localhost/api/admin/workbench/jobs/$JOB_ID" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; j=json.load(sys.stdin); print('status:',j['status']); print('total:',j['total']); print('completed:',j['completed'])"
```

Expected: status eventually becomes `completed`. Repeat with a richer query that pulls `results[0].cleanupPreview` to confirm preview detail is present.

Verify in the database that **no examples were deleted** (run the same prompt count before and after, or pick a prompt and verify all rows still present).

- [ ] **Step 4: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app && git add packages/backend/src/routes/workbench.routes.ts && git commit -m "$(cat <<'EOF'
Accept prefer + dryRun in POST /workbench/cleanup/batch

Both fields optional in body. prefer validated to 'score' (default) or
'newest-approved'; dryRun defaults to false. When dryRun=true, the
batch job runs to completion populating cleanupPreview per prompt
without deleting anything.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Extend frontend `startBatchCleanup` API wrapper

**Files:**
- Modify: `packages/frontend/src/api/workbench.api.ts:279-287` (signature) + extend `BatchPromptResult` type wherever it lives in the API client.

- [ ] **Step 1: Find the BatchPromptResult type in the frontend**

```bash
grep -n "BatchPromptResult\|cleanupPreview\|approval_status" /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/frontend/src/api/workbench.api.ts | head -10
```

If it exists, extend it the same way as the backend (add optional `cleanupPreview`). If only used inline, add it as an exported type.

- [ ] **Step 2: Add `CleanupPreview` type to the frontend API client**

In `packages/frontend/src/api/workbench.api.ts`, near the top exports (before `startBatchCleanup`):

```typescript
export interface CleanupPreviewExample {
  id: string;
  approvalStatus: "auto_approved" | "human_approved" | "pending" | "rejected";
  evalScore: number | null;
  createdAt: string;
  hasAgentTrace: boolean;
}

export interface CleanupPreview {
  kept: CleanupPreviewExample;
  dropped: CleanupPreviewExample[];
  fellBackToOlder: boolean;
}
```

If a `BatchPromptResult` type already exists, add `cleanupPreview?: CleanupPreview` to it. Otherwise create it.

- [ ] **Step 3: Extend the `startBatchCleanup` wrapper**

Replace the existing function at line 279:

```typescript
export function startBatchCleanup(
  token: string,
  categoryId: string,
): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, "/cleanup/batch", {
    method: "POST",
    body: JSON.stringify({ categoryId }),
  });
}
```

with:

```typescript
export function startBatchCleanup(
  token: string,
  categoryId: string,
  options: { prefer?: "score" | "newest-approved"; dryRun?: boolean } = {},
): Promise<BatchJobSummary> {
  return requestJson<BatchJobSummary>(token, "/cleanup/batch", {
    method: "POST",
    body: JSON.stringify({ categoryId, ...options }),
  });
}
```

- [ ] **Step 4: Type-check the frontend**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/frontend && NODE_OPTIONS='--max-old-space-size=8192' npx tsc -p tsconfig.json 2>&1 | grep -E "workbench\.api\.ts|WorkbenchCategoryPage" | head -10
```

Expected: no new errors in the files we touched. Pre-existing errors elsewhere (Gallery, Legal, Register pages — see earlier conversation) can be ignored.

- [ ] **Step 5: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app && git add packages/frontend/src/api/workbench.api.ts && git commit -m "$(cat <<'EOF'
Extend frontend startBatchCleanup with prefer + dryRun options

Adds CleanupPreviewExample + CleanupPreview types for typed access to
the per-prompt detail returned in BatchPromptResult.cleanupPreview when
a cleanup job runs with dryRun=true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Build `CleanupPreviewTable` component

**Files:**
- Create: `packages/frontend/src/components/admin/CleanupPreviewTable.tsx`

This component takes the batch job's `results: BatchPromptResult[]` and renders:
1. An aggregate header (totals, fell-back count, files freed)
2. A per-prompt table (sortable; filter for fell-back-only)
3. An "Apply changes" button that emits a callback

- [ ] **Step 1: Create the component file**

File: `packages/frontend/src/components/admin/CleanupPreviewTable.tsx`

```typescript
import { useMemo, useState } from "react";
import type { BatchPromptResult } from "../../api/workbench.api";
import { Button } from "../ui/button";

interface Props {
  results: BatchPromptResult[];
  onApply: () => void;
  onCancel: () => void;
  applying: boolean;
}

export function CleanupPreviewTable({ results, onApply, onCancel, applying }: Props) {
  const [filterFellBack, setFilterFellBack] = useState(false);

  const previews = useMemo(
    () => results.filter(r => r.cleanupPreview != null),
    [results],
  );

  const totals = useMemo(() => {
    let prompts = previews.length;
    let totalDrops = 0;
    let fellBack = 0;
    let traceKept = 0;
    for (const r of previews) {
      const p = r.cleanupPreview!;
      totalDrops += p.dropped.length;
      if (p.fellBackToOlder) fellBack++;
      if (p.kept.hasAgentTrace) traceKept++;
    }
    return { prompts, totalDrops, fellBack, traceKept };
  }, [previews]);

  const rowsToShow = filterFellBack
    ? previews.filter(r => r.cleanupPreview!.fellBackToOlder)
    : previews;

  if (previews.length === 0) {
    return (
      <div className="p-4 text-sm text-[hsl(var(--muted-foreground))]">
        Preview still loading — no per-prompt detail available yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Aggregate header */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.2)] p-3 text-sm">
        <div className="font-medium">Preview summary</div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Prompts" value={totals.prompts} />
          <Stat label="Will delete" value={totals.totalDrops} />
          <Stat label="Kept with trace" value={totals.traceKept} />
          <Stat
            label="Fell back to older"
            value={totals.fellBack}
            warn={totals.fellBack > 0}
          />
        </div>
        {totals.fellBack > 0 ? (
          <p className="mt-2 text-xs text-[hsl(var(--destructive))]">
            {totals.fellBack} prompt(s) kept an older example because regeneration
            didn't produce an approved result. Consider re-running those prompts.
          </p>
        ) : null}
      </div>

      {/* Filter */}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={filterFellBack}
          onChange={(e) => setFilterFellBack(e.target.checked)}
        />
        Show only prompts that fell back to an older example
      </label>

      {/* Per-prompt table */}
      <div className="max-h-96 overflow-auto rounded-lg border border-[hsl(var(--border))]">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[hsl(var(--card))]">
            <tr className="border-b border-[hsl(var(--border))]">
              <th className="px-2 py-1.5 font-medium">Prompt</th>
              <th className="px-2 py-1.5 font-medium">Keep</th>
              <th className="px-2 py-1.5 text-right font-medium">Score</th>
              <th className="px-2 py-1.5 font-medium">Date</th>
              <th className="px-2 py-1.5 font-medium">Trace</th>
              <th className="px-2 py-1.5 text-right font-medium">Drop</th>
            </tr>
          </thead>
          <tbody>
            {rowsToShow.map((r) => {
              const p = r.cleanupPreview!;
              return (
                <tr
                  key={r.promptId}
                  className={p.fellBackToOlder ? "bg-[hsl(var(--destructive)/0.08)]" : ""}
                >
                  <td className="px-2 py-1.5 max-w-md truncate" title={r.promptText}>
                    {r.promptText}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[10px]">{p.kept.id.slice(0, 8)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {p.kept.evalScore != null ? p.kept.evalScore.toFixed(1) : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    {new Date(p.kept.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-2 py-1.5">{p.kept.hasAgentTrace ? "✓" : "—"}</td>
                  <td className="px-2 py-1.5 text-right">{p.dropped.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} disabled={applying}>
          Cancel
        </Button>
        <Button size="sm" onClick={onApply} disabled={applying}>
          {applying ? "Applying…" : "Apply changes"}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className={`text-base font-semibold ${warn ? "text-[hsl(var(--destructive))]" : ""}`}>
        {value}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/frontend && NODE_OPTIONS='--max-old-space-size=8192' npx tsc -p tsconfig.json 2>&1 | grep "CleanupPreviewTable" | head -5
```

Expected: no errors mentioning `CleanupPreviewTable`.

- [ ] **Step 3: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app && git add packages/frontend/src/components/admin/CleanupPreviewTable.tsx && git commit -m "$(cat <<'EOF'
Add CleanupPreviewTable component

Renders batch-cleanup preview results: aggregate header (prompts, drops,
trace-kept count, fell-back count) + per-prompt table with a filter for
the fell-back-to-older rows. Emits onApply when the user confirms.

Highlights fell-back rows in destructive tint and surfaces the count
prominently so the user can identify prompts where regenerate-all didn't
clear the auto-approval threshold.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire the two-step preview-then-apply flow into the category page

**Files:**
- Modify: `packages/frontend/src/components/WorkbenchCategoryPage.tsx:371-385` (handleCleanup), `:661-680` (cleanup modal markup), and add a new state slot for `previewJob`.

The current flow: `setConfirmCleanup(true)` → modal opens → user clicks confirm → `startBatchCleanup(token, categoryId)` runs (real delete) → modal closes.

New flow: confirm opens modal → user sees a "Preview cleanup" button → clicking it calls `startBatchCleanup(token, categoryId, { prefer: "newest-approved", dryRun: true })` → polls the job to completion → modal swaps to `CleanupPreviewTable` → user clicks Apply → second `startBatchCleanup` call without `dryRun` → modal closes.

- [ ] **Step 1: Update imports + state**

Near the top of `packages/frontend/src/components/WorkbenchCategoryPage.tsx`, add:

```typescript
import { CleanupPreviewTable } from "./admin/CleanupPreviewTable";
import type { BatchPromptResult } from "../api/workbench.api";
```

Near line 105 where `confirmCleanup` state is declared, add:

```typescript
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [previewResults, setPreviewResults] = useState<BatchPromptResult[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyingCleanup, setApplyingCleanup] = useState(false);
```

- [ ] **Step 2: Replace `handleCleanup` (line 371) with a two-step helper**

Replace:

```typescript
  const handleCleanup = useCallback(async () => {
    try {
      // ... existing single-step body
      const job = await startBatchCleanup(token, categoryId);
      setBatchJob(job);
      setConfirmCleanup(false);
      // ...
    } catch (err) {
      // ...
    }
  }, [token, categoryId, /* deps */]);
```

with:

```typescript
  const startPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewResults([]);
    try {
      const job = await startBatchCleanup(token, categoryId, {
        prefer: "newest-approved",
        dryRun: true,
      });
      setPreviewJobId(job.jobId);
    } catch (err) {
      addToast({
        title: "Preview failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      setPreviewLoading(false);
    }
  }, [token, categoryId, addToast]);

  // Poll the preview job to completion and pull results
  useEffect(() => {
    if (!previewJobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await getJobStatus(token, previewJobId);
        if (cancelled) return;
        if (status.status === "completed" || status.status === "failed") {
          // Fetch the full job to get results array (status endpoint may omit it)
          const full = await fetch(`/api/admin/workbench/jobs/${previewJobId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then(r => r.json());
          if (cancelled) return;
          setPreviewResults(full.results ?? []);
          setPreviewLoading(false);
        } else {
          setTimeout(tick, 1500);
        }
      } catch (err) {
        if (!cancelled) {
          setPreviewLoading(false);
          addToast({
            title: "Preview polling failed",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        }
      }
    };
    void tick();
    return () => { cancelled = true; };
  }, [previewJobId, token, addToast]);

  const applyCleanup = useCallback(async () => {
    setApplyingCleanup(true);
    try {
      const job = await startBatchCleanup(token, categoryId, {
        prefer: "newest-approved",
        dryRun: false,
      });
      setBatchJob(job);
      setConfirmCleanup(false);
      setPreviewJobId(null);
      setPreviewResults([]);
      addToast({
        title: "Cleanup started",
        description: `Job ${job.jobId} is processing ${job.total} prompt(s).`,
      });
    } catch (err) {
      addToast({
        title: "Cleanup failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setApplyingCleanup(false);
    }
  }, [token, categoryId, addToast]);

  const cancelPreview = useCallback(() => {
    setConfirmCleanup(false);
    setPreviewJobId(null);
    setPreviewResults([]);
    setPreviewLoading(false);
  }, []);
```

Note: `getJobStatus` is imported alongside `startBatchCleanup` — if missing, add it to the existing import line.

- [ ] **Step 3: Replace the cleanup modal markup (around line 661)**

The existing modal has a confirm/cancel pair. Replace its body with a state-machine: idle → loading → preview → applying.

Find the existing block:

```tsx
      {/* Cleanup confirmation */}
      <Modal
        open={confirmCleanup}
        title="Cleanup category"
        // ...
      >
        <p>Are you sure you want to clean up?</p>
        <Button onClick={handleCleanup}>Confirm</Button>
        <Button onClick={() => setConfirmCleanup(false)}>Cancel</Button>
      </Modal>
```

Replace its body with:

```tsx
      {/* Cleanup preview + apply */}
      <Modal
        open={confirmCleanup}
        title="Cleanup category"
        onClose={cancelPreview}
      >
        {previewResults.length === 0 && !previewLoading ? (
          <div className="space-y-4">
            <p className="text-sm">
              Preview what cleanup will keep and delete. Uses{" "}
              <span className="font-mono">prefer=newest-approved</span> — among
              approved examples, the newest wins.
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={cancelPreview}>
                Cancel
              </Button>
              <Button size="sm" onClick={startPreview}>
                Preview cleanup
              </Button>
            </div>
          </div>
        ) : previewLoading ? (
          <p className="p-4 text-sm text-[hsl(var(--muted-foreground))]">
            Running preview…
          </p>
        ) : (
          <CleanupPreviewTable
            results={previewResults}
            onApply={applyCleanup}
            onCancel={cancelPreview}
            applying={applyingCleanup}
          />
        )}
      </Modal>
```

- [ ] **Step 4: Type-check + build the frontend**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/frontend && NODE_OPTIONS='--max-old-space-size=8192' npx tsc -p tsconfig.json 2>&1 | grep "WorkbenchCategoryPage" | head -10
```

Expected: no new errors in WorkbenchCategoryPage. If `getJobStatus` is missing from imports, add it.

```bash
docker compose build frontend && docker compose up -d frontend
```

Expected: build succeeds.

- [ ] **Step 5: Manual smoke test in the browser**

Open `http://localhost/admin/workbench/categories/<category-with-multiple-examples>`. Click Cleanup → click "Preview cleanup" → wait for the table to load → verify:

- Aggregate header shows correct prompt count
- Per-prompt table renders
- Fell-back rows (if any) are highlighted
- "Apply changes" button starts the real cleanup
- Cancel doesn't delete anything (verify by checking example counts in the DB before/after a cancelled preview)

- [ ] **Step 6: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app && git add packages/frontend/src/components/WorkbenchCategoryPage.tsx && git commit -m "$(cat <<'EOF'
Wire cleanup preview + apply two-step flow into category page

Cleanup modal now runs a dry-run job first, surfaces the per-prompt
preview table (with the fell-back-to-older diagnostic prominent), and
only commits the real cleanup when the user clicks Apply. Defaults to
prefer=newest-approved which is the mode this feature was built for —
'regenerate-all then keep the trace-bearing new examples even if their
scores are slightly lower than the old high-water mark.'

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: End-to-end verification on a real category

- [ ] **Step 1: Pick a category that just had regenerate-all run**

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
curl -s "http://localhost/api/admin/workbench/categories" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; [print(c['id'], c['name'], c.get('approvedPromptCount')) for c in json.load(sys.stdin)]"
```

Pick a category where you've run regenerate-all recently. Note the id.

- [ ] **Step 2: Run preview, inspect output**

In the browser at `/admin/workbench/categories/<id>`:
1. Click Cleanup → Preview cleanup.
2. Verify "Kept with trace" count looks plausible (should match the number of prompts that got new generations).
3. If "Fell back to older" > 0, filter to those rows and inspect — they're the prompts whose regenerate didn't produce an approved result. These are the ones you'd want to re-run.

- [ ] **Step 3: Apply and verify**

Click Apply. Wait for the batch-cleanup job to complete. Spot-check 2-3 prompts in the DB:

```bash
docker exec chat3d-postgres bash -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "
SELECT we.id, we.approval_status, we.eval_score, we.created_at, (we.agent_conversation IS NOT NULL) AS has_trace
FROM workbench_examples we
WHERE we.prompt_id = '"'"'<prompt-id>'"'"'::uuid AND we.experiment_run_id IS NULL
ORDER BY we.created_at DESC;
"'
```

Expected: exactly one row per prompt, and the surviving row should be the newest among the approved set (if approved examples existed).

---

## Self-Review

**Spec coverage:** User asked for: (a) understand what cleanup does on ties — answered in pre-plan investigation, no task needed; (b) conditional cleanup that only deletes when new is above threshold — Task 1 (`prefer=newest-approved`); (c) dry-run with a real preview, not 10 lines — Tasks 2-7 deliver per-prompt detail with aggregate header + fell-back highlighting. All covered.

**Placeholder scan:** No "TBD", "implement later", "similar to Task N" without code, or hand-wavy steps. Every code-changing step shows full code.

**Type consistency:** `CleanupPreview` / `CleanupPreviewExample` defined in Task 2, imported into batch service in Task 3, re-declared (matching) in the frontend API client in Task 5, consumed in Task 6 and Task 7. All field names match across files (`approvalStatus`, `evalScore`, `createdAt`, `hasAgentTrace`, `fellBackToOlder`).

**One residual risk:** The plan extends `CleanupExampleRow` by adding `approval_status`, `eval_score`, `created_at`, `has_agent_trace` to its declaration. The exact location of that type in `workbench-examples.service.ts` isn't pinned in the plan — the implementer needs to grep for it (`grep -n "CleanupExampleRow" packages/backend/src/services/workbench-examples.service.ts`) and extend it. If it doesn't exist as a named type, the implementer can add it inline near the function or as an interface near the top of the file. Acceptable ambiguity for an experienced TS developer.
