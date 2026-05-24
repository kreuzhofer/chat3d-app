# Multi-Agent Routing Redesign — Implementation Plan

> **Status:** Code shipped 2026-05-19. Commits `c7f1663` → `7180379` (Tasks 1–12 + 15, 82 checkboxes flipped retroactively 2026-05-23).
>
> **2026-05-23 amendment — `small` tier retired.** Verifying against the live DB exposed that the SMALL branch was unused (no rows tagged) and the naming was misleading (a 27B fine-tune isn't "small" in any industry sense). Behavioural signal moved to the `timeout_observed` retro-routing override — see `2026-05-19-failure-aware-retro-routing.md`. `ModelTier` is now `frontier | mid` only; `DECIDER_VERSION` bumped to `v1.1.0`; 161 cached `v1.0.0` decisions will re-decide on next call (~$0.16 in Haiku cost). The §13.2 tier table for sub-mid models is now obsolete — leave such models as `mid` (or unset, which the decider treats as `mid`).
>
> **Runtime config status:**
> - Task 13.1 ✓ `decomposition_decision` purpose → `claude-haiku-4-5` on bedrock.
> - Task 13.2 ✓ Tiers set on all 19 models with the simplified two-tier system. 4 `frontier`, 15 `mid`, 2 unset (treated as `mid`).
> - Task 14 ✗ **Not done.** Five historical `auto` runs on experiment `d8ac9bae`; the one `:ma` run was cancelled before the redesign was fully shipped. The three `routing_override` sweeps (`auto` / `force_decompose` / `force_single`) on the `:ma` model are still pending — they remain the way to prove the redesign actually lifts scores on a weak fine-tune.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple the multi-agent routing decision from the cached spec data — a new live `decideDecomposition()` service (with its own version-stamped cache) replaces the read of `requires_decomposition` at routing time, and a per-run override on `experiment_runs` enables A/B testing decompose-vs-not on the same prompt set.

**Architecture:** Three layers — (1) the existing spec cache stays as-is (kept as training-data record); (2) a new `decomposition-decision.service.ts` makes a live LLM call (model-tier-aware system prompt) at every generation; (3) a new `decomposition_decisions` table caches results keyed by `(prompt_id, model_id)` with a `decider_version` stamp that auto-invalidates when the system prompt is bumped. Workbench (`workbench-codegen.service.ts`) and chat (`query.service.ts`) call into a single unified router so the logic is shared. A new `routing_override` enum column on `experiment_runs` (`auto | force_decompose | force_single`) short-circuits the decider for ablation runs.

**Tech Stack:** TypeScript (strict mode), Prisma 6 + PostgreSQL 16, vitest, Vercel AI SDK (`trackedGenerateText` wrapper), pino logger, React 18 + semantic-ui-react admin UI. Conventions per `CLAUDE.md`: TDD, no `console.*` in backend (use `createLogger("tag")`), keep files ≤ 400 lines, mandatory Docker rebuild after backend changes (`docker compose build backend && docker compose up -d backend`).

**Source spec:** `docs/superpowers/specs/2026-05-18-multi-agent-routing-redesign-design.md`

---

## File Structure

| File | Action | Lines | Responsibility |
|---|---|---|---|
| `packages/shared/src/trace-types.ts` | Modify | +5 | Add `ModelTier`, `RoutingOverride` types; extend `ComplexityTriggerReason` with `live_decider` + `live_decider_cached` |
| `packages/backend/prisma/migrations/20260519000000_routing_decider/migration.sql` | Create | ~25 | Add `llm_models.tier`, `experiment_runs.routing_override`, create `decomposition_decisions` table |
| `packages/backend/prisma/schema.prisma` | Modify | +12 | Mirror migration: `tier` on `LlmModel`, `routingOverride` on `ExperimentRun`, new `DecompositionDecision` model |
| `packages/backend/src/services/decomposition-decision.service.ts` | Create | ~180 | New service: `decideDecomposition()` with version-stamped cache + LLM call |
| `packages/backend/src/services/usage-tracking.service.ts` | Modify | +1 | Add `"decomposition_decision"` to the `LlmPurpose` literal-union |
| `packages/backend/src/services/routing.service.ts` | Create | ~120 | New unified router: `routeGeneration()` consumed by workbench + chat |
| `packages/backend/src/services/workbench-codegen.service.ts` | Modify | ~15 lines replaced at L442–462 | Replace inline routing block with call to `routeGeneration()` |
| `packages/backend/src/services/query.service.ts` | Modify | ~15 lines replaced at L1442–1471 | Same — replace chat-side inline routing with `routeGeneration()` |
| `packages/backend/src/services/spec-generation.service.ts` | Modify | +1 export | Export `MULTI_PART_PATTERN` for router to consume |
| `packages/backend/src/__tests__/decomposition-decision.service.test.ts` | Create | ~140 | Unit tests for cache hit/miss/version-mismatch/error |
| `packages/backend/src/__tests__/routing.service.test.ts` | Create | ~110 | Unit tests for override/regex/decider/fallback flows |
| `packages/backend/src/routes/admin/llm-models.routes.ts` | Modify | +5 | Accept `tier` in PATCH/POST body, return in GET |
| `packages/backend/src/routes/admin/experiments.routes.ts` | Modify | +3 | Accept `routingOverride` per-run in experiment create/edit |
| `packages/frontend/src/api/admin.api.ts` | Modify | +2 | Add `tier` to `LlmModelRow` + `CreateLlmModelInput` |
| `packages/frontend/src/components/admin/ModelsTab.tsx` | Modify | +1 cell | New `tier` dropdown column on the models table |
| `packages/frontend/src/api/experiments.api.ts` | Modify | +2 | Add `routingOverride` to per-run shape |
| `packages/frontend/src/components/admin/ExperimentsTab.tsx` (or whichever file holds the create/edit form) | Modify | +1 control | Per-run dropdown for `routingOverride` |
| `docs/codegen-pipeline-and-workbench.md` | Modify | +20 lines | Document new routing flow in §3.4 |

Migration is additive; no destructive changes to existing rows. The deprecated `workbench_example_prompts.requires_decomposition` column stays as a training-data record (per the spec §7.4) — `workbench-backfill-specs.service.ts` continues to write it, but no routing code reads it.

---

## Task 1: Shared types — `ModelTier`, `RoutingOverride`, extended `ComplexityTriggerReason`

**Files:**
- Modify: `packages/shared/src/trace-types.ts`

- [x] **Step 1: Locate the existing type block**

Run: `grep -n "ComplexityTriggerReason\|TracePipelineType" packages/shared/src/trace-types.ts`
Expected: shows `ComplexityTriggerReason` declared at line 133, `TracePipelineType` nearby.

- [x] **Step 2: Extend the literal-union types**

Edit `packages/shared/src/trace-types.ts`. Find the `ComplexityTriggerReason` declaration (around line 133) and:

a) Append the two new values to the literal-union:

```ts
export type ComplexityTriggerReason =
  | "spec_llm_decision"      // DEPRECATED — kept for old trace compatibility
  | "multi_part_pattern"
  | "single_agent_default"
  | "spec_unavailable"
  | "forced_override"
  | "live_decider"           // NEW — live LLM call, not cached
  | "live_decider_cached";   // NEW — live LLM call result reused from cache
```

b) Immediately below the `ComplexityTriggerReason` declaration, add:

```ts
/**
 * Model capability tier consumed by the decomposition decider's system
 * prompt to set decompose thresholds. `null`/unset → treated as `mid`.
 */
export type ModelTier = "frontier" | "mid" | "small";

/**
 * Per-run override of the live decomposition decider.
 *  - `auto`: use the live decider
 *  - `force_decompose`: route to multi-agent regardless of decider verdict
 *  - `force_single`: route to single-agent regardless of decider verdict
 */
export type RoutingOverride = "auto" | "force_decompose" | "force_single";
```

- [x] **Step 3: Build the shared package**

Run: `cd packages/shared && npx tsc -p tsconfig.json`
Expected: exit 0, no errors.

- [x] **Step 4: Commit**

```bash
git add packages/shared/src/trace-types.ts
git commit -m "shared: add ModelTier, RoutingOverride; extend ComplexityTriggerReason with live_decider values"
```

---

## Task 2: Database migration

**Files:**
- Create: `packages/backend/prisma/migrations/20260519000000_routing_decider/migration.sql`

- [x] **Step 1: Create the migration directory and file**

```bash
mkdir -p packages/backend/prisma/migrations/20260519000000_routing_decider
```

Create `packages/backend/prisma/migrations/20260519000000_routing_decider/migration.sql` with:

```sql
-- Add model tier to llm_models (admin-set; null = treat as 'mid')
ALTER TABLE "llm_models"
  ADD COLUMN "tier" VARCHAR(20);
COMMENT ON COLUMN "llm_models"."tier" IS
  'Model capability tier (frontier|mid|small) used by the decomposition decider to set decompose thresholds.';

-- Add per-run routing override to experiment_runs
ALTER TABLE "experiment_runs"
  ADD COLUMN "routing_override" VARCHAR(20) NOT NULL DEFAULT 'auto';
COMMENT ON COLUMN "experiment_runs"."routing_override" IS
  'Per-run override of the live decomposition decider; auto = use decider, force_decompose/force_single bypass it.';

-- Decision cache, version-stamped so bumping the decider system prompt auto-invalidates rows.
CREATE TABLE "decomposition_decisions" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "prompt_id"        UUID NOT NULL REFERENCES "workbench_example_prompts"("id") ON DELETE CASCADE,
  "model_id"         UUID NOT NULL REFERENCES "llm_models"("id") ON DELETE CASCADE,
  "decider_version"  VARCHAR(40) NOT NULL,
  "decompose"        BOOLEAN NOT NULL,
  "reasoning"        TEXT NOT NULL,
  "created_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "decomp_decisions_prompt_model_unique"
  ON "decomposition_decisions"("prompt_id", "model_id");
CREATE INDEX "idx_decomp_decisions_version"
  ON "decomposition_decisions"("decider_version");
COMMENT ON TABLE "decomposition_decisions" IS
  'Cache of live decomposition decider verdicts. Unique on (prompt_id, model_id); decider_version mismatch treated as cache miss and overwritten via ON CONFLICT.';
```

