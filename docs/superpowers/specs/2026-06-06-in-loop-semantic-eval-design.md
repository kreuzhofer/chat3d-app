# In-Loop Semantic Eval — Design

**Date:** 2026-06-06
**Status:** Draft (awaiting user review)
**Source:** Architectural discussion that emerged from the v3 A/B retest: the codegen agent currently sees structured semantic eval signal almost entirely AFTER `submit_result`, mirroring an architecture where tests run only after the developer has stopped writing code. For complex multi-part prompts (especially decomposed multi-agent generations), discrete checklist items would benefit from being verifiable INSIDE the agent loop — analogous to how Claude uses tests during normal coding tasks.

## Motivation

The codegen agent already has `evaluate_model` (VLM against full prompt) and `evaluate_code` (assertion check + code review LLM against full spec) available as in-loop tools. The gap is granularity:

- Current eval tools score the WHOLE thing against the WHOLE prompt. There's no "did THIS feature pass?" tool — only "the overall thing scored 6/10."
- Agents often submit without strategic use of even the existing tools, relying on the post-submit eval as the safety net.
- Multi-agent decomposition has no per-sub-task verification: each sub-agent reports completion to the assembler, which composes blind. Compound failures (one sub-component wrong; everything downstream wrong) are common in mechanism/assembly prompts (Hinges −1.73 in the v1 A/B, before subsequent template improvements).

Diagnostic evidence: the five worst-performing test-set prompts each had discrete, individually-checkable spec items that failed silently — missing standoffs, wrong port positions, missing hub, wrong drive type, leaves not coplanar. Mid-loop per-item verification would have surfaced each.

**Goal:** add a per-checklist-item eval tool to the agent's toolset, and use it as a FORCED verification gate at the sub-agent → assembler boundary in multi-agent decomposition. Single-agent prompts get the tool but no force. Post-submit eval remains the canonical scoring; this is advisory in-loop signal.

## Non-goals

- **No replacement of post-submit eval.** Composite scoring (visual + code, weighted by eval_plan) remains the canonical signal. In-loop verification is advisory.
- **No forced gating for single-agent prompts.** Single-agent gets the tool; agent decides when to use it. Forced behavior is multi-agent-only because that's where the compound-failure risk lives.
- **No new render angles or render-pipeline changes.** Reuses existing 10 stored angles and the most-recent render cache.
- **No retry/re-route of failing sub-components in the assembler.** Best-effort assembly. The assembler logs verification failures and proceeds; the existing post-submit eval surfaces the consequence. A future iteration could add sub-component retry.
- **No per-checklist-item eval added to the post-submit pipeline.** That would change the canonical scoring function and confound A/B measurements. Mid-loop only.
- **No automatic re-render between fix attempts.** Agent still has to call `validate_and_render` like today; verification reuses the cached screenshots.

## Architecture / data flow

```
                        Single-agent (existing path + new tool)
                        ────────────────────────────────────────
  Prompt ─► Spec ─► Agent loop ─► submit_result ─► Post-eval (unchanged)
              │       │
              │       ├── existing: evaluate_model, evaluate_code, validate_and_render
              │       └── NEW: evaluate_checklist(item_indices) — focused per-item eval
              │
              └── verificationChecklist (already exists per-prompt)

                        Multi-agent (forced milestone added)
                        ─────────────────────────────────────
  Spec ─► decomposePrompt ─► components: [{name, description, componentChecklist}]
                                            │
                                            ▼
       ┌─── sub-agent₁ ─── component checklist + evaluate_checklist tool ─┐
       │     │                                                             │
       │     └── submit gated on FORCED evaluate_checklist                  │
       │        (all items must PASS or UNCERTAIN; FAIL blocks)             │
       │                                                                   │
       ├─── sub-agent₂ ─── …                                              ─┤
       ├─── sub-agentₙ ─── …                                              ─┤
                                                                           │
                                                                           ▼
                  Assembler receives sub-outputs + verification metadata
                  (failed items flagged but composition proceeds best-effort)
                                                                           │
                                                                           ▼
                                                          Post-eval (unchanged)
```

## Components

### 1. `evaluate_checklist` agent tool

Registered in `packages/backend/src/services/agent-tools.service.ts` alongside `evaluate_model` and `evaluate_code`.

**Schema:**
```ts
tools.evaluate_checklist = {
  type: "function",
  description:
    "Verify specific verification-checklist items against the current rendered model. " +
    "Use when you want focused feedback on individual features — much cheaper and clearer than " +
    "evaluate_model which scores the whole thing. Call after a successful render. " +
    "Pass the indices of items you want to verify; omit to verify ALL items.",
  inputSchema: zodSchema(z.object({
    itemIndices: z.array(z.number()).optional(),
  })),
  execute: async ({ itemIndices }) => { ... },
};
```

