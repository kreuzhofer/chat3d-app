# Multi-Agent Routing Redesign — Design Spec

**Status:** Approved 2026-05-18, shipped 2026-05-19.

**Amendment 2026-05-23 — `small` tier retired.** The `ModelTier` union is now `frontier | mid` only. Parameter-count-based tiering was misleading (calling a 27B fine-tune "small" doesn't reflect industry usage), and the behaviour the SMALL branch was designed for — fine-tunes that over-reason on complex single-piece prompts — is now captured empirically by the `timeout_observed` retro-routing override (see `docs/superpowers/plans/2026-05-19-failure-aware-retro-routing.md`). A model that hangs on a (prompt, model) pair gets a sticky `decompose=true` row for future runs; no a-priori tier required. `DECIDER_VERSION` bumped to `v1.1.0` to invalidate cached SMALL-tier decisions. §5.2 system prompt updated, §13.2 model-tier table no longer relevant for sub-mid models.

**Author:** chat3d-claude
**Reviewers:** Daniel

## 1. Goal

Decouple the multi-agent routing decision from the cached spec data. Today the spec LLM emits `requires_decomposition` once per prompt, the value is persisted on `workbench_example_prompts`, and every subsequent generation reads that cached value. The result: changing the decomposition criteria requires re-spec'ing all ~2.4k prompts (we just paid for that backfill and found it was wasted because the criteria themselves were wrong).

After this change: the spec cache stays as historical/training-data, but the routing decision is **live per generation**, **model-tier-aware**, and **separately cacheable on its own version stamp**. Tuning the criteria is a code/prompt change with zero data migration.

A new experiment feature lets a run force decomposition (or force single-agent) for all 100 prompts in that run, so we can A/B test "same prompts, decomposition on vs. off" without invalidating the spec cache.

## 2. Principle

**Cached spec data is documentation, not authority.** It records what the spec LLM said at time-of-spec, useful as training data for a future spec-generation model, but never the routing source-of-truth.

## 3. Architecture

Three layers, decoupled:

```
┌─────────────────────────────────────────────────────────────────┐
│  1. SPEC CACHE (unchanged behavior)                             │
│     workbench_example_prompts                                   │
│       .spec_interpretation, .construction_spec,                 │
│       .verification_checklist, .verification_criteria, ...      │
│       .requires_decomposition, .decomposition_reasoning  ◄── kept │
│                                                       as training │
│                                                       record only │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ provides interpretation as hint
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. LIVE DECOMPOSITION DECIDER (new)                            │
│     decomposition-decision.service.ts                           │
│       inputs:  { prompt_text, model_tier, spec_interpretation? }│
│       outputs: { decompose, reasoning, decider_version }        │
│       mechanism: one LLM call to new purpose                     │
│                  `decomposition_decision`                        │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ writes / reads
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. DECIDER CACHE (new table, version-stamped)                  │
│     decomposition_decisions                                     │
│       (prompt_id, model_id) UNIQUE                              │
│       + decider_version, decompose, reasoning, created_at       │
│     Cache hit only when decider_version matches current.        │
│     Bump the system prompt → next call writes a new row →       │
│     old row no longer matched.                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Per-run override** short-circuits the decider entirely:
- `experiment_runs.routing_override` enum: `auto | force_decompose | force_single`

## 4. Schema changes

### 4.1 New columns

```sql
ALTER TABLE llm_models
  ADD COLUMN tier VARCHAR(20)  -- 'frontier' | 'mid' | 'small' | NULL
  DEFAULT NULL;
COMMENT ON COLUMN llm_models.tier IS
  'Model capability tier used by the decomposition decider to set decompose thresholds.';

ALTER TABLE experiment_runs
  ADD COLUMN routing_override VARCHAR(20) NOT NULL
  DEFAULT 'auto';  -- 'auto' | 'force_decompose' | 'force_single'
COMMENT ON COLUMN experiment_runs.routing_override IS
  'Per-run override of the live decomposition decider; auto = use decider.';
```

### 4.2 New table

```sql
CREATE TABLE decomposition_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id       UUID NOT NULL REFERENCES workbench_example_prompts(id) ON DELETE CASCADE,
  model_id        UUID NOT NULL REFERENCES llm_models(id) ON DELETE CASCADE,
  decider_version VARCHAR(40) NOT NULL,  -- semver-like or sha8 of system prompt
  decompose       BOOLEAN NOT NULL,
  reasoning       TEXT NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, model_id)  -- one decision per (prompt, model); overwritten on version change
);
CREATE INDEX idx_decomp_decisions_version ON decomposition_decisions(decider_version);
```

Cache lookup: `SELECT … WHERE prompt_id=$1 AND model_id=$2 AND decider_version=$current`. Hit → use. Miss (including stale-version) → call decider, `INSERT … ON CONFLICT (prompt_id, model_id) DO UPDATE SET …`.

### 4.3 New `llm_purpose_map` entry

`decomposition_decision` purpose, mapped to a cheap fast model in admin UI (e.g. `bedrock/global.anthropic.claude-haiku-4-5` or any small fast Claude model). Configurable per-environment.

### 4.4 New shared types

Add to `packages/shared/src/trace-types.ts` (or a new `routing-types.ts` next to it):

```ts
export type ModelTier = "frontier" | "mid" | "small";
export type RoutingOverride = "auto" | "force_decompose" | "force_single";
```

Extend the existing `ComplexityTriggerReason` literal-union:

```ts
export type ComplexityTriggerReason =
  | "spec_llm_decision"      // DEPRECATED — kept for old trace compatibility
  | "multi_part_pattern"     // existing
  | "single_agent_default"   // existing
  | "spec_unavailable"       // existing (used for decider errors now too)
  | "forced_override"        // existing — used by experiment_runs.routing_override != auto
  | "live_decider"           // NEW — live LLM call, not cached
  | "live_decider_cached";   // NEW — live LLM call result reused from cache
