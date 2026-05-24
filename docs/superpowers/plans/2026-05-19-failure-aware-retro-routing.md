# Failure-Aware Retro-Routing Implementation Plan

> **Status:** Shipped 2026-05-19. Commits `5702eae` → `8a84619` (9 tasks, 41 checkboxes flipped retroactively 2026-05-23). Plan retained for reference.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a single-agent codegen pipeline aborts on timeout WITH zero tool calls (clear over-reasoning hang), persist a sticky cached decomposition verdict for that `(prompt_id, model_id)` so future runs auto-route to multi-agent without consulting the live decider.

**Architecture:** Add an `override_source` column to `decomposition_decisions`. On a timeout-abort with `stepCount === 0`, write a row with `decompose=true, override_source='timeout_observed', decider_version='observed-failure'`. The decider's cache-read short-circuits when it sees that override, bypassing the version check (so future `DECIDER_VERSION` bumps don't invalidate empirical observations). The router's existing cache-hit branch handles the rest transparently.

**Tech Stack:** TypeScript (strict), Prisma 5, PostgreSQL 16, vitest, pino logger, Docker Compose, Express + Vercel AI SDK.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/backend/prisma/migrations/20260519100000_add_override_source/migration.sql` | DDL: add `override_source` column + comment | **Create** |
| `packages/backend/prisma/schema.prisma` | Mirror new column on `DecompositionDecision` model | **Modify** |
| `packages/shared/src/trace-types.ts` | Add `"timeout_observed"` to `ComplexityTriggerReason` union | **Modify** |
| `packages/backend/src/services/decomposition-decision.service.ts` | `lookupCachedDecision` returns override info; new `markTimeoutObserved` helper; `decideDecomposition` short-circuits on override | **Modify** |
| `packages/backend/src/services/workbench-pipeline-persist.service.ts` | Call `markTimeoutObserved` inside `persistAbortedPipeline` when `stepCount === 0` | **Modify** |
| `packages/backend/src/__tests__/decomposition-decision.service.test.ts` | New tests for override read-path + `markTimeoutObserved` | **Modify** |
| `packages/backend/src/__tests__/workbench-pipeline-persist.test.ts` | New test for the timeout-hook in `persistAbortedPipeline` | **Create** |
| `docs/codegen-pipeline-and-workbench.md` | Add bullet to §3.4 about sticky timeout-observed decisions | **Modify** |
| `docs/codegen-harness-audit.md` | Add row to §2.8 cataloguing the harness intervention | **Modify** |

`packages/backend/src/services/routing.service.ts`: **no change needed.** The router calls `decideDecomposition`, which transparently returns the override-source cached result via the existing `live_decider_cached` (or new `timeout_observed`) trigger reason. The router catches errors and falls back, but on a cache hit it just returns the verdict.

---

## Task 1: Add `timeout_observed` to `ComplexityTriggerReason`

**Files:**
- Modify: `packages/shared/src/trace-types.ts:136-143`

- [x] **Step 1: Edit the union**

Open `packages/shared/src/trace-types.ts` and update the union:

```typescript
export type ComplexityTriggerReason =
  | "spec_llm_decision"
  | "multi_part_pattern"
  | "single_agent_default"
  | "spec_unavailable"
  | "forced_override"
  | "live_decider"
  | "live_decider_cached"
  | "timeout_observed";
```

Also update the comment block above the union (lines ~120-135) to add:

```typescript
 * - `timeout_observed`: a previous single-agent run for this (prompt, model)
 *   aborted on the pipeline timeout with zero tool calls. The harness wrote a
 *   sticky decompose=true row to the decision cache; this trigger reason
 *   surfaces that empirical short-circuit in traces.
```

(Insert immediately after the `live_decider_cached` comment line.)

- [x] **Step 2: Type-check the shared package**

Run:
```bash
NODE_OPTIONS="--max-old-space-size=6144" npx --prefix /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/shared tsc -p /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/shared/tsconfig.json --noEmit
```
Expected: exits 0 with no errors.

- [x] **Step 3: Commit**

```bash
git add packages/shared/src/trace-types.ts
git commit -m "Add timeout_observed to ComplexityTriggerReason

Sticky cached decompose verdicts set by the harness after a single-agent
timeout-abort with stepCount=0 surface this trigger reason in traces.
"
```

---

## Task 2: Database migration — `override_source` column

**Files:**
- Create: `packages/backend/prisma/migrations/20260519100000_add_override_source/migration.sql`

- [x] **Step 1: Create the migration directory + SQL file**

```bash
mkdir -p packages/backend/prisma/migrations/20260519100000_add_override_source
```

Write `packages/backend/prisma/migrations/20260519100000_add_override_source/migration.sql`:

```sql
-- Sticky empirical override for the decomposition decider cache.
-- NULL = normal LLM verdict; 'timeout_observed' = harness wrote this after a
-- single-agent pipeline timeout with stepCount=0 (clear over-reasoning hang).
-- Override rows survive DECIDER_VERSION bumps via the sentinel decider_version
-- 'observed-failure'.
ALTER TABLE "decomposition_decisions"
  ADD COLUMN "override_source" VARCHAR(32);