**Returned format (formatted text the agent reads):**

```
Item 0 [VISUAL]: "Does the model have exactly 4 through-holes?"
  PASS — front view and top view confirm 4 distinct through-holes at the corners.

Item 1 [CODE]: "All 4 standoffs are positioned at ±50mm from center"
  FAIL — standoff_x=±47.5 in the code, but spec requires ±50. (Off by 2.5mm.)

Item 2 [BOTH]: "The lid is inverted with flat top facing down"
  UNCERTAIN — code uses Pos(lid_cx,0,lid_thick/2) which is right-side-up. Lid has no
  features so visual cannot confirm orientation. Treat as fail and add explicit
  rotation if your spec requires it.
```

**Per-item dispatch based on `visibility`:**

| visibility | Mechanism |
|---|---|
| `visual` | Focused VLM call: single item, 1-3 image subset of `evalPlan.inspectionPlan.angles`. Prompt: "Does this image show: <item>? Answer PASS/FAIL/UNCERTAIN + 1-3 sentences." |
| `code` | Focused code-eval call: code-review LLM with a minimal prompt and the single item as the question. "Does the code satisfy: <item>? Answer PASS/FAIL/UNCERTAIN + 1-3 sentences." |
| `both` | Run both; combine. `PASS` only if both PASS; any `FAIL` → `FAIL`; otherwise `UNCERTAIN`. |

**Cost model:**

| Operation | Approx cost | Latency |
|---|---|---|
| 1 visual item | ~$0.005 | ~2-4s |
| 1 code item | ~$0.005 | ~2s |
| 1 both item | ~$0.010 | ~4-5s |
| Typical checklist (3-6 items, mixed) | ~$0.03-0.05 | ~10-15s |

Cheaper than `evaluate_model` (~$0.05-0.10) because per-item prompts are smaller and each VLM call uses 1-3 images instead of 8.

**Step budget:** each call counts as one agent step. The existing `max-steps` cap is the natural budget. System prompt guidance: "verify discrete features before submitting, not on every change."

**Render cache:** uses the most-recent cached screenshots from `deps.getLastRenderedFiles()`. No automatic re-render. Agent must `validate_and_render` first if stale.

### 2. `componentChecklist` extension in decomposition

`decomposePrompt` (in `packages/backend/src/services/agent-multi.service.ts:59`) is extended to emit a per-component checklist alongside the existing `name` and `description`.

**Schema:**
```ts
{
  components: [
    {
      name: "body",
      description: "The hollow rectangular enclosure with port cutouts on the +Y short wall. ...",
      componentChecklist: [
        { item: "The body is a hollow box, not a solid block", visibility: "visual" },
        { item: "Four standoff cylinders are present at the floor corners", visibility: "both" },
        { item: "Wall thickness is 2mm", visibility: "code" },
        { item: "Port cutouts pierce one side wall (not the floor or top)", visibility: "visual" },
      ],
    },
    {
      name: "lid",
      description: "...",
      componentChecklist: [ ... ],
    },
  ],
}
```

Each item ≤ 1 sentence, 3-6 items per component, visibility annotated using the same rules as the parent's `verificationChecklist`.

**Prompt template addition (appended to `decomposePrompt` system prompt):**