- [x] **Step 2: Apply the migration locally**

```bash
docker compose up -d postgres
cd packages/backend && npx prisma migrate deploy
```

Expected: `Applied migration: 20260519000000_routing_decider`.

- [x] **Step 3: Sanity-check the schema**

```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -c "\d llm_models" | grep "tier"
docker compose exec -T postgres psql -U chat3d -d chat3d -c "\d experiment_runs" | grep "routing_override"
docker compose exec -T postgres psql -U chat3d -d chat3d -c "\d decomposition_decisions"
```

Expected: `tier` column appears on `llm_models` (varchar 20, nullable); `routing_override` on `experiment_runs` (varchar 20, default 'auto', not null); `decomposition_decisions` table exists with all 7 columns, primary key on `id`, unique index on `(prompt_id, model_id)`, btree index on `decider_version`.

- [x] **Step 4: Commit**

```bash
git add packages/backend/prisma/migrations/20260519000000_routing_decider
git commit -m "db: add llm_models.tier, experiment_runs.routing_override, decomposition_decisions table"
```

---

## Task 3: Prisma schema — mirror the migration

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`

- [x] **Step 1: Add `tier` to `LlmModel`**

Edit `packages/backend/prisma/schema.prisma`. Find `model LlmModel {` (around line 721) and add after the `vlmEvalPreamble` field:

```prisma
  tier                  String?  @map("tier") @db.VarChar(20)
```

(Place it alphabetically near other optional fields; exact position doesn't matter for Prisma.)

- [x] **Step 2: Add `routingOverride` to `ExperimentRun`**

Find `model ExperimentRun {` (around line 598) and add after the `updatedAt` field:

```prisma
  routingOverride String   @default("auto") @map("routing_override") @db.VarChar(20)
```

- [x] **Step 3: Add the new `DecompositionDecision` model**

Append to the file (anywhere after the `LlmModel` block):

```prisma
model DecompositionDecision {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  promptId        String   @map("prompt_id") @db.Uuid
  modelId         String   @map("model_id") @db.Uuid
  deciderVersion  String   @map("decider_version") @db.VarChar(40)
  decompose       Boolean
  reasoning       String   @db.Text
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()

  prompt WorkbenchExamplePrompt @relation(fields: [promptId], references: [id], onDelete: Cascade, onUpdate: NoAction)
  model  LlmModel               @relation(fields: [modelId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@unique([promptId, modelId], map: "decomp_decisions_prompt_model_unique")
  @@index([deciderVersion], map: "idx_decomp_decisions_version")
  @@map("decomposition_decisions")
}
```

- [x] **Step 4: Add the reverse relations**

Find `model WorkbenchExamplePrompt {` (around line 407). Inside the block, add to the existing relations list:

```prisma
  decompositionDecisions DecompositionDecision[]
```

Find `model LlmModel {` (around line 721). Inside the block, add to the existing relations list (the existing block has `purposes` and `experimentRuns`):

```prisma
  decompositionDecisions DecompositionDecision[]
```

- [x] **Step 5: Regenerate the Prisma client**

```bash
cd packages/backend && npx prisma generate
```

Expected: `✔ Generated Prisma Client`.

- [x] **Step 6: TypeScript check**

```bash
cd packages/backend && npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0 — schema additions are additive, no existing call sites broken yet.

- [x] **Step 7: Commit**

```bash
git add packages/backend/prisma/schema.prisma
git commit -m "prisma: add tier, routingOverride, DecompositionDecision model"
```

---

## Task 4: Register `decomposition_decision` LlmPurpose

**Files:**
- Modify: `packages/backend/src/services/usage-tracking.service.ts`

- [x] **Step 1: Add the new purpose to the literal-union**

Edit `packages/backend/src/services/usage-tracking.service.ts`. Find `export type LlmPurpose =` (around line 45) and append `| "decomposition_decision"`:

```ts
export type LlmPurpose =
  | "conversation"
  | "codegen"
  | "chat_naming"
  | "vlm_evaluation"
  | "code_evaluation"
  | "embeddings"
  | "spec_generation"
  | "agent_orchestration"
  | "agent_decomposition"
  | "curation_distill"
  | "curation_tags"
  | "prompt_validation"
  | "prompt_improvement"
  | "knowledge_embedding"
  | "gap_prompt_generation"
  | "gap_decomposition"
  | "decomposition_decision";
```

- [x] **Step 2: TypeScript check**

```bash
cd packages/backend && npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0.

- [x] **Step 3: Commit**

```bash
git add packages/backend/src/services/usage-tracking.service.ts
git commit -m "usage: register decomposition_decision LlmPurpose"
```

---

## Task 5: Export `MULTI_PART_PATTERN` from `spec-generation.service.ts`

**Files:**
- Modify: `packages/backend/src/services/spec-generation.service.ts`

The router (Task 7) needs to consume the regex; today it's a module-local `const`.

- [x] **Step 1: Find the declaration**

Run: `grep -n "MULTI_PART_PATTERN" packages/backend/src/services/spec-generation.service.ts`
Expected: declaration at line 332.

- [x] **Step 2: Add `export` to the declaration**

Edit `packages/backend/src/services/spec-generation.service.ts`. Change line 332 from:

```ts
const MULTI_PART_PATTERN = /\b(two[- ]parts?|...)\b/i;
```

to:

```ts
export const MULTI_PART_PATTERN = /\b(two[- ]parts?|...)\b/i;
```

(Don't modify the regex body — just add `export`.)

- [x] **Step 3: TypeScript check**

```bash
cd packages/backend && npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0.

- [x] **Step 4: Commit**

```bash
git add packages/backend/src/services/spec-generation.service.ts
git commit -m "spec-gen: export MULTI_PART_PATTERN for unified router"
```

---

## Task 6: Decomposition decider service — TDD

**Files:**
- Create: `packages/backend/src/services/decomposition-decision.service.ts`
- Create: `packages/backend/src/__tests__/decomposition-decision.service.test.ts`

This is the core new service. Build cache helpers first (no LLM), then the LLM-calling `decideDecomposition()` on top.

### Task 6a: Cache helpers

- [x] **Step 1: Write the failing test for cache helpers**

Create `packages/backend/src/__tests__/decomposition-decision.service.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock prisma before importing the service under test.
const mockPrismaDecomp = {
  findUnique: vi.fn(),
  upsert: vi.fn(),
};
vi.mock("../db/prisma.js", () => ({
  prisma: { decompositionDecision: mockPrismaDecomp },
}));

import {
  DECIDER_VERSION,
  lookupCachedDecision,
  upsertDecision,
} from "../services/decomposition-decision.service.js";

beforeEach(() => {
  mockPrismaDecomp.findUnique.mockReset();
  mockPrismaDecomp.upsert.mockReset();
});

describe("decomposition-decision cache helpers", () => {
  it("lookupCachedDecision returns null when no row exists", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue(null);
    const result = await lookupCachedDecision("prompt-1", "model-1");
    expect(result).toBeNull();
    expect(mockPrismaDecomp.findUnique).toHaveBeenCalledWith({
      where: { promptId_modelId: { promptId: "prompt-1", modelId: "model-1" } },
    });
  });

  it("lookupCachedDecision returns null on decider_version mismatch (stale row)", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue({
      decompose: true,
      reasoning: "old reason",
      deciderVersion: "v0.9.0",
    });
    const result = await lookupCachedDecision("prompt-1", "model-1");
    expect(result).toBeNull();
  });

  it("lookupCachedDecision returns row when decider_version matches current", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue({
      decompose: true,
      reasoning: "lathe profile + grooves; small tier benefits from decomposition",
      deciderVersion: DECIDER_VERSION,
    });
    const result = await lookupCachedDecision("prompt-1", "model-1");
    expect(result).toEqual({
      decompose: true,
      reasoning: "lathe profile + grooves; small tier benefits from decomposition",
    });
  });

  it("upsertDecision writes via Prisma upsert with the current decider version", async () => {
    mockPrismaDecomp.upsert.mockResolvedValue({});
    await upsertDecision({
      promptId: "prompt-1",
      modelId: "model-1",
      decompose: false,
      reasoning: "simple cube",
    });
    expect(mockPrismaDecomp.upsert).toHaveBeenCalledWith({
      where: { promptId_modelId: { promptId: "prompt-1", modelId: "model-1" } },
      create: {
        promptId: "prompt-1",
        modelId: "model-1",
        deciderVersion: DECIDER_VERSION,
        decompose: false,
        reasoning: "simple cube",
      },
      update: {
        deciderVersion: DECIDER_VERSION,
        decompose: false,
        reasoning: "simple cube",
      },
    });
  });
});
```

- [x] **Step 2: Run the test — verify it fails**

```bash
cd packages/backend && npx vitest run src/__tests__/decomposition-decision.service.test.ts
```

Expected: FAIL — module `decomposition-decision.service.js` does not exist yet.

- [x] **Step 3: Implement the cache helpers**

Create `packages/backend/src/services/decomposition-decision.service.ts`:

```ts
/**
 * Live decomposition decider for multi-agent routing.
 *
 * Replaces the cached `requires_decomposition` read at routing time with a
 * fresh, model-tier-aware LLM call. Results are cached in
 * `decomposition_decisions` keyed by (prompt_id, model_id), version-stamped
 * with DECIDER_VERSION so bumping the system prompt automatically
 * invalidates stale rows (next call overwrites them via ON CONFLICT).
 *
 * Design doc: docs/superpowers/specs/2026-05-18-multi-agent-routing-redesign-design.md
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import type { ModelTier } from "@chat3d/shared";

const logger = createLogger("decomp-decider");

/**
 * Version stamp for the decider system prompt. BUMP THIS whenever the system
 * prompt below is edited — cache rows with a different version are treated
 * as misses, so the next call refreshes them.
 */
export const DECIDER_VERSION = "v1.0.0";

export interface CachedDecision {
  decompose: boolean;
  reasoning: string;
}

/**
 * Return the cached decision iff a row exists AND its decider_version matches
 * the current DECIDER_VERSION. Stale rows are treated as a miss (caller
 * recomputes, then overwrites via ON CONFLICT in upsertDecision).
 */
export async function lookupCachedDecision(
  promptId: string,
  modelId: string,
): Promise<CachedDecision | null> {
  const row = await prisma.decompositionDecision.findUnique({
    where: { promptId_modelId: { promptId, modelId } },
  });
  if (!row) return null;
  if (row.deciderVersion !== DECIDER_VERSION) return null;
  return { decompose: row.decompose, reasoning: row.reasoning };
}

export interface UpsertDecisionInput {
  promptId: string;
  modelId: string;
  decompose: boolean;
  reasoning: string;
}

/**
 * Insert a fresh decision row, or overwrite an existing one (e.g. stale
 * decider_version). Composite unique on (prompt_id, model_id) guarantees
 * at most one row per (prompt, model) pair regardless of how many bumps
 * the version has gone through.
 */
export async function upsertDecision(input: UpsertDecisionInput): Promise<void> {
  await prisma.decompositionDecision.upsert({
    where: {
      promptId_modelId: { promptId: input.promptId, modelId: input.modelId },
    },
    create: {
      promptId: input.promptId,
      modelId: input.modelId,
      deciderVersion: DECIDER_VERSION,
      decompose: input.decompose,
      reasoning: input.reasoning,
    },
    update: {
      deciderVersion: DECIDER_VERSION,
      decompose: input.decompose,
      reasoning: input.reasoning,
    },
  });
}
```

- [x] **Step 4: Run the test — verify it passes**

```bash
cd packages/backend && npx vitest run src/__tests__/decomposition-decision.service.test.ts
```

Expected: PASS — 4 tests green.

- [x] **Step 5: Commit**

```bash
git add packages/backend/src/services/decomposition-decision.service.ts packages/backend/src/__tests__/decomposition-decision.service.test.ts
git commit -m "decider: version-stamped cache helpers (lookup + upsert)"
```

### Task 6b: System prompt constant + JSON parser

- [x] **Step 1: Append the failing test for the parser**

Append to `packages/backend/src/__tests__/decomposition-decision.service.test.ts`:

```ts
import { parseDeciderResponse } from "../services/decomposition-decision.service.js";

describe("parseDeciderResponse", () => {
  it("parses well-formed JSON", () => {
    const r = parseDeciderResponse('{"decompose": true, "reasoning": "multi-part with mating hinge"}');
    expect(r).toEqual({ decompose: true, reasoning: "multi-part with mating hinge" });
  });

  it("strips markdown code fences before parsing", () => {
    const r = parseDeciderResponse('```json\n{"decompose": false, "reasoning": "simple primitive"}\n```');
    expect(r).toEqual({ decompose: false, reasoning: "simple primitive" });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseDeciderResponse("not json")).toThrow(/decider response/i);
  });

  it("throws when 'decompose' is missing or non-boolean", () => {
    expect(() => parseDeciderResponse('{"reasoning": "no decompose field"}')).toThrow(/decompose/);
    expect(() => parseDeciderResponse('{"decompose": "yes", "reasoning": "x"}')).toThrow(/decompose/);
  });

  it("falls back to empty reasoning when missing", () => {
    const r = parseDeciderResponse('{"decompose": true}');
    expect(r).toEqual({ decompose: true, reasoning: "" });
  });
});
```

- [x] **Step 2: Run the parser tests — verify they fail**

```bash
cd packages/backend && npx vitest run src/__tests__/decomposition-decision.service.test.ts -t "parseDeciderResponse"
```

Expected: FAIL — `parseDeciderResponse is not a function`.

- [x] **Step 3: Add the system prompt + parser to the service**

Append to `packages/backend/src/services/decomposition-decision.service.ts`:

```ts
// ── System prompt (BUMP DECIDER_VERSION above when editing this) ────────

export const DECIDER_SYSTEM_PROMPT = `You decide whether a 3D CAD prompt should be routed to a multi-agent decomposition pipeline or a single-agent codegen pipeline. Multi-agent breaks the model into 2-6 sub-parts that are designed independently and then assembled. It's more expensive (~2-3× tokens) but helps when a model would otherwise fail to produce coherent geometry in one pass.

You will receive:
- the user's prompt
- the target model's TIER ∈ { frontier, mid, small }
- (optionally) the spec LLM's interpretation of the prompt

Decision rules — calibrated PER TIER:

FRONTIER (Claude Sonnet/Opus, GPT-4+, etc.):
  Decompose ONLY when the prompt has clearly multiple independently-designable assembled parts with mating geometry (snap-fit lid, hinged door, separate body+arm with interface points). These models handle complex single-piece geometry solo. Lathe profiles, organic shapes, dense feature counts on one body → single-agent.

MID (mid-tier OSS, larger fine-tunes that aren't tool-trained):
  Decompose for:
  - Clear multi-part objects with mating geometry
  - Single-piece prompts with ≥4 distinct geometric operations (revolved profile + grooves + fillets + holes, etc.)
  Otherwise single-agent.

SMALL (small fine-tunes like chat3d-build123d-02-synthetic-16k:ma, 27B-and-under):
  Decompose more eagerly. Decompose for:
  - Clear multi-part objects
  - Single-piece prompts with revolved/lathe profiles + surface features (grooves, knurling)
  - Organic/sculpted shapes
  - Dense polar or linear arrays (≥6 repeats) — these often fail in one shot
  - Any prompt with ≥3 distinct geometric features beyond a primitive

Return ONLY a JSON object:
  { "decompose": boolean, "reasoning": "one sentence, max 20 words" }`;

// ── Response parser ────────────────────────────────────────────────────

export interface ParsedDeciderResponse {
  decompose: boolean;
  reasoning: string;
}

/**
 * Parse the decider LLM's JSON response. Tolerant of markdown code fences
 * (Claude sometimes wraps JSON in \`\`\`json ... \`\`\`). Throws on hard
 * failure so the caller (decideDecomposition) can fall back to single-agent
 * via the router's catch block.
 */
export function parseDeciderResponse(raw: string): ParsedDeciderResponse {
  const stripped = raw
    .replace(/^\s*\`\`\`(?:json)?\s*/m, "")
    .replace(/\s*\`\`\`\s*$/m, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error(`decider response is not valid JSON: ${stripped.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("decider response is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.decompose !== "boolean") {
    throw new Error("decider response missing or invalid 'decompose' boolean");
  }
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.trim() : "";
  return { decompose: obj.decompose, reasoning };
}
```

(The triple-backtick-with-escape inside the comment is `\`\`\`` — in your editor enter three backticks; the backslash-escapes are only in this plan to keep the markdown intact.)

- [x] **Step 4: Run the parser tests — verify pass**

```bash
cd packages/backend && npx vitest run src/__tests__/decomposition-decision.service.test.ts -t "parseDeciderResponse"
```

Expected: PASS — 5 tests green.

- [x] **Step 5: Commit**

```bash
git add packages/backend/src/services/decomposition-decision.service.ts packages/backend/src/__tests__/decomposition-decision.service.test.ts
git commit -m "decider: system prompt constant + tolerant JSON response parser"
```

### Task 6c: `decideDecomposition()` orchestrator

- [x] **Step 1: Write the failing orchestrator tests**

Append to `packages/backend/src/__tests__/decomposition-decision.service.test.ts`:

```ts
import { decideDecomposition } from "../services/decomposition-decision.service.js";

// Mock the LLM call layer + model resolver
const mockTrackedGenerateText = vi.fn();
vi.mock("../services/tracked-llm.service.js", () => ({
  trackedGenerateText: (...args: unknown[]) => mockTrackedGenerateText(...args),
}));
const mockGetModelForPurpose = vi.fn();
vi.mock("../services/llm-config.service.js", async () => {
  const actual = await vi.importActual<typeof import("../services/llm-config.service.js")>(
    "../services/llm-config.service.js",
  );
  return {
    ...actual,
    getModelForPurpose: (...args: unknown[]) => mockGetModelForPurpose(...args),
  };
});

beforeEach(() => {
  mockTrackedGenerateText.mockReset();
  mockGetModelForPurpose.mockReset();
  mockGetModelForPurpose.mockResolvedValue({
    id: "decider-model-id",
    provider: "bedrock",
    modelName: "claude-haiku-4-5",
    label: "Haiku 4.5",
    costPer1mInput: 0.25,
    costPer1mOutput: 1.25,
    maxConcurrent: 5,
  });
});

describe("decideDecomposition orchestrator", () => {
  it("returns cached result with live_decider_cached when row matches version", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue({
      decompose: true,
      reasoning: "cached: snap-fit lid",
      deciderVersion: DECIDER_VERSION,
    });
    const r = await decideDecomposition({
      promptId: "p1",
      promptText: "a box with a snap-fit lid",
      modelId: "m1",
      modelTier: "frontier",
    });
    expect(r.decompose).toBe(true);
    expect(r.reasoning).toBe("cached: snap-fit lid");
    expect(r.triggerReason).toBe("live_decider_cached");
    expect(r.deciderVersion).toBe(DECIDER_VERSION);
    expect(mockTrackedGenerateText).not.toHaveBeenCalled();
  });

  it("calls LLM and upserts on cache miss, returns live_decider", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue(null);
    mockPrismaDecomp.upsert.mockResolvedValue({});
    mockTrackedGenerateText.mockResolvedValue({
      text: '{"decompose": true, "reasoning": "lathe + grooves on small tier"}',
      usage: { inputTokens: 200, outputTokens: 30 },
    });
    const r = await decideDecomposition({
      promptId: "p2",
      promptText: "A lathe-turned handle: complex profile with gripping grooves",
      modelId: "m1",
      modelTier: "small",
    });
    expect(r).toEqual({
      decompose: true,
      reasoning: "lathe + grooves on small tier",
      triggerReason: "live_decider",
      deciderVersion: DECIDER_VERSION,
    });
    expect(mockTrackedGenerateText).toHaveBeenCalledTimes(1);
    expect(mockPrismaDecomp.upsert).toHaveBeenCalledTimes(1);
  });

  it("treats null modelTier as 'mid' in the user-message payload", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue(null);
    mockPrismaDecomp.upsert.mockResolvedValue({});
    mockTrackedGenerateText.mockResolvedValue({
      text: '{"decompose": false, "reasoning": "simple primitive"}',
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    await decideDecomposition({
      promptId: "p3",
      promptText: "a 10mm cube",
      modelId: "m1",
      modelTier: null,
    });
    const llmCall = mockTrackedGenerateText.mock.calls[0]![0] as { prompt: string };
    expect(llmCall.prompt).toMatch(/TIER: mid/);
  });

  it("includes spec_interpretation in the user message when provided", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue(null);
    mockPrismaDecomp.upsert.mockResolvedValue({});
    mockTrackedGenerateText.mockResolvedValue({
      text: '{"decompose": false, "reasoning": "single piece"}',
      usage: { inputTokens: 150, outputTokens: 20 },
    });
    await decideDecomposition({
      promptId: "p4",
      promptText: "lathe handle",
      modelId: "m1",
      modelTier: "frontier",
      specInterpretation: "A turned cylindrical handle with surface grooves.",
    });
    const llmCall = mockTrackedGenerateText.mock.calls[0]![0] as { prompt: string };
    expect(llmCall.prompt).toMatch(/Spec interpretation:/);
    expect(llmCall.prompt).toMatch(/A turned cylindrical handle with surface grooves\./);
  });

  it("rethrows when the LLM call fails (router handles fallback)", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue(null);
    mockTrackedGenerateText.mockRejectedValue(new Error("upstream timeout"));
    await expect(
      decideDecomposition({
        promptId: "p5",
        promptText: "x",
        modelId: "m1",
        modelTier: "mid",
      }),
    ).rejects.toThrow(/upstream timeout/);
  });

  it("rethrows when the LLM response is unparseable", async () => {
    mockPrismaDecomp.findUnique.mockResolvedValue(null);
    mockTrackedGenerateText.mockResolvedValue({
      text: "I'm sorry I can't help with that.",
      usage: { inputTokens: 100, outputTokens: 10 },
    });
    await expect(
      decideDecomposition({
        promptId: "p6",
        promptText: "x",
        modelId: "m1",
        modelTier: "mid",
      }),
    ).rejects.toThrow(/JSON/);
  });
});
```

- [x] **Step 2: Run the orchestrator tests — verify they fail**

```bash
cd packages/backend && npx vitest run src/__tests__/decomposition-decision.service.test.ts -t "decideDecomposition orchestrator"
```

Expected: FAIL — `decideDecomposition is not a function`.

- [x] **Step 3: Implement `decideDecomposition`**

Append to `packages/backend/src/services/decomposition-decision.service.ts`:

```ts
import { trackedGenerateText } from "./tracked-llm.service.js";
import {
  getModelForPurpose,
  createProviderModel,
  buildGenerateOptions,
  maxOutputWithThinking,
} from "./llm-config.service.js";

export interface DecomposeDecisionInput {
  promptId: string;
  promptText: string;
  modelId: string;
  /** Tier of the **target codegen** model (not the decider's model). `null` → treated as "mid". */
  modelTier: ModelTier | null;
  /** Optional cached spec interpretation as context. Truncated to 500 chars to keep input small. */
  specInterpretation?: string;
}

export interface DecomposeDecisionResult {
  decompose: boolean;
  reasoning: string;
  triggerReason: "live_decider" | "live_decider_cached";
  deciderVersion: string;
}

function buildUserMessage(
  promptText: string,
  modelTier: ModelTier | null,
  specInterpretation?: string,
): string {
  const tier = modelTier ?? "mid";
  const parts = [
    `Prompt: ${promptText}`,
    `TIER: ${tier}`,
  ];
  if (specInterpretation && specInterpretation.trim().length > 0) {
    parts.push(`Spec interpretation: ${specInterpretation.slice(0, 500)}`);
  }
  return parts.join("\n\n");
}

/**
 * Decide whether to route to multi-agent for the given prompt + target model.
 *
 * Order:
 *  1. Cache hit on (promptId, modelId, DECIDER_VERSION) → return cached.
 *  2. Cache miss → call LLM, parse response, upsert row, return.
 *
 * On LLM error (network, parse failure, etc.): rethrow. The caller (the
 * router) catches and falls back to single-agent with trigger
 * `spec_unavailable`.
 */
export async function decideDecomposition(
  input: DecomposeDecisionInput,
): Promise<DecomposeDecisionResult> {
  const cached = await lookupCachedDecision(input.promptId, input.modelId);
  if (cached) {
    logger.debug(
      { promptId: input.promptId, modelId: input.modelId, decompose: cached.decompose },
      "decomposition decision cache hit",
    );
    return {
      decompose: cached.decompose,
      reasoning: cached.reasoning,
      triggerReason: "live_decider_cached",
      deciderVersion: DECIDER_VERSION,
    };
  }

  const config = await getModelForPurpose("decomposition_decision");
  const model = createProviderModel(config);
  const userMessage = buildUserMessage(input.promptText, input.modelTier, input.specInterpretation);

  logger.info(
    { promptId: input.promptId, modelId: input.modelId, modelTier: input.modelTier ?? "mid", decider: config.label },
    "calling decomposition decider",
  );

  const result = await trackedGenerateText({
    model,
    system: DECIDER_SYSTEM_PROMPT,
    prompt: userMessage,
    ...buildGenerateOptions(config),
    maxOutputTokens: maxOutputWithThinking(256, config),
    temperature: 0,
  }, {
    purpose: "decomposition_decision",
    providerName: config.provider,
    modelId: config.id,
    modelName: config.modelName,
    modelConfig: { costPer1mInput: config.costPer1mInput, costPer1mOutput: config.costPer1mOutput },
  });

  const parsed = parseDeciderResponse(result.text);

  await upsertDecision({
    promptId: input.promptId,
    modelId: input.modelId,
    decompose: parsed.decompose,
    reasoning: parsed.reasoning,
  });

  logger.info(
    { promptId: input.promptId, modelId: input.modelId, decompose: parsed.decompose, reasoning: parsed.reasoning },
    "decomposition decider verdict",
  );

  return {
    decompose: parsed.decompose,
    reasoning: parsed.reasoning,
    triggerReason: "live_decider",
    deciderVersion: DECIDER_VERSION,
  };
}
```

- [x] **Step 4: Run all decider tests — verify pass**

```bash
cd packages/backend && npx vitest run src/__tests__/decomposition-decision.service.test.ts
```

Expected: PASS — all 15 tests green (4 cache + 5 parser + 6 orchestrator).

- [x] **Step 5: TypeScript check**

```bash
cd packages/backend && npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0.

- [x] **Step 6: Commit**

```bash
git add packages/backend/src/services/decomposition-decision.service.ts packages/backend/src/__tests__/decomposition-decision.service.test.ts
git commit -m "decider: decideDecomposition orchestrator with cache + LLM call + JSON parse"
```

---

## Task 7: Unified router service — TDD

**Files:**
- Create: `packages/backend/src/services/routing.service.ts`
- Create: `packages/backend/src/__tests__/routing.service.test.ts`

The router is what `workbench-codegen.service.ts` and `query.service.ts` both call into. It encapsulates the override → regex → decider → fallback flow from §6 of the spec.

- [x] **Step 1: Write the failing router tests**

Create `packages/backend/src/__tests__/routing.service.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";

const mockDecideDecomposition = vi.fn();
vi.mock("../services/decomposition-decision.service.js", () => ({
  decideDecomposition: (...args: unknown[]) => mockDecideDecomposition(...args),
}));

import { routeGeneration } from "../services/routing.service.js";

beforeEach(() => {
  mockDecideDecomposition.mockReset();
});

describe("routeGeneration", () => {
  it("returns useMultiAgent=true with forced_override when routingOverride=force_decompose", async () => {
    const r = await routeGeneration({
      promptId: "p1",
      promptText: "a 10mm cube",
      modelId: "m1",
      modelTier: "frontier",
      routingOverride: "force_decompose",
    });
    expect(r).toEqual({ useMultiAgent: true, triggerReason: "forced_override", reasoning: undefined });
    expect(mockDecideDecomposition).not.toHaveBeenCalled();
  });

  it("returns useMultiAgent=false with forced_override when routingOverride=force_single", async () => {
    const r = await routeGeneration({
      promptId: "p2",
      promptText: "a box with a snap-fit lid",  // regex would match but override wins
      modelId: "m1",
      modelTier: "small",
      routingOverride: "force_single",
    });
    expect(r).toEqual({ useMultiAgent: false, triggerReason: "forced_override", reasoning: undefined });
    expect(mockDecideDecomposition).not.toHaveBeenCalled();
  });

  it("fires multi-part regex (auto override) without calling the decider", async () => {
    const r = await routeGeneration({
      promptId: "p3",
      promptText: "a box with a snap-fit lid",
      modelId: "m1",
      modelTier: "small",
      routingOverride: "auto",
    });
    expect(r.useMultiAgent).toBe(true);
    expect(r.triggerReason).toBe("multi_part_pattern");
    expect(mockDecideDecomposition).not.toHaveBeenCalled();
  });

  it("calls the decider when regex doesn't match (auto override)", async () => {
    mockDecideDecomposition.mockResolvedValue({
      decompose: true,
      reasoning: "lathe + grooves on small tier",
      triggerReason: "live_decider",
      deciderVersion: "v1.0.0",
    });
    const r = await routeGeneration({
      promptId: "p4",
      promptText: "A lathe-turned handle: complex profile with gripping grooves",
      modelId: "m1",
      modelTier: "small",
      routingOverride: "auto",
    });
    expect(r.useMultiAgent).toBe(true);
    expect(r.triggerReason).toBe("live_decider");
    expect(r.reasoning).toBe("lathe + grooves on small tier");
    expect(mockDecideDecomposition).toHaveBeenCalledTimes(1);
  });

  it("propagates live_decider_cached trigger reason from decider", async () => {
    mockDecideDecomposition.mockResolvedValue({
      decompose: false,
      reasoning: "cached: simple primitive",
      triggerReason: "live_decider_cached",
      deciderVersion: "v1.0.0",
    });
    const r = await routeGeneration({
      promptId: "p5",
      promptText: "a 10mm cube",
      modelId: "m1",
      modelTier: "frontier",
      routingOverride: "auto",
    });
    expect(r.useMultiAgent).toBe(false);
    expect(r.triggerReason).toBe("live_decider_cached");
    expect(r.reasoning).toBe("cached: simple primitive");
  });

  it("falls back to useMultiAgent=false + spec_unavailable when decider errors", async () => {
    mockDecideDecomposition.mockRejectedValue(new Error("decider exploded"));
    const r = await routeGeneration({
      promptId: "p6",
      promptText: "A lathe-turned handle",
      modelId: "m1",
      modelTier: "small",
      routingOverride: "auto",
    });
    expect(r).toEqual({ useMultiAgent: false, triggerReason: "spec_unavailable", reasoning: undefined });
  });

  it("treats omitted routingOverride as 'auto'", async () => {
    mockDecideDecomposition.mockResolvedValue({
      decompose: false,
      reasoning: "simple",
      triggerReason: "live_decider",
      deciderVersion: "v1.0.0",
    });
    const r = await routeGeneration({
      promptId: "p7",
      promptText: "a simple cube",
      modelId: "m1",
      modelTier: "frontier",
      // routingOverride omitted
    });
    expect(r.useMultiAgent).toBe(false);
    expect(r.triggerReason).toBe("live_decider");
  });

  it("passes specInterpretation through to the decider", async () => {
    mockDecideDecomposition.mockResolvedValue({
      decompose: true,
      reasoning: "x",
      triggerReason: "live_decider",
      deciderVersion: "v1.0.0",
    });
    await routeGeneration({
      promptId: "p8",
      promptText: "thing",
      modelId: "m1",
      modelTier: "mid",
      routingOverride: "auto",
      specInterpretation: "A complex thing.",
    });
    const call = mockDecideDecomposition.mock.calls[0]![0] as { specInterpretation?: string };
    expect(call.specInterpretation).toBe("A complex thing.");
  });
});
```

- [x] **Step 2: Run the tests — verify they fail**

```bash
cd packages/backend && npx vitest run src/__tests__/routing.service.test.ts
```

Expected: FAIL — module `routing.service.js` does not exist.

- [x] **Step 3: Implement `routeGeneration`**

Create `packages/backend/src/services/routing.service.ts`:

```ts
/**
 * Unified multi-agent routing decision shared by workbench codegen, chat
 * codegen, and any future generation surface. Replaces the per-call inline
 * `resolveComplexityFromSpec()`-based routing that used to live in
 * `workbench-codegen.service.ts` and `query.service.ts`.
 *
 * Decision precedence:
 *   1. Per-run routing_override (force_decompose / force_single) → bypass
 *      decider entirely. Trigger reason: forced_override.
 *   2. Multi-part regex safety net (cheap, deterministic). Trigger reason:
 *      multi_part_pattern.
 *   3. Live decomposition decider call (with version-stamped cache).
 *      Trigger reason: live_decider | live_decider_cached.
 *   4. Decider error → fallback to single-agent. Trigger reason:
 *      spec_unavailable.
 *
 * Design doc: docs/superpowers/specs/2026-05-18-multi-agent-routing-redesign-design.md
 */

import { createLogger } from "../utils/logger.js";
import type { ComplexityTriggerReason, ModelTier, RoutingOverride } from "@chat3d/shared";
import { decideDecomposition } from "./decomposition-decision.service.js";
import { MULTI_PART_PATTERN } from "./spec-generation.service.js";

const logger = createLogger("routing");

export interface RouteGenerationInput {
  promptId: string;
  promptText: string;
  modelId: string;
  modelTier: ModelTier | null;
  /** Defaults to "auto" if omitted. */
  routingOverride?: RoutingOverride;
  /** Optional cached spec interpretation, passed through to the decider as a hint. */
  specInterpretation?: string;
}

export interface RouteGenerationResult {
  useMultiAgent: boolean;
  triggerReason: ComplexityTriggerReason;
  /** Present only when the decider returned reasoning (live_decider / live_decider_cached). */
  reasoning?: string;
}

export async function routeGeneration(input: RouteGenerationInput): Promise<RouteGenerationResult> {
  const override = input.routingOverride ?? "auto";

  // 1. Per-run override
  if (override === "force_decompose") {
    logger.info({ promptId: input.promptId }, "routing: force_decompose override");
    return { useMultiAgent: true, triggerReason: "forced_override", reasoning: undefined };
  }
  if (override === "force_single") {
    logger.info({ promptId: input.promptId }, "routing: force_single override");
    return { useMultiAgent: false, triggerReason: "forced_override", reasoning: undefined };
  }

  // 2. Multi-part regex safety net — cheap, deterministic, no API cost.
  const combinedText = input.specInterpretation
    ? `${input.promptText} ${input.specInterpretation}`
    : input.promptText;
  if (MULTI_PART_PATTERN.test(combinedText)) {
    logger.info({ promptId: input.promptId }, "routing: multi_part_pattern matched");
    return { useMultiAgent: true, triggerReason: "multi_part_pattern", reasoning: undefined };
  }

  // 3. Live decider with version-stamped cache
  try {
    const decision = await decideDecomposition({
      promptId: input.promptId,
      promptText: input.promptText,
      modelId: input.modelId,
      modelTier: input.modelTier,
      specInterpretation: input.specInterpretation,
    });
    return {
      useMultiAgent: decision.decompose,
      triggerReason: decision.triggerReason,
      reasoning: decision.reasoning,
    };
  } catch (err) {
    // 4. Fallback: decider unavailable → single-agent (regex already ruled out)
    logger.warn(
      { err, promptId: input.promptId, modelId: input.modelId },
      "decomposition decider failed; falling back to single-agent",
    );
    return { useMultiAgent: false, triggerReason: "spec_unavailable", reasoning: undefined };
  }
}
```

- [x] **Step 4: Run the router tests — verify they pass**

```bash
cd packages/backend && npx vitest run src/__tests__/routing.service.test.ts
```

Expected: PASS — all 8 tests green.

- [x] **Step 5: TypeScript check**

```bash
cd packages/backend && npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0.

- [x] **Step 6: Commit**

```bash
git add packages/backend/src/services/routing.service.ts packages/backend/src/__tests__/routing.service.test.ts
git commit -m "routing: unified routeGeneration() — override + regex + decider + fallback"
```

---

## Task 8: Wire workbench codegen to the unified router

**Files:**
- Modify: `packages/backend/src/services/workbench-codegen.service.ts`

- [x] **Step 1: Add the imports**

Edit `packages/backend/src/services/workbench-codegen.service.ts`. Find the existing import of `spec-generation.service.js` (around line 38) and update it to drop `resolveComplexityFromSpec` (still re-exported from `spec-generation` for back-compat callers, but this file no longer uses it for routing):

```ts
import { generateSpec, type SpecResult } from "./spec-generation.service.js";
```

Then add the router import near the other service imports:

```ts
import { routeGeneration } from "./routing.service.js";
```

And add a Prisma import (used to look up tier + routing_override):

```ts
import { prisma } from "../db/prisma.js";
```

- [x] **Step 2: Replace the routing block at lines 442–462**

Find the block currently containing:

```ts
  const specWouldRouteComplex = specResult?.complexity === "complex";
  const wbUseMultiAgent = options?.forceMultiAgent === true || specWouldRouteComplex;
  // ... if (options?.forceMultiAgent === true && !specWouldRouteComplex) { ... } ...
```

Replace the entire block (from `const specWouldRouteComplex =` through the closing of the `logger.info` call — i.e. lines 442–462 inclusive) with:

```ts
  // Look up per-run override (auto for non-experiment paths) + the target model's tier.
  // Both queries are tiny (single row each) and happen once per generation.
  const [runRow, modelRow] = await Promise.all([
    options?.experimentRunId
      ? prisma.experimentRun.findUnique({
          where: { id: options.experimentRunId },
          select: { routingOverride: true },
        })
      : Promise.resolve(null),
    prisma.llmModel.findUnique({
      where: { id: wbAgentModelConfig.id },
      select: { tier: true },
    }),
  ]);

  // The `forceMultiAgent` debug option (used by scripts/probe-multi-agent.ts)
  // takes precedence over the per-run override — it's a one-off probe knob.
  const effectiveOverride: import("@chat3d/shared").RoutingOverride =
    options?.forceMultiAgent === true
      ? "force_decompose"
      : ((runRow?.routingOverride as import("@chat3d/shared").RoutingOverride | undefined) ?? "auto");

  const routeResult = await routeGeneration({
    promptId: ctx.promptId,
    promptText: ctx.prompt,
    modelId: wbAgentModelConfig.id,
    modelTier: (modelRow?.tier as import("@chat3d/shared").ModelTier | null) ?? null,
    routingOverride: effectiveOverride,
    specInterpretation: specResult?.interpretation,
  });
  const wbUseMultiAgent = routeResult.useMultiAgent;
  traceBuilder.setComplexityTriggerReason(routeResult.triggerReason);
  logger.info(
    {
      useMultiAgent: wbUseMultiAgent,
      triggerReason: routeResult.triggerReason,
      override: effectiveOverride,
      modelTier: modelRow?.tier ?? null,
      deciderReasoning: routeResult.reasoning,
    },
    "multi-agent routing decision",
  );
```

(Verify `ctx.promptId` exists — `PromptContext` is defined in `workbench-pipeline-helpers.service.ts`. If the field is named differently, use the actual name.)

- [x] **Step 3: Confirm `PromptContext` has `promptId`**

Run: `grep -n "promptId\|prompt:" packages/backend/src/services/workbench-pipeline-helpers.service.ts | head -10`
Expected: `promptId` is part of the `PromptContext` interface. If it's named `id`, substitute throughout.

- [x] **Step 4: TypeScript check**

```bash
cd packages/backend && npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0. If `resolveComplexityFromSpec` was used elsewhere in this file that you didn't notice, the compiler will tell you — re-add the import line if needed (it's still exported from `spec-generation.service.ts`).

- [x] **Step 5: Run the full backend test suite to make sure nothing regressed**

```bash
cd packages/backend && npx vitest run
```

Expected: all existing tests still pass. The old `multi-agent-trigger.integration.test.ts` only tests `resolveComplexityFromSpec` directly, which still exists, so it should remain green.

- [x] **Step 6: Commit**

```bash
git add packages/backend/src/services/workbench-codegen.service.ts
git commit -m "workbench: route multi-agent via unified routeGeneration() with per-run override + tier"
```

---

## Task 9: Wire chat codegen to the unified router

**Files:**
- Modify: `packages/backend/src/services/query.service.ts`

- [x] **Step 1: Add the imports**

Edit `packages/backend/src/services/query.service.ts`. Find the existing import of `spec-generation.service.js` (search for it) and ensure `resolveComplexityFromSpec` is no longer required by this file. Add:

```ts
import { routeGeneration } from "./routing.service.js";
import { prisma } from "../db/prisma.js";  // (skip if already imported in this file)
```

(Check whether `prisma` is already imported; if so, omit that line.)

- [x] **Step 2: Replace the routing block at lines 1442–1471**

Find the block containing:

```ts
      const useMultiAgent = epSpecComplexity === "complex" && !agIsModification;

      // ── Trace capture setup ──
      const chatTraceBuilder = new TraceBuilder("single_agent");
      // ... resolveComplexityFromSpec(...) ...
```

Replace the routing logic (lines 1442 and 1460–1471 inclusive — but **keep** the `TraceBuilder` creation and `createTraceEarly` block intact between them) with:

```ts
      // ── Routing decision via unified router ──
      // Chat path: no experiment_run, so no per-run override applies. Look up
      // the target codegen model's tier (small/mid/frontier) so the decider
      // calibrates its decompose threshold. Modifications bypass routing
      // entirely and stay single-agent — that's a chat-specific invariant.
      const chatModelRow = agIsModification
        ? null
        : await prisma.llmModel.findUnique({
            where: { id: agAgentModelConfig.id },
            select: { tier: true },
          });

      let useMultiAgent: boolean;
      let routingTriggerReason: import("@chat3d/shared").ComplexityTriggerReason;

      if (agIsModification) {
        useMultiAgent = false;
        routingTriggerReason = "single_agent_default";
      } else {
        const routeResult = await routeGeneration({
          promptId: epPromptId,  // see Step 3 — substitute the actual variable holding the prompt's UUID
          promptText: prompt,
          modelId: agAgentModelConfig.id,
          modelTier: (chatModelRow?.tier as import("@chat3d/shared").ModelTier | null) ?? null,
          routingOverride: "auto",  // chat path has no per-run override
          specInterpretation: epSpecInterpretation,
        });
        useMultiAgent = routeResult.useMultiAgent;
        routingTriggerReason = routeResult.triggerReason;
      }

      // ── Trace capture setup ──────────────────────────────────────────
      const chatTraceBuilder = new TraceBuilder("single_agent");
      chatTraceBuilder.startPhase("root", "root", "Chat Generation Pipeline");
      let chatTraceId: string | null = null;
      try {
        chatTraceId = await createTraceEarly({
          chatItemId: assistantItemId,
          pipelineType: "single_agent",
          trace: chatTraceBuilder.snapshot(),
        });
      } catch (err) {
        queryLogger.warn({ err }, "trace early-create failed; chat run will not be traced");
      }

      chatTraceBuilder.setComplexityTriggerReason(routingTriggerReason);
      if (useMultiAgent) {
        chatTraceBuilder.setPipelineType("multi_agent");
      }
```

(Substitute `agAgentModelConfig.id` if the variable in this scope holding the chat codegen model is named differently — check the lines above 1442 for the actual name.)

- [x] **Step 3: Resolve the prompt-id variable name for the chat path**

Chat doesn't have a `workbench_example_prompts.id` — chat prompts aren't pre-existing. The decider cache is keyed on `(promptId, modelId)`, but for chat we don't have a stable prompt UUID.

**Two options, pick one and document inline:**

a) Pass a synthetic ID (e.g. a hash of the prompt text) so the cache effectively dedupes identical chat prompts:

```ts
const chatPromptId = `chat:${crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 32)}`;
```

But this would fail FK constraint on `workbench_example_prompts(id)` — so the cache would only work if we drop the FK or allow null promptId. **Not worth it for chat.**

b) **Skip cache for chat** — make `decideDecomposition`'s `promptId` field optional, and when missing, skip the cache lookup/upsert (always call LLM live). This is the simplest correct behavior and matches the principle "live every time" anyway; the cache exists mainly to save tokens on repeated experiment runs of the same prompt set.

**Implement option (b)**. In `decomposition-decision.service.ts`:

```ts
// Change DecomposeDecisionInput:
export interface DecomposeDecisionInput {
  /** Workbench prompt UUID. When null/undefined (chat path), skip cache entirely. */
  promptId: string | null;
  promptText: string;
  modelId: string;
  modelTier: ModelTier | null;
  specInterpretation?: string;
}

// In decideDecomposition, guard the cache lookup:
if (input.promptId) {
  const cached = await lookupCachedDecision(input.promptId, input.modelId);
  if (cached) {
    /* existing return */
  }
}

// ... after parsing ...

if (input.promptId) {
  await upsertDecision({
    promptId: input.promptId,
    modelId: input.modelId,
    decompose: parsed.decompose,
    reasoning: parsed.reasoning,
  });
}
```

And add a new unit test in `decomposition-decision.service.test.ts`:

```ts
it("skips cache (no findUnique, no upsert) when promptId is null", async () => {
  mockTrackedGenerateText.mockResolvedValue({
    text: '{"decompose": true, "reasoning": "x"}',
    usage: { inputTokens: 100, outputTokens: 10 },
  });
  const r = await decideDecomposition({
    promptId: null,
    promptText: "chat prompt",
    modelId: "m1",
    modelTier: "small",
  });
  expect(r.triggerReason).toBe("live_decider");
  expect(mockPrismaDecomp.findUnique).not.toHaveBeenCalled();
  expect(mockPrismaDecomp.upsert).not.toHaveBeenCalled();
});
```

Also update `routing.service.ts`'s `RouteGenerationInput.promptId` to `string | null` and pass-through.

In the chat-side code from Step 2, use:

```ts
promptId: null,  // chat path: no workbench prompt UUID; decider runs live every time
```

- [x] **Step 4: Re-run the decider + router tests after the promptId-nullable change**

```bash
cd packages/backend && npx vitest run src/__tests__/decomposition-decision.service.test.ts src/__tests__/routing.service.test.ts
```

Expected: all tests pass, including the new null-promptId test.

- [x] **Step 5: TypeScript check**

```bash
cd packages/backend && npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0.

- [x] **Step 6: Run full backend test suite**

```bash
cd packages/backend && npx vitest run
```

Expected: green.

- [x] **Step 7: Commit**

```bash
git add packages/backend/src/services/query.service.ts packages/backend/src/services/routing.service.ts packages/backend/src/services/decomposition-decision.service.ts packages/backend/src/__tests__/decomposition-decision.service.test.ts packages/backend/src/__tests__/routing.service.test.ts
git commit -m "chat: route multi-agent via routeGeneration(); decider promptId-nullable for chat path"
```

---

## Task 10: Admin API — accept `tier` on models, `routingOverride` on experiment runs

**Files:**
- Modify: `packages/backend/src/routes/admin/llm-models.routes.ts` (search if path differs)
- Modify: `packages/backend/src/routes/admin/experiments.routes.ts` (or whichever file owns the experiment-runs PATCH)

### Task 10a: Models tier

- [x] **Step 1: Locate the route file**

Run: `grep -rln "llm-models\|llmModels" packages/backend/src/routes/ | head -5`
Expected: shows the route file owning `PATCH /admin/llm-models/:id`.

- [x] **Step 2: Add `tier` to the accepted body shape**

Edit the route file. Find the existing `PATCH /llm-models/:id` handler (or the `updateLlmModel` service it calls). In the body parsing:

a) Allow `tier` as an optional `string | null` field.
b) Validate the value is one of `"frontier" | "mid" | "small" | null`.
c) Pass it through to the Prisma `update()` call.

Concrete snippet (adapt to existing pattern in this file):

```ts
const ALLOWED_TIERS = new Set(["frontier", "mid", "small"]);
// ... inside the PATCH handler ...
if ("tier" in body) {
  const t = body.tier;
  if (t !== null && (typeof t !== "string" || !ALLOWED_TIERS.has(t))) {
    return res.status(400).json({ error: "tier must be one of frontier|mid|small or null" });
  }
  updateData.tier = t;
}
```

Do the same in the `POST /llm-models` create handler.

- [x] **Step 3: Include `tier` in the GET response**

Find the route that returns the model list (e.g. `GET /llm-models`). The Prisma query likely already returns all fields; if a `select:` block is in use, add `tier: true`.

- [x] **Step 4: TypeScript check + restart-free test**

```bash
cd packages/backend && npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0.

- [x] **Step 5: Manual smoke test via curl**

```bash
docker compose build backend && docker compose up -d backend
sleep 5
TOKEN=$(cat /tmp/chat3d-token.txt)
# Pick any model id from the list
MODEL_ID=$(curl -s http://localhost/api/admin/llm-models -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['models'][0]['id'])")
# Set tier
curl -s -X PATCH "http://localhost/api/admin/llm-models/$MODEL_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"tier":"frontier"}' | python3 -m json.tool
```

Expected: response includes `"tier": "frontier"`.

- [x] **Step 6: Commit**

```bash
git add packages/backend/src/routes/admin/llm-models.routes.ts
git commit -m "admin api: accept tier on llm_models PATCH/POST, expose in GET"
```

### Task 10b: Experiment run routing override

- [x] **Step 1: Locate the experiment-runs route file**

Run: `grep -rln "experiment_runs\|ExperimentRun\|experimentRun" packages/backend/src/routes/ | head -5`
Expected: shows the file owning `POST /experiments/:id/runs` and/or `PATCH /experiment-runs/:id`.

- [x] **Step 2: Add `routingOverride` to the create + update payload validation**

Edit that file. Allow `routingOverride` as optional `string`, validate against `["auto", "force_decompose", "force_single"]`, pass through to Prisma:

```ts
const ALLOWED_OVERRIDES = new Set(["auto", "force_decompose", "force_single"]);
// ... in create/update handlers ...
if ("routingOverride" in body) {
  if (!ALLOWED_OVERRIDES.has(body.routingOverride)) {
    return res.status(400).json({ error: "routingOverride must be auto|force_decompose|force_single" });
  }
  data.routingOverride = body.routingOverride;
}
```

- [x] **Step 3: Include `routingOverride` in run list / detail responses**

Make sure `GET /experiments/:id/runs` and `GET /experiment-runs/:id` include the field (add to `select:` if needed).

- [x] **Step 4: TypeScript check**

```bash
cd packages/backend && npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/backend/src/routes/admin/experiments.routes.ts
git commit -m "admin api: accept routingOverride on experiment_runs create/update"
```

---

## Task 11: Frontend — `tier` dropdown on Models tab

**Files:**
- Modify: `packages/frontend/src/api/admin.api.ts`
- Modify: `packages/frontend/src/components/admin/ModelsTab.tsx`

- [x] **Step 1: Add `tier` to the API row type**

Edit `packages/frontend/src/api/admin.api.ts`. Find `LlmModelRow` (around line 263) and add:

```ts
export interface LlmModelRow {
  // ... existing fields ...
  tier: "frontier" | "mid" | "small" | null;
}
```

Also extend `CreateLlmModelInput`:

```ts
export interface CreateLlmModelInput {
  // ... existing fields ...
  tier?: "frontier" | "mid" | "small" | null;
}
```

- [x] **Step 2: Add the dropdown to `ModelsTab.tsx`**

Find the table header and row markup in `ModelsTab.tsx`. Add a new column header `Tier` next to the existing columns (e.g. between `Display Name` and `Cost`).

For each row, add a cell with a `<select>` (or the semantic-ui-react `<Dropdown>` already in use):

```tsx
<Table.Cell>
  <Dropdown
    value={model.tier ?? ""}
    options={[
      { key: "", text: "—", value: "" },
      { key: "frontier", text: "Frontier", value: "frontier" },
      { key: "mid", text: "Mid", value: "mid" },
      { key: "small", text: "Small", value: "small" },
    ]}
    onChange={async (_e, { value }) => {
      const patch = { tier: value === "" ? null : value };
      await updateLlmModel(token, model.id, patch);
      await reload();  // or whatever the existing refresh pattern is
    }}
    compact
    selection
  />
</Table.Cell>
```

(Match the styling/refresh pattern already used in `ModelsTab.tsx` for other editable cells.)

- [x] **Step 3: TypeScript + frontend build check**

```bash
cd packages/frontend && npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0.

- [x] **Step 4: Rebuild + smoke test in browser**

```bash
docker compose build frontend && docker compose up -d frontend
```

Open `http://localhost/admin` → Models tab. Verify the `Tier` column appears, dropdown changes persist on refresh.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/api/admin.api.ts packages/frontend/src/components/admin/ModelsTab.tsx
git commit -m "admin ui: tier dropdown on models table"
```

---

## Task 12: Frontend — `routingOverride` dropdown on experiment runs

**Files:**
- Modify: `packages/frontend/src/api/experiments.api.ts` (search for the actual filename)
- Modify: the experiments create/edit component (search via `grep`)

- [x] **Step 1: Locate the experiment API + UI files**

```bash
grep -rln "experimentRun\|/experiments/" packages/frontend/src/api/ | head -3
grep -rln "createExperimentRun\|routingOverride\|ExperimentRun" packages/frontend/src/components/admin/ 2>/dev/null | head -5
```

- [x] **Step 2: Add `routingOverride` to the API row + create payload**

In the experiments API file, find the type that mirrors `experiment_runs`. Add:

```ts
routingOverride: "auto" | "force_decompose" | "force_single";
```

And to the create payload type, the same field optional with default `"auto"`.

- [x] **Step 3: Add the dropdown to the experiment-runs edit form**

In the component file, add a per-run dropdown (next to the existing model picker, few-shot count, etc.):

```tsx
<Dropdown
  label="Routing"
  value={run.routingOverride ?? "auto"}
  options={[
    { key: "auto", text: "Auto (use decider)", value: "auto" },
    { key: "force_decompose", text: "Force decompose", value: "force_decompose" },
    { key: "force_single", text: "Force single-agent", value: "force_single" },
  ]}
  onChange={(_e, { value }) => updateRun(run.id, { routingOverride: value })}
  selection
/>
```

(Adapt to match existing per-run control styling.)

- [x] **Step 4: TypeScript + frontend build**

```bash
cd packages/frontend && npx tsc -p tsconfig.json --noEmit
docker compose build frontend && docker compose up -d frontend
```

- [x] **Step 5: Smoke test in browser**

Open the experiments create form. Verify the routing dropdown appears per run, defaults to "Auto", and persists when saved.

- [x] **Step 6: Commit**

```bash
git add packages/frontend/src/api/experiments.api.ts packages/frontend/src/components/admin/  # add the actual file paths from grep
git commit -m "admin ui: routingOverride dropdown per experiment run"
```

---

## Task 13: Set the decider purpose model in production config

**Files:**
- None to modify; this is a runtime admin step.

- [ ] **Step 1: Map the new purpose to a cheap fast model via admin UI**

Open `http://localhost/admin` → Providers/Purposes tab. Find or add a `decomposition_decision` purpose entry. Assign it to a cheap Claude (e.g. `bedrock/global.anthropic.claude-haiku-4-5` if available, else Sonnet 4.6). Set per-call `maxOutputTokens` override to ~256 (small JSON response).

Alternative if the purpose UI requires the key to exist server-side first:

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
# Get a model id for a cheap Claude:
MODEL_ID=$(curl -s http://localhost/api/admin/llm-models -H "Authorization: Bearer $TOKEN" | \
  python3 -c "import sys,json; [print(m['id']) for m in json.load(sys.stdin)['models'] if 'haiku' in m['model_name'].lower()][:1]")
# Map the purpose
curl -s -X PATCH http://localhost/api/admin/llm-purposes/decomposition_decision \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"modelId\":\"$MODEL_ID\"}" | python3 -m json.tool
```

Expected: response shows the purpose mapped to the chosen model.

- [ ] **Step 2: Set tier on existing models**

Same admin UI → Models tab. Set:
- `bedrock/global.anthropic.claude-sonnet-4-6` → `frontier`
- `vllm-gx10-02/chat3d-build123d-02-synthetic-16k` → `mid`
- `vllm-gx10/chat3d-build123d-02-synthetic-16k:ma` → `small`
- Any other Qwen3.6-27B / 27B-and-under fine-tune → `small`

(The decider treats `null` tier as `mid`, so unset values are safe but un-tuned.)

This is a one-time setup chore; no commit needed (DB state, not code).

---

## Task 14: Integration validation against experiment d8ac9bae

**Files:**
- None to modify; this is a validation run.

The cancelled experiment `d8ac9bae-3f42-4fb0-9af1-aaaa8d7cb536` is the natural validation harness. Per spec §9.2 we run three new runs on the `:ma` model and compare.

- [ ] **Step 1: Confirm backend is running with the new code**

```bash
docker compose build backend && docker compose up -d backend
sleep 5
docker compose logs backend --since 30s 2>&1 | tail -10
```

Expected: backend healthy, no startup errors.

- [ ] **Step 2: Create three new experiment runs on the `:ma` model**

Via admin UI: open experiment `d8ac9bae-...`, add three runs all on the `chat3d-build123d-02-synthetic-16k:ma` model, with `routingOverride` set to:
- Run A: `auto`
- Run B: `force_decompose`
- Run C: `force_single`

(Or via API — the curl pattern matches Task 10b's PATCH for routingOverride; consult the experiments routes file.)

- [ ] **Step 3: Start the three runs and let them complete**

Click "Start" in the admin UI per run, or trigger via the existing experiment-execution endpoint. ~30–60 min per run depending on prompt complexity.

- [ ] **Step 4: Verify the lathe handle + polar plate are routed multi-agent in the auto run**

Per spec §9.2 acceptance criterion, these two prompts should land in the auto run's multi-agent set:

```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
SELECT
  e.id,
  p.prompt,
  gt.trace->>'pipelineType' AS pipeline,
  gt.trace->>'complexityTriggerReason' AS trigger_reason,
  e.eval_score
FROM workbench_examples e
JOIN workbench_example_prompts p ON p.id = e.prompt_id
LEFT JOIN generation_traces gt ON gt.workbench_example_id = e.id
JOIN experiment_runs er ON er.id = e.experiment_run_id
WHERE er.experiment_id = 'd8ac9bae-3f42-4fb0-9af1-aaaa8d7cb536'
  AND er.routing_override = 'auto'
  AND e.prompt_id IN ('718dc253-4c47-447d-97c1-b5d385d6bfd8', '656d5a06-999d-47fc-96bf-a952dbd51b2d');
"
```

Expected: both rows show `pipeline = multi_agent`, `trigger_reason = live_decider` (or `live_decider_cached` on the second pass). If `pipeline = single_agent` instead, the decider's system prompt needs tuning — bump `DECIDER_VERSION` to invalidate cache, edit `DECIDER_SYSTEM_PROMPT`, redeploy backend, re-run the auto experiment.

- [ ] **Step 5: Cost guardrail check**

Per spec §9.3:

```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
SELECT
  count(*) AS decider_calls,
  round(sum(estimated_cost_usd)::numeric, 4) AS total_cost_usd,
  round(avg(estimated_cost_usd)::numeric, 6) AS avg_per_call_usd
FROM llm_usage_events
WHERE purpose = 'decomposition_decision'
  AND created_at > now() - interval '6 hours';
"
```

Expected: `total_cost_usd ≤ 0.50` (≤ $0.005/prompt × 100 prompts × 3 runs). If higher, swap the purpose-mapped model to a cheaper one in admin UI.

- [ ] **Step 6: Per-prompt delta query for analysis**

```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
SELECT
  left(p.prompt, 50) AS prompt,
  max(CASE WHEN er.routing_override = 'auto' THEN e.eval_score END) AS auto,
  max(CASE WHEN er.routing_override = 'force_decompose' THEN e.eval_score END) AS forced_decomp,
  max(CASE WHEN er.routing_override = 'force_single' THEN e.eval_score END) AS forced_single
FROM workbench_examples e
JOIN workbench_example_prompts p ON p.id = e.prompt_id
JOIN experiment_runs er ON er.id = e.experiment_run_id
WHERE er.experiment_id = 'd8ac9bae-3f42-4fb0-9af1-aaaa8d7cb536'
  AND er.model_label LIKE '%:ma%'
GROUP BY p.id, p.prompt
ORDER BY (max(CASE WHEN er.routing_override='force_decompose' THEN e.eval_score END) -
          max(CASE WHEN er.routing_override='force_single'   THEN e.eval_score END)) DESC NULLS LAST
LIMIT 30;
"
```

Expected: rows showing per-prompt scores across the three modes; positive delta on the `forced_decomp - forced_single` axis identifies prompts where multi-agent helps the `:ma` model.

This task has no commit — it's runtime validation. Report findings back to Daniel via Slack channel or directly.

---

## Task 15: Documentation update

**Files:**
- Modify: `docs/codegen-pipeline-and-workbench.md`
- Modify: `docs/codegen-harness-audit.md`

- [x] **Step 1: Update the pipeline doc**

Edit `docs/codegen-pipeline-and-workbench.md`. Find §3.4 (the existing multi-agent routing section). Replace its opening with:

> A run is routed to multi-agent decomposition by a four-step precedence:
>
> 1. **Per-run override** (`experiment_runs.routing_override` ∈ `auto | force_decompose | force_single`) — bypasses everything when set to `force_*`.
> 2. **Multi-part regex** (`MULTI_PART_PATTERN` in `spec-generation.service.ts`) — cheap deterministic safety net for prompts containing "snap-fit", "hinged lid", "clamshell", etc.
> 3. **Live decomposition decider** (`decomposition-decision.service.ts`) — one LLM call per generation, model-tier-aware, results cached in `decomposition_decisions` keyed by `(prompt_id, model_id)` with a `decider_version` stamp. Bumping `DECIDER_VERSION` (in code) auto-invalidates all cached rows.
> 4. **Fallback** when the decider errors — single-agent with trigger `spec_unavailable`.
>
> The previous `spec_llm_decision` trigger reason is deprecated; the spec LLM still emits `requires_decomposition` for training-data purposes but no routing code reads it.
>
> Tuning the decider's criteria is a code/prompt change with zero data migration — bump `DECIDER_VERSION` (e.g. `v1.0.0` → `v1.1.0`) when editing `DECIDER_SYSTEM_PROMPT`.

- [x] **Step 2: Update the harness audit changelog**

Edit `docs/codegen-harness-audit.md`. In §9 changelog, prepend:

> - **2026-05-19 v1.3** — N1 routing redesigned: cached `requires_decomposition` retired as authority (kept as training-data record only). Live `decomposition-decision.service.ts` makes per-generation, model-tier-aware decisions; version-stamped cache in `decomposition_decisions` table. Per-run `experiment_runs.routing_override` enables A/B ablation of decompose-vs-not on the same prompt set. Plan: `docs/superpowers/plans/2026-05-18-multi-agent-routing-redesign.md`.

- [x] **Step 3: Commit**

```bash
git add docs/codegen-pipeline-and-workbench.md docs/codegen-harness-audit.md
git commit -m "docs: document live decomposition decider + routing_override"
```

---

## Self-Review

**Spec coverage (cross-check each spec section against tasks):**
- §3 Architecture (3 layers + override) → Tasks 2, 3 (schema), 6 (decider), 7 (router), 8/9 (wiring).
- §4.1 New columns → Task 2 (migration), Task 3 (schema).
- §4.2 New table → Task 2 + Task 3.
- §4.3 New `llm_purpose_map` entry → Task 4 (purpose type) + Task 13 (admin runtime setup).
- §4.4 New shared types → Task 1.
- §5.1 Decider signature → Task 6.
- §5.2 System prompt → Task 6b (full prompt verbatim).
- §5.3 Decider model assignment → Task 13.
- §6 Routing flow → Task 7 (unified router).
- §7.1 spec-generation export → Task 5.
- §7.2 workbench-codegen wiring → Task 8.
- §7.3 query.service wiring → Task 9.
- §7.4 backfill unchanged → confirmed (no task; explicitly out of scope).
- §7.5 trace-builder unchanged → confirmed (Task 1 only adds enum values).
- §7.6 Admin UI → Tasks 10, 11, 12.
- §9.1 Unit tests → Tasks 6, 7 (vitest with cache hit/miss/error coverage).
- §9.2 Integration validation → Task 14.
- §9.3 Cost guardrail → Task 14 Step 5.
- §10 Rollout → Tasks 13 + 14.

**Placeholder scan:** No "TBD", "TODO", "similar to Task N" placeholders. The two "search if path differs" hints in Tasks 10 and 12 (route files, frontend component for experiment-runs UI) are necessary because directory layout can shift between branches — included an exact grep command to find them.

**Type consistency:**
- `ModelTier`: declared Task 1, consumed Tasks 6 (decider input), 7 (router input), 8/9 (call sites). All use `ModelTier | null`.
- `RoutingOverride`: declared Task 1, consumed Tasks 7 (router), 8/9 (call sites), 10b (route validation), 12 (UI). All use the 3-value enum.
- `ComplexityTriggerReason`: declared Task 1 with the two new values; consumed by `routeGeneration` return and forwarded to `setComplexityTriggerReason` (no change to the setter).
- `DecomposeDecisionInput.promptId`: started as `string`, changed to `string | null` in Task 9 Step 3 (chat path lacks workbench prompt UUID); the test added in Task 9 Step 3 covers the null path.
- `DECIDER_VERSION`: introduced as `const = "v1.0.0"` in Task 6a; referenced in Task 6c orchestrator + tests + the docs in Task 15.

**Naming consistency:** `decideDecomposition` (Task 6c) → consumed by `routeGeneration` (Task 7) → consumed by workbench (Task 8) and chat (Task 9). `MULTI_PART_PATTERN` exported in Task 5, imported in Task 7. `lookupCachedDecision` / `upsertDecision` consistent between Task 6a definitions and Task 6c usage.

All gaps closed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-multi-agent-routing-redesign.md`. 15 tasks total — schema + types (Tasks 1–4), decider service (Tasks 5–6), unified router (Task 7), call-site wiring (Tasks 8–9), admin API + UI (Tasks 10–12), runtime setup + validation (Tasks 13–14), docs (Task 15).

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because the tasks have clean boundaries (each ends with a commit) and the test-first structure gives natural review checkpoints.

**2. Inline Execution** — I execute tasks in this session using `executing-plans`, batch execution with checkpoints for your review every few tasks.

Which approach?