COMMENT ON COLUMN "decomposition_decisions"."override_source" IS
  'NULL = normal LLM decider verdict. timeout_observed = sticky decision set by the harness after a single-agent timeout-abort with stepCount=0.';

CREATE INDEX "idx_decomp_decisions_override_source"
  ON "decomposition_decisions"("override_source")
  WHERE "override_source" IS NOT NULL;
```

- [x] **Step 2: Apply the migration**

```bash
docker compose up -d postgres
docker compose exec -T backend npx prisma migrate deploy
```
Expected: `Applying migration 20260519100000_add_override_source ... done`.

- [x] **Step 3: Verify the column exists**

```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -c "\d decomposition_decisions"
```
Expected output contains the line `override_source | character varying(32) |  |  |` and `idx_decomp_decisions_override_source` index.

- [x] **Step 4: Commit**

```bash
git add packages/backend/prisma/migrations/20260519100000_add_override_source/
git commit -m "Add override_source column to decomposition_decisions

Sticky cache flag set by the harness after a single-agent timeout-abort
with stepCount=0. NULL = normal LLM verdict; 'timeout_observed' is the
first defined value.
"
```

---

## Task 3: Mirror the column in Prisma schema

**Files:**
- Modify: `packages/backend/prisma/schema.prisma:910-925`

- [x] **Step 1: Edit the model**

Update the `DecompositionDecision` model to add the new column after `reasoning`:

```prisma
model DecompositionDecision {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  promptId        String   @map("prompt_id") @db.Uuid
  modelId         String   @map("model_id") @db.Uuid
  deciderVersion  String   @map("decider_version") @db.VarChar(40)
  decompose       Boolean
  reasoning       String   @db.Text
  overrideSource  String?  @map("override_source") @db.VarChar(32)
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()

  prompt WorkbenchExamplePrompt @relation(fields: [promptId], references: [id], onDelete: Cascade, onUpdate: NoAction)
  model  LlmModel               @relation(fields: [modelId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@unique([promptId, modelId], map: "decomp_decisions_prompt_model_unique")
  @@index([deciderVersion], map: "idx_decomp_decisions_version")
  @@index([overrideSource], map: "idx_decomp_decisions_override_source")
  @@map("decomposition_decisions")
}
```

- [x] **Step 2: Regenerate the Prisma client**

```bash
docker compose exec -T backend npx prisma generate
```
Expected: `Generated Prisma Client (vX.Y.Z) to ./node_modules/@prisma/client ...`.

- [x] **Step 3: Type-check backend**

```bash
NODE_OPTIONS="--max-old-space-size=6144" npx --prefix /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend tsc -p /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend/tsconfig.json --noEmit
```
Expected: exits 0.

- [x] **Step 4: Commit**

```bash
git add packages/backend/prisma/schema.prisma
git commit -m "Mirror override_source column on Prisma DecompositionDecision model"
```

---

## Task 4: Extend `lookupCachedDecision` to expose override info (TDD)

**Files:**
- Test: `packages/backend/src/__tests__/decomposition-decision.service.test.ts`
- Modify: `packages/backend/src/services/decomposition-decision.service.ts:39-59`

The cache lookup currently returns `{ decompose, reasoning } | null` and treats version-mismatched rows as a miss. We extend it to also return `overrideSource` and to **bypass the version check** when `override_source` is set. Override rows are authoritative regardless of `decider_version`.

- [x] **Step 1: Write the failing test**

Add the following block inside `packages/backend/src/__tests__/decomposition-decision.service.test.ts`, immediately after the existing `parseDeciderResponse` describe block (before the `decideDecomposition` describe block):

```typescript
import { lookupCachedDecision } from "../services/decomposition-decision.service.js";
import { prisma } from "../db/prisma.js";

describe("lookupCachedDecision (override-aware)", () => {
  const PROMPT_ID = "11111111-1111-1111-1111-111111111111";
  const MODEL_ID = "22222222-2222-2222-2222-222222222222";

  beforeEach(async () => {
    await prisma.decompositionDecision.deleteMany({
      where: { promptId: PROMPT_ID, modelId: MODEL_ID },
    });
  });

  it("returns null when no row exists", async () => {
    const r = await lookupCachedDecision(PROMPT_ID, MODEL_ID);
    expect(r).toBeNull();
  });

  it("returns null when decider_version is stale AND no override is set", async () => {
    await prisma.decompositionDecision.create({
      data: {
        promptId: PROMPT_ID, modelId: MODEL_ID,
        deciderVersion: "v0.0.0-stale",
        decompose: true, reasoning: "stale",
      },
    });
    const r = await lookupCachedDecision(PROMPT_ID, MODEL_ID);
    expect(r).toBeNull();
  });

  it("returns the cached row when decider_version matches", async () => {
    // Use DECIDER_VERSION from the service to stay forward-compatible.
    const { DECIDER_VERSION } = await import("../services/decomposition-decision.service.js");
    await prisma.decompositionDecision.create({
      data: {
        promptId: PROMPT_ID, modelId: MODEL_ID,
        deciderVersion: DECIDER_VERSION,
        decompose: false, reasoning: "single",
      },
    });
    const r = await lookupCachedDecision(PROMPT_ID, MODEL_ID);
    expect(r).toEqual({ decompose: false, reasoning: "single", overrideSource: null });
  });

  it("returns the override row even when decider_version is the sentinel 'observed-failure'", async () => {
    await prisma.decompositionDecision.create({
      data: {
        promptId: PROMPT_ID, modelId: MODEL_ID,
        deciderVersion: "observed-failure",
        decompose: true,
        reasoning: "single-agent timed out previously with stepCount=0",
        overrideSource: "timeout_observed",
      },
    });
    const r = await lookupCachedDecision(PROMPT_ID, MODEL_ID);
    expect(r).toEqual({
      decompose: true,
      reasoning: "single-agent timed out previously with stepCount=0",
      overrideSource: "timeout_observed",
    });
  });
});
```

Note: this is an integration test that uses the real database. It assumes the test setup already cleans/seeds a workbench prompt and LLM model with the IDs above. **Before running, append these seed rows to the test prelude** (top of the file, before `describe`):

```typescript
import { prisma as testPrisma } from "../db/prisma.js";

beforeAll(async () => {
  await testPrisma.llmProvider.upsert({
    where: { name: "test-provider" },
    update: {},
    create: { name: "test-provider", displayName: "Test Provider", apiKey: "", endpointUrl: null },
  });
  await testPrisma.llmModel.upsert({
    where: { id: "22222222-2222-2222-2222-222222222222" },
    update: {},
    create: {
      id: "22222222-2222-2222-2222-222222222222",
      provider: "test-provider",
      modelName: "test-model",
      displayName: "Test Model",
      costPer1mInput: 0, costPer1mOutput: 0,
    },
  });
  await testPrisma.workbenchExamplePrompt.upsert({
    where: { id: "11111111-1111-1111-1111-111111111111" },
    update: {},
    create: {
      id: "11111111-1111-1111-1111-111111111111",
      prompt: "test prompt",
      category: 1,
    },
  });
});
```

If the `workbench_example_prompts` table has additional NOT NULL columns, inspect `packages/backend/prisma/schema.prisma` (search for `model WorkbenchExamplePrompt`) and add minimal placeholder values to the `create` block.

- [x] **Step 2: Run the test to verify it fails**

```bash
cd packages/backend && npx vitest run src/__tests__/decomposition-decision.service.test.ts -t "lookupCachedDecision"
```
Expected failure modes (any of):
- `overrideSource: null` assertion fails because the current return type omits the field.
- The fourth test fails because the current implementation returns `null` for stale `decider_version`, ignoring `override_source`.

- [x] **Step 3: Update `CachedDecision` return type and `lookupCachedDecision` logic**

In `packages/backend/src/services/decomposition-decision.service.ts`, replace lines 39-59 with:

```typescript
export interface CachedDecision {
  decompose: boolean;
  reasoning: string;
  /**
   * NULL for normal LLM-verdict rows; 'timeout_observed' for sticky override
   * rows written by the harness after a single-agent timeout-abort with
   * stepCount=0. Override rows bypass the DECIDER_VERSION check.
   */
  overrideSource: string | null;
}

/**
 * Return the cached decision iff:
 *   (a) a row exists with `override_source` set (override rows are
 *       authoritative regardless of decider_version), OR
 *   (b) a row exists AND its decider_version matches the current
 *       DECIDER_VERSION.
 * Stale rows without an override are treated as a miss (caller recomputes,
 * then overwrites via ON CONFLICT in upsertDecision).
 */
export async function lookupCachedDecision(
  promptId: string,
  modelId: string,
): Promise<CachedDecision | null> {
  const row = await prisma.decompositionDecision.findUnique({
    where: { promptId_modelId: { promptId, modelId } },
  });
  if (!row) return null;
  if (row.overrideSource === null && row.deciderVersion !== DECIDER_VERSION) return null;
  return {
    decompose: row.decompose,
    reasoning: row.reasoning,
    overrideSource: row.overrideSource,
  };
}
```

- [x] **Step 4: Re-run the test to verify it passes**

```bash
cd packages/backend && npx vitest run src/__tests__/decomposition-decision.service.test.ts -t "lookupCachedDecision"
```
Expected: 4 passed.

- [x] **Step 5: Commit**

```bash
git add packages/backend/src/services/decomposition-decision.service.ts packages/backend/src/__tests__/decomposition-decision.service.test.ts
git commit -m "Make lookupCachedDecision aware of override_source

Override rows (override_source != NULL) bypass the DECIDER_VERSION check
so empirical timeout-observed decisions persist across prompt-tuning
bumps of the live decider.
"
```

---

## Task 5: Add `markTimeoutObserved` helper (TDD)

**Files:**
- Test: `packages/backend/src/__tests__/decomposition-decision.service.test.ts`
- Modify: `packages/backend/src/services/decomposition-decision.service.ts` (add after `upsertDecision`)

- [x] **Step 1: Write the failing test**

Append to `packages/backend/src/__tests__/decomposition-decision.service.test.ts`:

```typescript
import { markTimeoutObserved } from "../services/decomposition-decision.service.js";

describe("markTimeoutObserved", () => {
  const PROMPT_ID = "11111111-1111-1111-1111-111111111111";
  const MODEL_ID = "22222222-2222-2222-2222-222222222222";

  beforeEach(async () => {
    await prisma.decompositionDecision.deleteMany({
      where: { promptId: PROMPT_ID, modelId: MODEL_ID },
    });
  });

  it("creates a new row with decompose=true, override_source='timeout_observed', decider_version='observed-failure'", async () => {
    await markTimeoutObserved(PROMPT_ID, MODEL_ID);
    const row = await prisma.decompositionDecision.findUnique({
      where: { promptId_modelId: { promptId: PROMPT_ID, modelId: MODEL_ID } },
    });
    expect(row).not.toBeNull();
    expect(row!.decompose).toBe(true);
    expect(row!.overrideSource).toBe("timeout_observed");
    expect(row!.deciderVersion).toBe("observed-failure");
    expect(row!.reasoning).toMatch(/single-agent.*timeout/i);
  });

  it("upgrades an existing decompose=false row to an override (idempotent on repeat calls)", async () => {
    // Pre-populate with a normal LLM verdict that said decompose=false
    const { DECIDER_VERSION } = await import("../services/decomposition-decision.service.js");
    await prisma.decompositionDecision.create({
      data: {
        promptId: PROMPT_ID, modelId: MODEL_ID,
        deciderVersion: DECIDER_VERSION,
        decompose: false, reasoning: "decider said single",
      },
    });

    await markTimeoutObserved(PROMPT_ID, MODEL_ID);

    const row = await prisma.decompositionDecision.findUnique({
      where: { promptId_modelId: { promptId: PROMPT_ID, modelId: MODEL_ID } },
    });
    expect(row!.decompose).toBe(true);
    expect(row!.overrideSource).toBe("timeout_observed");
    expect(row!.deciderVersion).toBe("observed-failure");

    // Second call must not throw and must leave the row unchanged
    await markTimeoutObserved(PROMPT_ID, MODEL_ID);
    const row2 = await prisma.decompositionDecision.findUnique({
      where: { promptId_modelId: { promptId: PROMPT_ID, modelId: MODEL_ID } },
    });
    expect(row2!.overrideSource).toBe("timeout_observed");
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
cd packages/backend && npx vitest run src/__tests__/decomposition-decision.service.test.ts -t "markTimeoutObserved"
```
Expected: import fails or `markTimeoutObserved is not a function`.

- [x] **Step 3: Implement `markTimeoutObserved`**

Append after `upsertDecision` (after line 92 of `decomposition-decision.service.ts`):

```typescript
/**
 * Sentinel decider_version for empirical timeout-observed overrides.
 * Lookups treat any row with `override_source != null` as version-independent,
 * but persisting a recognizable sentinel makes ad-hoc DB inspection clearer.
 */
const TIMEOUT_OBSERVED_VERSION = "observed-failure";
const TIMEOUT_OBSERVED_REASONING =
  "Single-agent pipeline previously aborted on timeout with stepCount=0 (over-reasoning hang). Sticky override → multi-agent.";

/**
 * Mark a (prompt, model) pair as "single-agent timed out with no progress".
 * Future routing for this pair will short-circuit to multi-agent via the
 * `timeout_observed` trigger reason, even after `DECIDER_VERSION` bumps.
 *
 * Idempotent: re-marking is a no-op upsert.
 *
 * Errors are logged but do not throw — the calling persist path is already
 * on an abort code path and we must not mask the original failure.
 */
export async function markTimeoutObserved(
  promptId: string,
  modelId: string,
): Promise<void> {
  try {
    await prisma.decompositionDecision.upsert({
      where: { promptId_modelId: { promptId, modelId } },
      create: {
        promptId,
        modelId,
        deciderVersion: TIMEOUT_OBSERVED_VERSION,
        decompose: true,
        reasoning: TIMEOUT_OBSERVED_REASONING,
        overrideSource: "timeout_observed",
      },
      update: {
        deciderVersion: TIMEOUT_OBSERVED_VERSION,
        decompose: true,
        reasoning: TIMEOUT_OBSERVED_REASONING,
        overrideSource: "timeout_observed",
      },
    });
    logger.info(
      { promptId, modelId },
      "marked (prompt, model) as timeout_observed — future routing pinned to multi-agent",
    );
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), promptId, modelId },
      "failed to mark timeout_observed — continuing",
    );
  }
}
```

- [x] **Step 4: Re-run the test to verify it passes**

```bash
cd packages/backend && npx vitest run src/__tests__/decomposition-decision.service.test.ts -t "markTimeoutObserved"
```
Expected: 2 passed.

- [x] **Step 5: Commit**

```bash
git add packages/backend/src/services/decomposition-decision.service.ts packages/backend/src/__tests__/decomposition-decision.service.test.ts
git commit -m "Add markTimeoutObserved helper

Idempotent upsert that writes a sticky decompose=true cache row with
override_source='timeout_observed' and decider_version='observed-failure'.
Errors are logged but do not throw — the helper is called from the
pipeline-abort path and must not mask the original failure.
"
```

---

## Task 6: Surface `timeout_observed` as a trigger reason (TDD)

**Files:**
- Test: `packages/backend/src/__tests__/decomposition-decision.service.test.ts`
- Modify: `packages/backend/src/services/decomposition-decision.service.ts:204-209, 238-303`

`decideDecomposition` currently maps cache hits to `triggerReason: "live_decider_cached"`. We want override-source hits to surface as `"timeout_observed"` instead, so traces correctly attribute the routing decision.

- [x] **Step 1: Write the failing test**

Append to `packages/backend/src/__tests__/decomposition-decision.service.test.ts` inside the existing `decideDecomposition` describe block (look for it near the bottom of the file). If a top-level describe doesn't exist yet, add this block:

```typescript
import { decideDecomposition } from "../services/decomposition-decision.service.js";

describe("decideDecomposition trigger reason for override rows", () => {
  const PROMPT_ID = "11111111-1111-1111-1111-111111111111";
  const MODEL_ID = "22222222-2222-2222-2222-222222222222";

  beforeEach(async () => {
    await prisma.decompositionDecision.deleteMany({
      where: { promptId: PROMPT_ID, modelId: MODEL_ID },
    });
  });

  it("returns triggerReason='timeout_observed' when the cache row has override_source='timeout_observed'", async () => {
    await prisma.decompositionDecision.create({
      data: {
        promptId: PROMPT_ID, modelId: MODEL_ID,
        deciderVersion: "observed-failure",
        decompose: true,
        reasoning: "previous timeout",
        overrideSource: "timeout_observed",
      },
    });
    const r = await decideDecomposition({
      promptId: PROMPT_ID,
      promptText: "irrelevant — should be cache-served",
      modelId: MODEL_ID,
      modelTier: "small",
    });
    expect(r.decompose).toBe(true);
    expect(r.triggerReason).toBe("timeout_observed");
    expect(r.reasoning).toBe("previous timeout");
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
cd packages/backend && npx vitest run src/__tests__/decomposition-decision.service.test.ts -t "trigger reason for override rows"
```
Expected failure: `triggerReason` is `"live_decider_cached"`, not `"timeout_observed"`.

- [x] **Step 3: Update `DecomposeDecisionResult` type and `decideDecomposition` cache branch**

In `packages/backend/src/services/decomposition-decision.service.ts`, change the result type (lines 204-209) from:

```typescript
export interface DecomposeDecisionResult {
  decompose: boolean;
  reasoning: string;
  triggerReason: "live_decider" | "live_decider_cached";
  deciderVersion: string;
}
```

to:

```typescript
export interface DecomposeDecisionResult {
  decompose: boolean;
  reasoning: string;
  triggerReason: "live_decider" | "live_decider_cached" | "timeout_observed";
  deciderVersion: string;
}
```

Then update the cache-hit branch inside `decideDecomposition` (around line 242-254):

```typescript
  if (input.promptId) {
    const cached = await lookupCachedDecision(input.promptId, input.modelId);
    if (cached) {
      const triggerReason: DecomposeDecisionResult["triggerReason"] =
        cached.overrideSource === "timeout_observed"
          ? "timeout_observed"
          : "live_decider_cached";
      logger.debug(
        {
          promptId: input.promptId,
          modelId: input.modelId,
          decompose: cached.decompose,
          triggerReason,
        },
        "decomposition decision cache hit",
      );
      return {
        decompose: cached.decompose,
        reasoning: cached.reasoning,
        triggerReason,
        deciderVersion: DECIDER_VERSION,
      };
    }
  }
```

- [x] **Step 4: Update `routing.service.ts` and `trace-builder.service.ts` for the new union member**

Run:
```bash
grep -rn "live_decider_cached\|live_decider\b" packages/backend/src --include="*.ts" | grep -v test
```
Expected: no untyped string narrowings on the trigger reason. If TypeScript surfaces errors after Task 6 step 3 (because `routing.service.ts` or `trace-builder.service.ts` declares stricter unions), widen them to include `"timeout_observed"` the same way.

Verify:
```bash
NODE_OPTIONS="--max-old-space-size=6144" npx --prefix /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend tsc -p /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend/tsconfig.json --noEmit
```
Expected: exits 0.

- [x] **Step 5: Re-run the test to verify it passes**

```bash
cd packages/backend && npx vitest run src/__tests__/decomposition-decision.service.test.ts -t "trigger reason for override rows"
```
Expected: 1 passed.

- [x] **Step 6: Commit**

```bash
git add packages/backend/src/services/decomposition-decision.service.ts packages/backend/src/__tests__/decomposition-decision.service.test.ts packages/backend/src/services/routing.service.ts packages/backend/src/services/trace-builder.service.ts
git commit -m "Surface timeout_observed as a distinct trigger reason

Cache hits with override_source='timeout_observed' now map to
triggerReason='timeout_observed' instead of 'live_decider_cached',
so traces correctly attribute these decisions to the harness override
path rather than a normal cached LLM verdict.
"
```

---

## Task 7: Wire the timeout hook in `persistAbortedPipeline` (TDD)

**Files:**
- Create: `packages/backend/src/__tests__/workbench-pipeline-persist.test.ts`
- Modify: `packages/backend/src/services/workbench-pipeline-persist.service.ts:27-52`

When the pipeline aborts AND `stepCount === 0` AND `promptId` is present (workbench path, not chat), call `markTimeoutObserved`. The hook lives inside `persistAbortedPipeline` so every aborted-pipeline call site benefits without further changes.

- [x] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/workbench-pipeline-persist.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { prisma } from "../db/prisma.js";

const PROMPT_ID = "33333333-3333-3333-3333-333333333333";
const MODEL_ID = "44444444-4444-4444-4444-444444444444";

beforeAll(async () => {
  await prisma.llmProvider.upsert({
    where: { name: "test-provider" },
    update: {},
    create: { name: "test-provider", displayName: "Test Provider", apiKey: "", endpointUrl: null },
  });
  await prisma.llmModel.upsert({
    where: { id: MODEL_ID },
    update: {},
    create: {
      id: MODEL_ID,
      provider: "test-provider",
      modelName: "test-codegen-model",
      displayName: "Test Codegen Model",
      costPer1mInput: 0, costPer1mOutput: 0,
    },
  });
  await prisma.workbenchExamplePrompt.upsert({
    where: { id: PROMPT_ID },
    update: {},
    create: { id: PROMPT_ID, prompt: "test prompt", category: 1 },
  });
});

beforeEach(async () => {
  await prisma.decompositionDecision.deleteMany({
    where: { promptId: PROMPT_ID, modelId: MODEL_ID },
  });
  await prisma.workbenchExample.deleteMany({ where: { promptId: PROMPT_ID } });
});

// Build the minimum-viable inputs persistAbortedPipeline needs.
function makeArgs(stepCount: number) {
  const ctx = { promptId: PROMPT_ID, prompt: "test", categoryName: "test", complexity: "simple" } as never;
  const agResult = {
    stepCount,
    files: [],
    code: "# aborted",
    usage: { promptTokens: 0, completionTokens: 0 },
  } as never;
  const modelConfig = { id: MODEL_ID, label: "test-model" } as never;
  // Minimal TraceBuilder stub
  const traceBuilder = {
    endPhase: vi.fn(),
    build: () => ({}),
    computeSummary: () => ({}),
    snapshot: () => ({}),
  } as never;
  return { ctx, agResult, modelConfig, traceBuilder, traceId: null };
}

describe("persistAbortedPipeline → markTimeoutObserved hook", () => {
  it("writes a timeout_observed override when stepCount === 0", async () => {
    const { persistAbortedPipeline } = await import("../services/workbench-pipeline-persist.service.js");
    const { ctx, agResult, modelConfig, traceBuilder, traceId } = makeArgs(0);
    await persistAbortedPipeline(ctx, agResult, modelConfig, traceBuilder, traceId);

    const row = await prisma.decompositionDecision.findUnique({
      where: { promptId_modelId: { promptId: PROMPT_ID, modelId: MODEL_ID } },
    });
    expect(row).not.toBeNull();
    expect(row!.overrideSource).toBe("timeout_observed");
    expect(row!.decompose).toBe(true);
  });

  it("does NOT write an override when stepCount > 0 (model made progress before timing out)", async () => {
    const { persistAbortedPipeline } = await import("../services/workbench-pipeline-persist.service.js");
    const { ctx, agResult, modelConfig, traceBuilder, traceId } = makeArgs(3);
    await persistAbortedPipeline(ctx, agResult, modelConfig, traceBuilder, traceId);

    const row = await prisma.decompositionDecision.findUnique({
      where: { promptId_modelId: { promptId: PROMPT_ID, modelId: MODEL_ID } },
    });
    expect(row).toBeNull();
  });

  it("does NOT write an override when promptId is missing (chat path)", async () => {
    const { persistAbortedPipeline } = await import("../services/workbench-pipeline-persist.service.js");
    const { agResult, modelConfig, traceBuilder, traceId } = makeArgs(0);
    const chatCtx = { promptId: null, prompt: "test", categoryName: null, complexity: "simple" } as never;
    await persistAbortedPipeline(chatCtx, agResult, modelConfig, traceBuilder, traceId);

    // No row should have been written for null prompt
    const count = await prisma.decompositionDecision.count({
      where: { modelId: MODEL_ID, overrideSource: "timeout_observed" },
    });
    expect(count).toBe(0);
  });
});
```

If `insertExample` (called inside `persistAbortedPipeline`) requires additional fields the test setup doesn't satisfy, also mock it via:

```typescript
vi.mock("./workbench-pipeline-helpers.service.js", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, insertExample: vi.fn().mockResolvedValue(undefined) };
});
```

(Place the mock at the top of the test file, after imports.)

- [x] **Step 2: Run the test to verify it fails**

```bash
cd packages/backend && npx vitest run src/__tests__/workbench-pipeline-persist.test.ts
```
Expected: 3 failed (the override row is never written because the hook doesn't exist yet).

- [x] **Step 3: Add the hook**

In `packages/backend/src/services/workbench-pipeline-persist.service.ts`, modify `persistAbortedPipeline` (lines 27-52). Add the import at the top of the file:

```typescript
import { markTimeoutObserved } from "./decomposition-decision.service.js";
```

Then modify the function body (insert the hook block immediately after the existing `logger.info(...)` call on line 35):

```typescript
export async function persistAbortedPipeline(
  ctx: PromptContext,
  agResult: Awaited<ReturnType<typeof runAgentCodegen>>,
  modelConfig: LlmModelConfig,
  traceBuilder: TraceBuilder,
  traceId: string | null,
  experimentRunId?: string,
): Promise<GenerateResult> {
  logger.info({ promptId: ctx.promptId, stepCount: agResult.stepCount }, "pipeline aborted — skipping screenshots/eval");

  // Failure-aware retro-routing: a single-agent run that aborted on timeout
  // with zero tool calls is a clear over-reasoning hang. Pin future routing
  // for this (prompt, model) pair to multi-agent so the next run doesn't
  // repeat the same dead end. Only fires on the workbench path (promptId set).
  if (ctx.promptId && agResult.stepCount === 0) {
    await markTimeoutObserved(ctx.promptId, modelConfig.id);
  }

  const exampleId = crypto.randomUUID();
  // ... rest of function unchanged ...
```

- [x] **Step 4: Re-run the test to verify it passes**

```bash
cd packages/backend && npx vitest run src/__tests__/workbench-pipeline-persist.test.ts
```
Expected: 3 passed.

- [x] **Step 5: Run the full backend test suite**

```bash
cd packages/backend && npx vitest run
```
Expected: all passing, no regressions.

- [x] **Step 6: Commit**

```bash
git add packages/backend/src/services/workbench-pipeline-persist.service.ts packages/backend/src/__tests__/workbench-pipeline-persist.test.ts
git commit -m "Hook markTimeoutObserved into persistAbortedPipeline

When a single-agent pipeline aborts on timeout with stepCount=0 (clear
over-reasoning hang), write a sticky decompose=true override to the
decomposition_decisions cache so the next run for that (prompt, model)
pair routes to multi-agent automatically.

Gated on ctx.promptId (workbench-only; chat path is skipped) and
stepCount === 0 (model that made tool calls and timed out is a different
failure class — not retro-routed).
"
```

---

## Task 8: Update documentation

**Files:**
- Modify: `docs/codegen-pipeline-and-workbench.md` §3.4 (around line 130-150)
- Modify: `docs/codegen-harness-audit.md` §2.8

- [x] **Step 1: Add bullet to pipeline doc §3.4**

In `docs/codegen-pipeline-and-workbench.md`, find the numbered routing precedence list inside §3.4 (around lines 134-138). The list currently reads:

```
1. **Per-run override** (`experiment_runs.routing_override` ∈ `auto | force_decompose | force_single`) — bypasses everything when set to `force_*`.
2. **Multi-part regex** (`MULTI_PART_PATTERN` in `spec-generation.service.ts`) — cheap deterministic safety net for prompts containing "snap-fit", "hinged lid", "clamshell", etc.
3. **Live decomposition decider** (`decomposition-decision.service.ts`) — one LLM call per generation, model-tier-aware, results cached in `decomposition_decisions` keyed by `(prompt_id, model_id)` with a `decider_version` stamp. Bumping `DECIDER_VERSION` (in code) auto-invalidates all cached rows.
4. **Fallback** when the decider errors — single-agent with trigger `spec_unavailable`.
```

Insert a new bullet between #2 and #3, and renumber:

```
1. **Per-run override** (`experiment_runs.routing_override` ∈ `auto | force_decompose | force_single`) — bypasses everything when set to `force_*`.
2. **Multi-part regex** (`MULTI_PART_PATTERN` in `spec-generation.service.ts`) — cheap deterministic safety net for prompts containing "snap-fit", "hinged lid", "clamshell", etc.
3. **Timeout-observed override** (`decomposition_decisions.override_source = 'timeout_observed'`) — sticky empirical decision: a previous single-agent run for this `(prompt_id, model_id)` aborted on the pipeline timeout with `stepCount=0`. Future runs route directly to multi-agent without consulting the live decider. Survives `DECIDER_VERSION` bumps (sentinel `decider_version = 'observed-failure'`). Trigger reason: `timeout_observed`. Set inside `persistAbortedPipeline` (`workbench-pipeline-persist.service.ts`).
4. **Live decomposition decider** (`decomposition-decision.service.ts`) — one LLM call per generation, model-tier-aware, results cached in `decomposition_decisions` keyed by `(prompt_id, model_id)` with a `decider_version` stamp. Bumping `DECIDER_VERSION` (in code) auto-invalidates all NON-override cached rows.
5. **Fallback** when the decider errors — single-agent with trigger `spec_unavailable`.
```

Also update the `complexityTriggerReason` enum list later in §3.4. Find the line beginning `The routing reason is persisted on the trace's top-level field` (around line ~146). Add `timeout_observed,` to the union list inside the curly braces.

- [x] **Step 2: Add row to harness-audit §2.8**

In `docs/codegen-harness-audit.md`, find the §2.8 "Multi-Agent Decomposition Gate" table (search for the heading). Append this row to the failure-mode table inside §2.8:

```
| 8.X | Single-agent over-reasoning hang: trained model emits thinking tokens for the full pipeline timeout without ever calling a tool. Wastes 30 min per occurrence. | S1 | `generation_traces` with `complexityTriggerReason ∈ {live_decider, live_decider_cached, single_agent_default}`, `renderStatus='error'`, `renderError='Pipeline aborted...'`, `stepCount=0` | no | Failure-aware retro-routing: write `override_source='timeout_observed'` to `decomposition_decisions` so the next run for that (prompt, model) routes to multi-agent. Implemented in `persistAbortedPipeline` (workbench-pipeline-persist.service.ts). |
```

Renumber `8.X` to the next available number in that table.

- [x] **Step 3: Commit**

```bash
git add docs/codegen-pipeline-and-workbench.md docs/codegen-harness-audit.md
git commit -m "Document failure-aware retro-routing in pipeline + harness-audit docs

Pipeline §3.4: insert timeout_observed override between multi-part regex
and live decider in the precedence list; renumber. Note that override
rows survive DECIDER_VERSION bumps.

Harness-audit §2.8: catalogue the single-agent over-reasoning hang
failure mode and reference the new harness intervention.
"
```

---

## Task 9: Verification

- [x] **Step 1: Rebuild and restart the backend**

```bash
docker compose build backend && docker compose up -d backend
```
Expected: backend image rebuilds, container restarts healthy.

- [x] **Step 2: Smoke test the cache short-circuit**

Pick a workbench prompt UUID and a model UUID known to be configured. Insert a synthetic override directly:

```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
INSERT INTO decomposition_decisions (prompt_id, model_id, decider_version, decompose, reasoning, override_source)
VALUES (
  '<PROMPT_UUID>',
  '<MODEL_UUID>',
  'observed-failure',
  true,
  'manual smoke test',
  'timeout_observed'
);
"
```

Trigger a generation for that `(prompt, model)` pair via the workbench API. In the backend logs you should see:

```
{"module":"decomp-decider","msg":"decomposition decision cache hit","decompose":true,"triggerReason":"timeout_observed"}
{"module":"workbench","msg":"multi-agent routing decision","useMultiAgent":true,"triggerReason":"timeout_observed"}
```

You should NOT see `"calling decomposition decider"` for that prompt — confirming the live LLM call was skipped.

After confirming, clean up:

```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
DELETE FROM decomposition_decisions
WHERE prompt_id = '<PROMPT_UUID>' AND model_id = '<MODEL_UUID>' AND override_source = 'timeout_observed';
"
```

- [x] **Step 3: Type-check the full backend**

```bash
NODE_OPTIONS="--max-old-space-size=6144" npx --prefix /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend tsc -p /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend/tsconfig.json --noEmit
```
Expected: exits 0.

- [x] **Step 4: Run the full backend test suite**

```bash
cd packages/backend && npx vitest run
```
Expected: all passing.

- [x] **Step 5: Final commit (if any leftover doc/code tweaks)**

```bash
git status
# If clean: nothing to commit. Otherwise:
git add -A
git commit -m "Verification cleanup for failure-aware retro-routing"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Trigger condition (`stepCount === 0`): Task 7 step 3 guards with `agResult.stepCount === 0`.
- ✅ Stickiness forever: Task 5 step 3 uses `TIMEOUT_OBSERVED_VERSION = "observed-failure"`; Task 4 step 3 makes `lookupCachedDecision` bypass version check when `overrideSource !== null`.
- ✅ DB column with comment: Task 2 step 1 SQL includes `COMMENT ON COLUMN`.
- ✅ Routing precedence doc bullet: Task 8 step 1 inserts the new bullet between multi-part regex and live decider.
- ✅ `timeout_observed` trigger reason: Task 1 (shared union), Task 6 (service emits it on override hits), Task 8 (docs reference it).
- ✅ Verification: Task 9 covers type-check, tests, Docker rebuild, smoke test for cache short-circuit.

**2. Placeholder scan:** No "TBD", "later", "Similar to Task N". All code blocks shown. SQL has real DDL. Exact commands with expected output.

**3. Type consistency:**
- `CachedDecision.overrideSource: string | null` (Task 4) matches the Prisma column `overrideSource: String?` (Task 3) and matches the test assertions (Tasks 4, 5).
- `DecomposeDecisionResult.triggerReason` (Task 6) union widened to include `"timeout_observed"` matches the shared union (Task 1) and the doc enum list (Task 8).
- `markTimeoutObserved(promptId: string, modelId: string): Promise<void>` (Task 5) matches the call site in Task 7 step 3.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-failure-aware-retro-routing.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task with two-stage review (spec compliance + code quality) between each. Fastest path; you stay out of the loop until completion.

**2. Inline Execution** — Step through the tasks in this session with checkpoints. Slower but you see every edit.

Which approach?