> For each component, ALSO emit a `componentChecklist` — 3–6 short verification items that this component ALONE (before assembly) must satisfy. Each item should be checkable against just this component's geometry, not the assembled whole. Annotate each item with `visibility: "visual" | "code" | "both"` using the same rules as the top-level verificationChecklist. Include items that catch failures specific to this component's role (e.g. "is hollow", "has N standoffs", "wall thickness X mm"). Do NOT include items that depend on the relationship between components (e.g. "lid sits inverted next to body" — that's an assembly-level item, not a component-level one).

**Fallback:** if the decomposition LLM omits `componentChecklist` or returns an invalid one (Zod validation fails), the sub-agent falls back to existing behavior — no forced verification. Logged as a warning. The agent-side `evaluate_checklist` tool still works against an empty checklist (becomes a no-op for that sub-agent).

**Persistence:** the decomposition result already lands in a trace table (per the audit references, `decomposition_decisions`). Extend that JSONB with the `componentChecklist` field per component for analytics + debugging.

### 3. Forced verification at sub-agent `submit_result`

Reuse the existing rejection pattern at `agent-tools.service.ts:339` (where assertion-fail rejects the submit and the agent loop continues). Add the checklist check after assertions and render success:

```ts
// Existing checks first — unchanged.
// Then, in multi-agent sub-agent context:
if (deps.componentChecklist && deps.componentChecklist.length > 0) {
  const result = await runFocusedChecklistEval({
    checklist: deps.componentChecklist,
    code: fs.getMainCode(),
    renderedFiles: deps.getLastRenderedFiles(),
    // ... per-item evaluation per §1 ...
  });

  const failed = result.filter(r => r.verdict === "FAIL");
  if (failed.length > 0) {
    return [
      `SUBMISSION REJECTED — ${failed.length} of ${result.length} component checklist item(s) failed:`,
      ...failed.map(f => `  Item ${f.index} [${f.visibility.toUpperCase()}]: ${f.reasoning}`),
      ``,
      `Fix these issues before submitting again. UNCERTAIN items are allowed to pass; FAIL items are not.`,
    ].join("\n");
  }
}

// All component items PASS or UNCERTAIN. Proceed with submit as before.
```

**`UNCERTAIN` does NOT block submit.** UNCERTAIN often comes from genuine occlusion or ambiguous angles; blocking on it would create infinite loops. Only `FAIL` blocks.

**Single-agent submit_result is unchanged.** The gating only fires when `deps.componentChecklist` is populated, which only happens for sub-agents in the multi-agent path.

**Wiring:** when `runMultiAgentCodegen` spawns each sub-agent, it sets `componentChecklist` on the agent's tool dependency object to the matching `componentChecklist` from the decomposition.

**Step budget protection:**
- Each rejected submit consumes one step (existing pattern).
- Sub-agents use `subAgentMaxSteps` (typically 12-20 per `getSubAgentMaxSteps`). If the agent burns through its budget on retries, the sub-agent gives up and submits anyway — same as today's step-exhaustion handling.
- No re-render between checklist eval and submit; cached screenshots reused.

**Worst-case cost:** ~3-5 forced checklist evals per sub-agent at ~$0.04 each = ~$0.20 extra per sub-agent. With 2-4 sub-agents per multi-agent prompt: ~$0.10-0.80 extra per multi-agent generation.

### 4. Assembler verification metadata

The assembler receives extended sub-component metadata. **No new forced eval on the assembler side** — the assembled object's parent `verificationChecklist` is already evaluated by the existing post-submit pipeline; adding a forced assembler-level check would duplicate work. The assembler still has `evaluate_checklist` available as a tool and can use it strategically.

**Assembler input (extended):**
```ts
assemblerInput = {
  components: [
    {
      name: "body",
      code: ...,
      renderedFiles: [...],
      verification: {
        runAtSubmit: true,
        passedCount: 3,
        failedCount: 1,
        uncertainCount: 0,
        failedItems: [{ item: "Wall thickness is 2mm", reasoning: "wall=1.5 in code" }],
      },
    },
    ...
  ]
}
```

**Assembler system prompt addendum:**

> Each component arrives with a `verification` block describing whether sub-agent verification passed. If `failedCount > 0`, those component-level issues are likely already broken in the sub-output. Still attempt to assemble (best-effort), but note in your assembly that the failed items may surface in the final result. Do not try to re-fix sub-component issues yourself — your job is composition, not component repair.

### 5. Observability persistence

Two new fields for analytics, both nullable, both purely advisory (don't gate anything):

| Field | Table | Type | Purpose |
|---|---|---|---|
| `sub_agent_verifications` | the multi-agent trace table | JSONB | Per-component pass/fail counts + failed items. Lets us answer "do sub-agent verifications correlate with final composite score?" |
| `pre_submit_verification` | `workbench_examples` | JSONB nullable | Small summary of in-loop verification activity: did the agent call `evaluate_checklist`? How many times? Pass/fail/uncertain counts. Lets us answer "is the tool being used?" |

Both via small additive Prisma migrations.

## A/B test methodology

### Test set

The existing 30 prompts at `docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt`. For this workstream the meaningful split is by `requiresDecomposition`:

- **Multi-agent prompts**: those where the spec LLM emits `requiresDecomposition = true` — the forced-verification cohort
- **Single-agent prompts**: the rest — receive only the new tool, no force

The partition is computed before the A/B run and persisted in the report.

### Baseline vs treatment

| State | What's in effect |
|---|---|
| **Baseline (v3)** | Current state on `main` — per-prompt eval_plan with all three iterations (band + clamp + assembly band) shipped. No in-loop semantic eval. |
| **Treatment (v4)** | Same as baseline + new `evaluate_checklist` tool available + forced verification at sub-agent submit + per-component checklists from decomposition. |

### Execution sequence

1. Capture baseline TSV from current DB (re-eval state after v3 work — already at `/tmp/eval-plan-v3-after.tsv`; re-capture if missing).
2. Implement the design (separate plan, see §next).
3. Rebuild backend container.
4. **Regenerate fresh** for each test-set prompt (not re-eval). Necessary because the new tool only fires during the agent loop, not post-submit re-eval, and the forced sub-agent verification only happens during fresh multi-agent code generation.
5. Capture v4 metrics: composite score, multi-agent verification stats, in-loop tool-usage counts.
6. Generate comparison report at `docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md`.

### Metrics

**Outcome metrics (primary):**
- Per-bucket mean composite Δ (v3 → v4)
- Multi-agent prompts mean composite Δ (the main hypothesis)
- "Killer prompt" recovery: of the 5 worst-performers from the diagnostic, did any flip from FAIL-class (<5) to PASS-class (≥ 7)?

**Process metrics (secondary):**
- For each single-agent generation: how many `evaluate_checklist` calls? Pass/fail/uncertain per call.
- For each multi-agent sub-agent: how many forced verification attempts? Did the sub-agent eventually pass?
- For each multi-agent assembly: how many sub-components arrived with `failedCount > 0`?

**Cost metrics:**
- Mean LLM cost per generation (v3 vs v4)
- Wall time per generation

### Success criteria

1. **Multi-agent prompts: mean composite Δ ≥ +0.5** — the primary hypothesis. If multi-agent prompts don't move, the forced sub-agent verification isn't helping.
2. **Killer prompts: ≥ 2 of 5 flip from FAIL-class (<5) to PASS-class (≥ 7)** — concrete proof that mid-loop eval catches specific bugs the final-eval-only path misses.
3. **Single-agent prompts: mean composite Δ ≥ −0.2** — regression check. Tool present but no force; expect modest help-or-no-effect.
4. **Cost per generation ≤ 1.5× baseline** — ceiling for shipping. If forced verification spirals (sub-agents retry endlessly), cost explodes.

Failing (1)–(3): iterate the design (most likely the `componentChecklist` prompt template or agent system-prompt encouragement) before shipping.
Failing (4): scope reduction (e.g., disable forced verification, ship only the tool).

### Failure-mode interpretation

| Failure mode | What it reveals |
|---|---|
| Multi-agent Δ flat, single-agent Δ flat | Tool exists but agents don't use it. System prompt needs tightening. |
| Multi-agent Δ flat, sub-agent verification ran but failed items not actually fixed | Agent can't fix the failures even with explicit feedback. Capability bottleneck. |
| Multi-agent Δ flat, sub-agent verification never failed anything | `componentChecklist` is too lenient. Decomposition prompt template needs sharpening. |
| Multi-agent Δ positive but cost > 1.5× | Reduce forced-retry budget or accept cost-of-quality. |

### Cost projection

- Single-agent (~20 of 30): tool available but optional. Agent may call 0-3 times = $0-0.15 extra per gen = ~$0-3 across cohort.
- Multi-agent (~10 of 30): each sub-agent runs forced verification once on success, ~3-5 times if struggling. ~$0.04-0.20 per sub-agent. 2-4 sub-agents per multi-agent prompt = ~$0.10-0.80 extra per multi-agent gen = ~$1-8 across cohort.
- **A/B total cost:** ~$4-11 extra vs baseline regen cost (~$3). Full A/B ≈ $7-14 total, ~45-90 min wall time.

## Success criteria for the spec (overall)

- New `evaluate_checklist` tool registered, available to all agents (single + sub-agents + assemblers).
- `decomposePrompt` emits `componentChecklist` per component with ≥ 90% rate (validates cleanly via Zod).
- Forced verification fires at sub-agent submit when `componentChecklist` is populated; rejects with structured FAIL message that the agent can act on.
- Single-agent submit_result behavior unchanged.
- Observability fields populated on new generations.
- A/B test report committed showing multi-agent mean composite Δ ≥ +0.5 OR a clear failure-mode signal pointing to the next iteration.

## Follow-ups enabled (not in scope)

- **Sub-component retry routing** — if a sub-agent fails forced verification at step budget, the assembler could re-route to a fresh sub-agent attempt. Larger redesign; defer.
- **Per-checklist-item eval in the post-submit pipeline** — would give per-item granularity to the final composite. Tempting but confounds A/B and changes canonical scoring; defer to a separate spec.
- **Agent learns to invoke `evaluate_checklist` reflexively** — system prompt tuning could be its own iteration (analogous to the v2/v3 of the per-prompt eval_plan template work).
- **Section/cutaway render angles (Phase 2 from earlier discussions)** — orthogonal workstream; would help BOTH the in-loop tool and the existing post-submit VLM eval by reducing occlusion.
- **Multi-agent for non-decomposed prompts** — if mid-loop verification helps a lot, force-decomposition more aggressively (lower the spec LLM's complexity threshold).