```

`spec_llm_decision` is kept in the type for backward-compat of pre-existing traces but is no longer emitted by new code.

## 5. The decider service

### 5.1 Signature

```ts
// packages/backend/src/services/decomposition-decision.service.ts

export const DECIDER_VERSION = "v1.0.0";  // bump to invalidate cache

export interface DecomposeDecisionInput {
  promptId: string;
  promptText: string;
  modelId: string;
  modelTier: ModelTier | null;  // null treated as 'mid'
  specInterpretation?: string;  // optional hint
}

export interface DecomposeDecisionResult {
  decompose: boolean;
  reasoning: string;
  triggerReason: "live_decider" | "live_decider_cached";
  deciderVersion: string;
}

export async function decideDecomposition(
  input: DecomposeDecisionInput,
): Promise<DecomposeDecisionResult>;
```

Internally:
1. Check `decomposition_decisions` for matching `(prompt_id, model_id, decider_version == DECIDER_VERSION)`. If hit, return cached row, `triggerReason: "live_decider_cached"`.
2. Otherwise call LLM via `tracked-llm` for purpose `decomposition_decision`.
3. Parse `{decompose, reasoning}` from JSON response. Upsert row. Return `triggerReason: "live_decider"`.

### 5.2 System prompt (sketch)

```
You decide whether a 3D CAD prompt should be routed to a multi-agent decomposition pipeline
or a single-agent codegen pipeline. Multi-agent breaks the model into 2-6 sub-parts that are
designed independently and then assembled. It's more expensive (~2-3× tokens) but helps when
a model would otherwise fail to produce coherent geometry in one pass.

You will receive:
- the user's prompt
- the target model's TIER ∈ { frontier, mid, small }
- (optionally) the spec LLM's interpretation of the prompt

Decision rules — calibrated PER TIER:

FRONTIER (Claude Sonnet/Opus, GPT-4+, etc.):
  Decompose ONLY when the prompt has clearly multiple independently-designable assembled parts
  with mating geometry (snap-fit lid, hinged door, separate body+arm with interface points).
  These models handle complex single-piece geometry solo. Lathe profiles, organic shapes,
  dense feature counts on one body → single-agent.

