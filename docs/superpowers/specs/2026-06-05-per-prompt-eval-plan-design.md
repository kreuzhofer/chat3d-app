# Per-Prompt Eval Plan — Design

**Date:** 2026-06-05
**Status:** Draft (awaiting user review)
**Source:** Brainstorming session following render-error classification recovery. Targets the audit's visual-eval correlation = 0.14 finding for PCB Cases (`docs/codegen-harness-audit.md:526,538-539,587`) but reframes the fix from per-category to **per-prompt**.

## Motivation

The eval pipeline today applies one shared VLM system prompt to every workbench example, then combines visual and code scores with a single global `code_eval_weight` (default 0.4) and a ±4 disagreement clamp. For prompts whose features are largely dimensional or hidden inside the object — PCB enclosures, threaded bores, internal standoffs — the VLM is asked to verify things it can't see, scores them as low-confidence misses, and the clamp drags the composite down. This is the mechanical explanation for the audit's −1.20 visual-vs-code gap on PCB Cases.

Per-category overrides would patch the symptom. The right unit is **the prompt**: each prompt's spec already names its features and which are visually verifiable; the eval system should derive its rubric, its inspection plan, and its weighting from that.

**Goal:** extend the spec LLM to emit a per-prompt `evalPlan = {systemPrompt, inspectionPlan, suggestedCodeWeight}` and wire the eval pipeline to consume it. Existing prompts without eval_plan keep working unchanged.

## Non-goals

- **No render-pipeline changes.** Section cuts, lid-removed views, arbitrary camera angles are Phase 2 — a separate spec. This spec only selects subsets of the existing 10 stored angles.
- **No spec regeneration backfill.** Existing prompts keep `eval_plan = null` and use the legacy global pipeline. Only the test set in §7 gets regenerated for measurement.
- **No new screenshot kinds.** The 10 existing angles are the universe; the inspection plan picks subsets.
- **No multi-VLM consensus.** Single VLM model continues; we're changing what we ask it, not how many ask.
- **No per-category overrides.** The whole point is to skip the category layer. If we later need category-level defaults, they can sit in front of the per-prompt path as a fallback layer.
- **No auto-rollback if the test fails.** Eval_plan is additive; bad results inform iteration on the spec LLM template, not removal of the field.

## Architecture / data flow

```
Prompt ──► Spec LLM (extended) ──► {spec, checklist, criteria,
                                      assertions,
                                      evalPlan: {                    ← NEW
                                        systemPrompt,
                                        inspectionPlan,
                                        suggestedCodeWeight
                                      }
                                   }
                                            │
                                            ▼
                         Persist on workbench_example_prompts (new eval_plan JSONB)
                                            │
              ┌─────────────────────────────┼───────────────────────────┐
              ▼                             ▼                           ▼
        Code review                   VLM eval                Composite weight
        (unchanged)                       │                            │
                                          ▼                            ▼
                                build prompt = evalPlan.systemPrompt
                                + minimal static scaffold
                                          │
                                          ▼
                                filter images by inspectionPlan.angles
                                ∩ critical-angles from code reviewer
                                          │
                                          ▼
                                composite uses evalPlan.suggestedCodeWeight
                                if present, else current adaptive→global chain
                                ±4 clamp gated by effective weight
```

Three persisted artifacts (the eval_plan fields), three composite-pipeline consumers (VLM prompt builder, image selector, composite weight resolver). No render-pipeline changes, no schema migration on `workbench_examples`, no new screenshots.

## Schema

One additive Prisma migration on `workbench_example_prompts`:

```sql
ALTER TABLE "workbench_example_prompts"
  ADD COLUMN "eval_plan" JSONB NULL;

CREATE INDEX "idx_wb_prompts_eval_plan_weight"
  ON "workbench_example_prompts" ((eval_plan->>'suggestedCodeWeight'))
  WHERE eval_plan IS NOT NULL;

COMMENT ON COLUMN "workbench_example_prompts"."eval_plan" IS
  'Per-prompt eval plan emitted by the spec LLM: {systemPrompt, inspectionPlan, suggestedCodeWeight}. Null = use legacy global eval pipeline.';
```

Prisma side: `WorkbenchExamplePrompt.evalPlan Json? @map("eval_plan") @db.JsonB`.

A second small migration on `workbench_examples` for the audit field:

```sql
ALTER TABLE "workbench_examples"
  ADD COLUMN "composite_weight_source" VARCHAR(20) NULL
    CHECK ("composite_weight_source" IS NULL OR
           "composite_weight_source" IN ('eval_plan', 'adaptive', 'global'));
```

Prisma side: `WorkbenchExample.compositeWeightSource String? @map("composite_weight_source") @db.VarChar(20)`.

**Rationale for JSONB on eval_plan:**
- Shape is small (≤2 KB per row), nested, consumed as a unit
- All-or-nothing semantics: three nullable columns would imply partial population is meaningful, which it isn't
- Future schema evolution (adding fields) doesn't need migrations
- Partial index on `suggestedCodeWeight` lets us analyze "all prompts with high code weight" without re-scans

**Backwards compat:** every existing prompt has `eval_plan = NULL`. The consumer code (VLM + composite) treats NULL as "use the legacy global pipeline" — exactly today's behaviour. No backfill required.

## Spec generator extension

The spec generator at `packages/backend/src/services/spec-generation.service.ts` builds a structured request to the spec LLM. The response shape gains one nested object:

```ts
evalPlan: {
  systemPrompt: string;              // 1500-3000 char VLM wrapper for THIS prompt
  inspectionPlan: {
    angles: Array<                   // Strict subset of the 10 stored angles
      "front" | "back" | "left" | "right" |
      "top" | "bottom" | "ortho_45" | "ortho_45_bottom" |
      "isometric" | "isometric_back">;
    focus?: Record<string, string>;  // angle name → inspection note for that angle
  };
  suggestedCodeWeight: number;       // 0.0–1.0
}
```

### Prompt template additions

Two paragraphs added to the spec system prompt template:

**Paragraph 1 — what eval_plan is:**

> Also emit an `evalPlan` object describing how to evaluate the rendered output of this prompt. The pipeline will use it to (a) build the VLM system prompt, (b) decide which render angles to send to the VLM, (c) decide how to weight visual vs code scores in the composite. Existing global defaults apply when no eval_plan is emitted.

**Paragraph 2 — guidance per field:**

- **`systemPrompt`** — Write a 1500-3000 character system prompt for a VLM tasked with evaluating renders of THIS prompt. Describe what features it should verify visually vs which it should defer to code-eval. Call out occlusions, ambiguous angles, and prompt-specific calibration. Do not restate generic score bands or JSON output instructions — those are wrapped in by the runtime.
- **`inspectionPlan.angles`** — List the smallest sufficient set of render angles. Default to 3 for simple shapes; up to 8 for complex assemblies. Prefer isometric over orthographic when both could work.
- **`inspectionPlan.focus`** — Optional per-angle notes. Use only when one specific angle has a specific verification job (e.g., "isometric_back: verify port cutouts on the +Y wall").
- **`suggestedCodeWeight`** — 0.2-0.4 when most checklist items are visual (vents, surface patterns, color, profile). 0.5-0.7 for balanced prompts (dimensions + visual features). 0.8-0.95 for prompts where most features are dimensional, hidden, or inside the object (sealed enclosures, threaded bores, internal standoffs).

### Persistence

`spec-generation.service.ts` writes `eval_plan` as JSONB on the `workbench_example_prompts` row, alongside the existing spec/checklist/criteria/assertions fields. The existing persistence function (the one used after the `b74b68c` "Re-run spec generation when training fields are missing on cache hit" commit) gets one more field.

### Validation