MID (mid-tier OSS, larger fine-tunes that aren't tool-trained):
  Decompose for:
  - Clear multi-part objects with mating geometry
  - Single-piece prompts with ≥4 distinct geometric operations (revolved profile + grooves +
    fillets + holes, etc.)
  Otherwise single-agent.

SMALL (small fine-tunes like chat3d-build123d-02-synthetic-16k:ma, 27B-and-under):
  Decompose more eagerly. Decompose for:
  - Clear multi-part objects
  - Single-piece prompts with revolved/lathe profiles + surface features (grooves, knurling)
  - Organic/sculpted shapes
  - Dense polar or linear arrays (≥6 repeats) — these often fail in one shot
  - Any prompt with ≥3 distinct geometric features beyond a primitive

Return ONLY a JSON object:
  { "decompose": boolean, "reasoning": "one sentence, max 20 words" }
```

### 5.3 Decider model assignment

Default: a cheap, fast Claude (Haiku 4.5 or Sonnet 4.6) via Bedrock. Admin can swap via `llm_purpose_map` UI. Per-call cost target: ≤ $0.005. Latency target: ≤ 2s.

## 6. Routing flow (every generation, every path)

Pseudocode for the unified routing — same on workbench and chat:

```
function routeGeneration(ctx):
  # 1. Per-run override (experiment_runs.routing_override)
  if ctx.experimentRunId:
    override = lookupRoutingOverride(ctx.experimentRunId)
    if override == "force_decompose":
      traceBuilder.setComplexityTriggerReason("forced_override")
      return { useMultiAgent: true }
    if override == "force_single":
      traceBuilder.setComplexityTriggerReason("forced_override")
      return { useMultiAgent: false }
    # override == "auto" → fall through

  # 2. Multi-part regex safety net (cheap, deterministic, no API cost)
  if MULTI_PART_PATTERN.test(ctx.prompt):
    traceBuilder.setComplexityTriggerReason("multi_part_pattern")
    return { useMultiAgent: true }

  # 3. Live decider (with version-stamped cache)
  try:
    model = lookupModel(ctx.modelId)
    decision = await decideDecomposition({
      promptId: ctx.promptId,
      promptText: ctx.prompt,
      modelId: ctx.modelId,
      modelTier: model.tier,
      specInterpretation: cachedSpec?.interpretation,
    })
    traceBuilder.setComplexityTriggerReason(decision.triggerReason)
    return { useMultiAgent: decision.decompose }
  except err:
    # 4. Fallback: decider unavailable → single-agent (regex already ruled out)
    logger.warn({err}, "decomposition decider failed; falling back to single-agent")
    traceBuilder.setComplexityTriggerReason("spec_unavailable")
    return { useMultiAgent: false }
```

The decider call is **fire-once-per-generation** — it's only at routing time, not inside the agent loop, so no cumulative latency risk.

## 7. What changes in existing code

### 7.1 `spec-generation.service.ts`

`resolveComplexityFromSpec()` and `deriveComplexity()` keep existing signatures (back-compat) but are **no longer the authority for multi-agent routing**. The spec LLM still emits `requires_decomposition` (we want the training data), and `resolveComplexityFromSpec` still resolves the legacy 3-state `complexity` field. But the workbench/chat routing paths now call `decideDecomposition()` instead of branching on `complexity === "complex"`.

`MULTI_PART_PATTERN` regex stays in this file, exported for reuse by the router.

### 7.2 `workbench-codegen.service.ts`

Replace the current routing block (around line 448 where `setComplexityTriggerReason("forced_override")` / `resolveComplexityFromSpec()` are called) with the unified `routeGeneration()` flow from §6. Remove the read of `specResult.requiresDecomposition` for routing purposes — but keep writing it on cache write so the training-data record stays current.

### 7.3 `query.service.ts`

Same as 7.2: replace lines ~1463–1470 with the unified router. Chat path has no `experimentRunId` so the override branch is skipped automatically.

### 7.4 `workbench-backfill-specs.service.ts`

Unchanged — keeps writing `requires_decomposition` + `decomposition_reasoning` during backfill, because those fields remain useful as training data for a potential future spec-generation fine-tune.

### 7.5 `trace-builder.service.ts`

No change to the setter itself; just consumes the two new enum values that the router emits.

### 7.6 Admin UI

- **Provider/Models tab:** new `tier` dropdown per row (frontier / mid / small / unset). Defaults to "unset" → decider treats as `mid`.
- **Experiment create/edit form:** per-run `routing_override` dropdown (auto / force_decompose / force_single). Default `auto`.
- **Pipeline analytics:** existing `complexityTriggerReason` chart picks up the two new enum values automatically.

## 8. Out of scope (deliberate)

- **Migration of existing `requires_decomposition` data** — kept as training record, no transformation. New columns are additive.
- **Per-prompt routing override.** If you ever need it for one-off chat-side experimentation, the existing chat path can take a request-body flag — separate plan.
- **Decider self-training loop** — using the eval outcomes to retrain the decider's system prompt automatically. Future plan, after we have decider decision data accumulated.
- **Retiring the `multi_part_pattern` regex** — it stays as the cheap deterministic backstop. The decider should agree with it on those prompts; if it routinely disagrees we revisit.
- **Tiering of fine-tuned variants** — `:ma` variants inherit the base model's tier unless admin sets otherwise.

## 9. Testing strategy

### 9.1 Unit tests

- `decomposition-decision.service.test.ts`:
  - Cache hit returns `live_decider_cached`, no LLM call.
  - Cache miss writes new row.
  - Version stamp mismatch treated as cache miss (writes new row, overwrites old via `ON CONFLICT`).
  - LLM error rethrows so caller can fall back.
- Router unit test:
  - `routing_override: force_decompose` → returns `useMultiAgent: true`, never calls decider.
  - `routing_override: force_single` → returns `useMultiAgent: false`, never calls decider.
  - `routing_override: auto` + regex match → returns true, never calls decider.
  - `routing_override: auto` + no regex match → calls decider.
  - Decider error → returns `useMultiAgent: false`, trigger `spec_unavailable`.

### 9.2 Integration validation

Re-run the cancelled experiment `d8ac9bae-3f42-4fb0-9af1-aaaa8d7cb536` on the `chat3d-build123d-02-synthetic-16k:ma` model (tier: `small`), three runs:
1. `routing_override: auto` — see what the new decider routes.
2. `routing_override: force_decompose` — full multi-agent on all 100 prompts.
3. `routing_override: force_single` — original behavior, single-agent on all 100.

Compare per-prompt deltas. The lathe handle (`718dc253`) and polar plate (`656d5a06`) should be in the auto run's multi-agent set; if not, the decider system prompt needs tuning.

### 9.3 Cost guardrail

Verify total decider cost on the 100-prompt run is ≤ $0.50 (≤ $0.005/prompt). If higher, swap to a cheaper purpose model.

## 10. Rollout

1. Migration + decider service + tests merged behind no flag (decider only fires when called; old read of `requires_decomposition` removed in same change).
2. Admin sets `tier` on existing models (5-min chore; defaults to `mid` if unset).
3. Validation runs above.
4. If validation good → no further action. The system is live for all paths.
5. If validation bad → tune the decider system prompt, bump `DECIDER_VERSION`, cache auto-invalidates on next call.

## 11. Open questions for the implementer

None blocking. The few things deliberately left to implementation taste:
- Exact format of `DECIDER_VERSION` (semver vs. sha8 of the system prompt). Either works.
- Whether the per-run override UI is a dropdown or a 3-button toggle. Pick what feels natural.
- Cleanup policy for stale `decomposition_decisions` rows (different `decider_version`). Likely a separate admin operation; the unique constraint on `(prompt_id, model_id)` means stale rows get overwritten on next call rather than accumulating, so cleanup is low-priority.