A Zod schema validates the eval_plan shape on the response path:
- `systemPrompt` non-empty string
- `inspectionPlan.angles` non-empty array of allowed string literals
- `inspectionPlan.focus` (if present) — record where every key is in `inspectionPlan.angles`
- `suggestedCodeWeight` number in [0, 1]

If validation fails: log a warning, persist the rest of the spec normally with `eval_plan = null`. **No retry.** Consumers fall back to legacy global pipeline.

### Cost / latency

Zero added LLM calls. One more nested object in the same spec response, ~300-500 extra output tokens. Negligible cost (<$0.005 per prompt at current model rates) and no measurable latency change.

## VLM eval changes

Files: `packages/backend/src/services/visual-eval-prompt.service.ts`, `packages/backend/src/services/visual-eval.service.ts`, `packages/backend/src/services/eval-orchestrator.service.ts`.

### Dynamic VLM prompt builder

`buildEvaluationSystemPrompt` gains an optional `evalPlan` parameter. Today the function returns one monolithic prompt. We split it into three reusable helpers:
- `staticScaffoldHeader()` — VLM role, image-list preamble, anti-hallucination guard
- `staticScaffoldFooter()` — score bands (5 levels), JSON output schema, cross-view evidence instruction, zoom-tool affordance description
- `legacyDynamicMiddle(userPrompt, categoryName, complexity, ...)` — the existing rubric paragraph + per-checklist context + generic occlusion warning

When `evalPlan?.systemPrompt` is present:

```ts
return staticScaffoldHeader()
     + "\n\n"
     + evalPlan.systemPrompt
     + "\n\n"
     + staticScaffoldFooter();
```

When not present:

```ts
return staticScaffoldHeader()
     + "\n\n"
     + legacyDynamicMiddle(userPrompt, categoryName, complexity, ...)
     + "\n\n"
     + staticScaffoldFooter();
```

Both paths share the same static scaffolds — no drift risk between legacy and dynamic.

### Image selection (the inspection plan)

`eval-orchestrator.service.ts:310-326` selects images via `criticalAngles` returned by the code reviewer. We add the spec's inspection plan as a precondition filter:

```ts
const allAngles = ["front","back","left","right","top","bottom","ortho_45","ortho_45_bottom","isometric","isometric_back"];
const candidateAngles = evalPlan?.inspectionPlan?.angles ?? allAngles;
const filteredAngles = criticalAngles
  ? candidateAngles.filter(a => criticalAngles.includes(a))
  : candidateAngles;

// Defensive: if intersection is empty (shouldn't happen) fall back to the spec's set
const finalAngles = filteredAngles.length > 0 ? filteredAngles : candidateAngles;
```

The spec narrows the universe; the code reviewer can narrow further at runtime. The intersection-empty case shouldn't happen (the code reviewer wouldn't emit angles outside the actual screenshot set), but the defensive fallback prevents the rare case where it would produce zero images.

### Per-angle focus notes

When `evalPlan.inspectionPlan.focus[angle]` is set, prepend a one-line context label to the image in the VLM message:

```
[isometric_back] verify port cutouts on the +Y wall: <image>
```

If `focus` is unset for an angle, the message uses just the bare angle name (current behaviour).

### Zoom tool

Existing zoom follow-up at `eval-orchestrator.service.ts:363-391` runs unchanged. It operates on whichever images we passed in. With a smaller inspection plan, fewer zoom candidates are eligible — fine, since zoom was always a follow-up rather than a first-line eval.

### Cost / latency

Same VLM model, same input image budget (or smaller — primitives can be sent with 3 images instead of 8). Marginal cost: image tokens × (current_angles − chosen_angles) per call. For primitives this is a saving; for sealed enclosures it's unchanged.

## Composite weight changes

File: `packages/backend/src/services/code-eval-composite.service.ts`. The chokepoint resolver lives at `eval-orchestrator.service.ts:44` (`getCodeEvalWeight(pipeline)`).

### Weight resolution chain

```ts
function resolveCodeEvalWeight(
  pipeline: "workbench" | "chat",
  evalPlan: EvalPlan | null,
  annotatedCriteria: AnnotatedCriterion[] | null,
): { weight: number; source: "eval_plan" | "adaptive" | "global" } {
  // 1. Highest priority: spec-emitted per-prompt weight
  if (evalPlan?.suggestedCodeWeight !== undefined) {
    return { weight: clamp(evalPlan.suggestedCodeWeight, 0, 1), source: "eval_plan" };
  }

  // 2. Legacy adaptive shim from annotated criteria
  if (annotatedCriteria) {
    return {
      weight: computeAdaptiveWeight(
        getCodeEvalWeight(pipeline),
        annotatedCriteria,
        ADAPTIVE_WEIGHT_RANGE,
      ),
      source: "adaptive",
    };
  }

  // 3. Bare global default
  return { weight: getCodeEvalWeight(pipeline), source: "global" };
}
```

`computeAdaptiveWeight` and the per-pipeline global stay as fallbacks — no behaviour change for prompts without eval_plan.

### The ±4 disagreement clamp

Today the clamp at `code-eval-composite.service.ts:114-116` fires whenever `|visual − code| ≥ 4`. Gate it on effective weight:

```ts
const HIGH_CODE_WEIGHT_THRESHOLD = 0.75;

const shouldClamp = effectiveCodeWeight < HIGH_CODE_WEIGHT_THRESHOLD;
const composite = shouldClamp && Math.abs(visualScore - codeScore) >= 4
  ? Math.min(visualScore, codeScore) + 1
  : weightedAverage(visualScore, codeScore, effectiveCodeWeight);
```

**Rationale:** when the spec explicitly says "trust code 75%+ for this prompt", the system has already de-weighted visual. The clamp on top would double-count the disagreement and reverse course. Below the threshold the clamp remains the safety net it is today.

`HIGH_CODE_WEIGHT_THRESHOLD = 0.75` is a starting value; the test set in §7 informs whether it should move.

### Persistence of which weight path fired

`composite_weight_source` (the new VARCHAR(20) column on `workbench_examples`) records which branch produced the score. Lets §7 split results by path. Eventually feeds analytics into the admin UI (out of scope for this spec).

### Backwards compat

- Existing prompts (`eval_plan = null`) → resolver returns from the adaptive or global branch → existing behaviour.
- Existing examples keep their historical composite scores. No re-eval is triggered by shipping this change. Manual re-evals (the workbench's existing "regenerate" or "re-evaluate" flows) pick up the new logic.

## A/B test methodology

No backfill, so we measure impact by re-evaluating a hand-picked test set after regenerating their specs.

### The test set: ~30 prompts spanning the dimensions that matter

| Dimension | Why | Count |
|---|---|---|
| PCB Cases (the problem) | Canonical sealed-enclosure case — visual correlation 0.14 | 8 |
| Primitives (regression check) | Visually unambiguous — must not degrade | 4 |
| Boolean Operations (mid-complexity) | Mixed visual + dimensional checks | 4 |
| Hinges (mechanism, suspected false-positives) | Sanity-check that visual underrating gets corrected too | 4 |
| Generic Enclosures (sibling of PCB Cases) | Verifies the fix generalizes beyond PCB | 4 |
| bd_warehouse Examples (complexity-7) | Different complexity profile, similar near-miss bucket | 3 |
| Extrusions (control — visual-friendly) | Should self-select low code weight; not over-correct | 3 |

Within each bucket, pick a mix of `auto_approved`, `pending`, and `rejected` so we see deltas across the distribution, not just movement off a floor.

The chosen 30 prompt IDs go to `docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt` as an artifact of the spec, updated when the implementation plan runs.

### Measurement

For each test prompt, before/after on three quantities (using the prompt's best existing example as the unit of measurement):

1. **Composite score** — directly comparable
2. **Visual-code gap** (`|visualScore − codeScore|`)
3. **Whether the ±4 clamp fired** — boolean per evaluation

The `composite_weight_source` column splits results by which path produced the new score.

### Execution protocol

1. Identify the 30 prompt IDs.
2. Regenerate spec for each. Cost: 30 × ~$0.05 ≈ **$1.50**.
3. Re-evaluate the best existing example for each (no regeneration; reuses existing render + screenshots). Cost: 30 × ~$0.03 ≈ **$0.90**.
4. Pull the old + new (composite, visual, code, source, weight) into a small markdown report committed to `docs/superpowers/specs/2026-06-05-eval-plan-test-results.md`.

Total test cost: **~$3** + ~30 min wall time.

### Success criteria

- **PCB Cases:** mean composite up by ≥ 1.0; mean visual-code gap shrinks; zero PCB prompts regress.
- **Primitives:** mean composite unchanged ± 0.3 (regression check).
- **Boolean / Extrusions / bd_warehouse:** at least neutral; ideally small lift on the near-miss bucket.
- **Hinges:** unchanged or slightly higher — this category is suspected of visual false-*positives*; spec LLM should be more skeptical, possibly producing slightly lower visual scores. Either direction is informative.

### Failure modes and what they point to

- PCB composite flat or down → inspect actual `evalPlan.suggestedCodeWeight` values. If they're not in the 0.8-0.95 band, the spec LLM template needs more concrete examples.
- Primitives drop → the dynamic VLM prompt is over-tight; loosen the guidance.
- Spec LLM emits low code weight for PCB and high for primitives → template needs concrete weighting examples per geometry class.

Each failure mode points to a specific knob in the spec template, not back to "the design is wrong".

### What "we ship it" means here

The change is additive. Existing prompts keep `eval_plan = null` and unchanged behaviour. Even if the test results are mixed, the eval_plan field is safe to ship in production — it only affects prompts with explicitly emitted plans, and the spec template can be iterated independently of the consumer wiring.

## Success criteria for the spec (overall)

- Schema migration applied; `eval_plan` column populated on new spec generations
- Spec LLM template produces well-formed `evalPlan` (Zod validation passes) on ≥ 90% of new prompts
- VLM eval correctly uses dynamic prompt when present, legacy when not
- Composite weight respects per-prompt `suggestedCodeWeight` when present
- ±4 clamp suppressed when effective code weight ≥ 0.75
- `composite_weight_source` column populated on new evaluations
- A/B test report committed showing PCB Cases mean composite up ≥ 1.0 and primitives unchanged ± 0.3

## Follow-ups enabled (not in scope)

- **Phase 2: section/cutaway/part-isolated views** — the *actual* fix for sealed-enclosure occlusion. Requires render-pipeline changes (Build123d service accepts section-plane parameters; schema migrates from 10 fixed screenshot columns to a flexible JSONB array). Separate spec; ~2-3 weeks. Compounds with this spec — eval_plan inspection plan extends naturally to "section_z_10" / "lid_hidden" angle names.
- **Promote `composite_weight_source` analytics into the admin UI** — surface in the data-quality endpoint or a new admin tab so we can see which prompts use which path in aggregate.
- **Backfill `eval_plan` for the rest of the workbench** — when we're confident the spec template is stable, regenerate spec across all ~2000 prompts (~$100-400). Should follow at least one cycle of test+iteration on the template.
- **Tune `HIGH_CODE_WEIGHT_THRESHOLD`** — currently 0.75 by intuition; the test data tells us whether to move it.
- **Per-prompt acceptance threshold** — today the auto-approve cutoff is global (7.5). Eval_plan could emit a per-prompt threshold for the auto-approve gate. Out of scope for this spec because it would change which prompts get flagged, not how they're scored.
