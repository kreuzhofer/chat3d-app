# Phase 2: Per-Component Renders — Design

**Date:** 2026-06-07
**Status:** Draft (awaiting user review)
**Predecessors:**
- [`2026-06-06-in-loop-semantic-eval-design-v2.md`](2026-06-06-in-loop-semantic-eval-design-v2.md) — v2 in-loop semantic eval (assembler-side forced gate)
- [`2026-06-06-phase0-hygiene-phase1-occlusion-design.md`](2026-06-06-phase0-hygiene-phase1-occlusion-design.md) — Phase 0 hygiene + Phase 1 occlusion routing (the routing part did not ship, see test results below)
- [`2026-06-06-phase0-phase1-test-results.md`](2026-06-06-phase0-phase1-test-results.md) — A/B that showed Phase 1's assemblyVisibility routing regressed PCB cases

## Why Phase 2

The v4→v5 A/B test (Phase 1 occlusion routing) regressed two multi-agent PCB enclosures sharply: `05066df7` (Pi Zero 2 W case) 7.5 → 1.0 and `09c2b5de` (NVIDIA Jetson case) 7.5 → 3.4. Investigation traced the mechanism: Phase 1 routed occluded items to code-only verification, which made the precise component-checklist FAIL gate go silent (UNCERTAIN dominates), pushing failing submissions to the imprecise composite-score gate whose rejection prose can't guide the assembler to specific fixes. The assembler oscillates, burns step budget, and accepts degraded output.

Phase 1 was a workaround for an underlying constraint: sub-agents in this codebase run with `disableRender: true` and have no way to verify their work in isolation. The v1 spec wanted sub-agent-level verification but couldn't enforce it. Phase 2 removes the constraint by making sub-agents standalone-runnable, then implements v1's original intent: per-component verification at sub-agent submit, assembler verification at assembler submit.

## Goal

Make each sub-agent function like a "mini single-agent" focused on one component: it gets the full toolkit (`validate_and_render`, `evaluate_model`, `evaluate_code`, `evaluate_checklist`, `submit_result`), renders its component in isolation, iterates against real visual feedback, and submits through a forced gate that verifies that component's checklist against its own renders. The assembler then composes verified sub-components and runs its own forced gate against the parent prompt's top-level `verificationChecklist`.

## Non-goals

- **No changes to single-agent code path.** Sub-agent infrastructure is new; single-agent stays identical.
- **No new render mechanism.** Existing rendering pipeline (Build123d service → screenshot service) is reused unchanged; only the sub-agent's source file is wrapped at render time.
- **No assembler architectural rewrite.** Assembler keeps repair authority + forced gate; only the data it gates on changes (top-level verificationChecklist instead of aggregated componentChecklists).
- **No removal of the Phase 1 schema/prompt.** Soft rollback only — `assemblyVisibility` annotation continues as telemetry/training-data signal; dispatcher routing is reverted.
- **No cross-section / cutaway renders.** Considered but deferred — Phase 2's per-component renders are expected to obviate the need; if not, escalate to a future phase.
- **No spec-LLM changes (the per-prompt eval_plan).** Phase 2 operates on the multi-agent flow downstream of spec generation.

## Architecture

```
Multi-agent (Phase 2 — per-component rendering)
─────────────────────────────────────────────────
Spec ─► decomposePrompt ─► components: [{name, description, componentChecklist}]
       │                                      ↑ items MUST be component-local
       │                                      (assembly-dependent items go in assemblyChecklist)
       │   + assemblyChecklist: [items verified at assembler]
       │   + assemblyNotes: prose for assembler's system prompt
       ▼
Per component, in parallel:
┌─────────────────────────────────────────────────────────────────────┐
│ Sub-agent runs as "mini single-agent":                              │
│   - Full toolkit: validate_and_render, evaluate_model, evaluate_code│
│     evaluate_checklist, submit_result                               │
│   - deps.componentChecklist = THIS component's checklist only       │
│   - Code written as `def <name>() -> Part: ...` (function only)     │
│   - At render time, orchestrator wraps with __main__ block          │
│   - Sub-agent renders its component, iterates against feedback      │
│   - Forced gate at sub-agent submit fires against component's       │
│     own cached renders                                              │
│   - PASS → component frozen; FAIL/step-cap → degraded submit        │
└─────────────────────────────────────────────────────────────────────┘
       │
       ▼
Assembler agent receives:
  • verified sub-component code (functions, not wrapped)
  • parent prompt's top-level verificationChecklist (merged with assemblyChecklist)
  • Full toolkit + render access
       │
       ▼
Assembler composes → renders assembly → forced gate fires on
TOP-LEVEL checklist only (component items already verified at sub-agent).
       │
       ▼
Existing post-eval pipeline (unchanged)

Storage layout:
  workbench/{categoryId}/{exampleId}.{stl,3mf,front.png,...}        ← final assembly
  workbench/{categoryId}/{exampleId}/components/{compName}.py        ← sub-agent code
  workbench/{categoryId}/{exampleId}/components/{compName}.stl       ← per-component STL
  workbench/{categoryId}/{exampleId}/components/{compName}.{angle}.png ← per-component screenshots
```

## Sub-agent self-rendering — Path X with auto-wrap

**Sub-agent code shape (unchanged from today):**

```python
# left_leaf_assembly.py
from build123d import *

def left_leaf_assembly() -> Part:
    leaf = Box(50, 75, 2)
    # ... knuckles, holes, etc.
    return leaf
```

**Orchestrator's render-time wrap (NEW):**

When the sub-agent calls `validate_and_render`, a render helper in `packages/backend/src/services/component-render.service.ts` (new file):

1. Reads the sub-agent's `.py` source file
2. Strips any existing `__main__` block (defensive, in case the LLM added one)
3. Validates the expected `def <componentName>() -> Part` function exists via AST parse; errors with hint if not
4. Appends a generated wrapper:
   ```python
   if __name__ == "__main__":
       result = left_leaf_assembly()
       result.export_stl("/tmp/component.stl")
       result.export_3mf("/tmp/component.3mf")
   ```
5. Writes the wrapped file to a temp location
6. Invokes the existing rendering pipeline (Build123d service → screenshot service)
7. Stores outputs at `workbench/{categoryId}/{exampleId}/components/{componentName}.{stl,3mf,front.png,...}`

The sub-agent's source file in storage **never includes the wrapper** — only the function definition. Assembler imports the unwrapped version directly when composing.

**Sub-agent system prompt addition:**

> "You are responsible for ONE component of a multi-part assembly: `{componentName}`. Write your code as a function `{componentName}() -> Part` that returns the geometry. The function will be rendered in isolation and later called by the assembler. Do NOT write a `__main__` block or any code outside the function — focus on the geometry. Your component will be rendered standalone for verification before you submit."

**Edge cases:**
- LLM writes its own `__main__` block: orchestrator strips it before re-wrapping. Idempotent.
- LLM imports an unwritten sibling component: import fails at render time → sub-agent gets a clear error message in the tool result, can fix.
- Function name doesn't match the expected component name: AST validator detects, errors out with hint to rename.

## Verification topology — two-tier

**Per-component (at sub-agent submit):**

Sub-agent's `submit_result` runs the existing forced gate (the v1 Task 5 code already shipped to main as part of v2 work, but currently inert for sub-agents). It fires on:
- `deps.componentChecklist` = just this component's items (not aggregated)
- `deps.getLastRenderedFiles()` = this component's cached renders (now actually populated because the sub-agent rendered)
- `evalPlan` = passed through from the parent prompt

The gate uses the existing `runChecklistEval` dispatcher. **The Phase 1 occlusion-routing branch in `checklist-eval.service.ts:100-119` gets removed.** Sub-agents render in isolation, so visual items aren't occluded — visual items go to VLM, code items to code-eval, both items to both. Pre-Phase-1 routing logic.

On FAIL: sub-agent gets a component-grouped rejection message (degenerate to item list since only one component) and iterates.
On all-PASS or UNCERTAIN-only: sub-agent's component is "frozen" — its code + renders become inputs to the assembler.
On step-cap without PASS: same step-exhaustion handling as today — sub-agent submits its best attempt; assembler sees the unverified component.

**At assembler submit:**

Assembler's forced gate runs against the **parent prompt's top-level `verificationChecklist`** merged with the decomposition's `assemblyChecklist`. Items are assembly-level: "knuckles alternate left/right", "lid fits within body 0.5mm tolerance", "PCB seats flush against standoffs".

Assembler's `deps.componentChecklist` = the merged top-level + assemblyChecklist items. The `aggregateChecklistForAssembler` helper from Phase 1 work is replaced with `mergeAssemblyChecklist` that combines top-level + decomposition's assemblyChecklist (de-duped by item text).

The gate uses the SAME dispatcher and code path — they just fire against a different checklist source. Composite-grouped rejection messages degenerate naturally because there's one effective "component" (the assembled object).

**What about evalPlan / composite scoring?**

Unchanged. Each gate decision is one input to the existing canonical post-submit pipeline. evalPlan still drives weight + threshold; clamp-on-eval-plan still suppresses. The composite gate that caused the v5 PCB regression now runs AFTER per-component gates, so by the time the assembler reaches composite scoring, each component has already been verified visually. The assembled object's composite score is less likely to be dragged down by hidden-internal misalignments because those got caught upstream.

## Phase 1 soft rollback + assemblyVisibility as telemetry

**Removed (active rollback):**

In `checklist-eval.service.ts:100-119`, the `isOccluded` branch:
```typescript
const isOccluded = entry.assemblyVisibility === "occluded";
const wantVisual = (entry.visibility === "visual" || entry.visibility === "both") && !isOccluded;
const wantCode = entry.visibility === "code"
              || entry.visibility === "both"
              || (isOccluded && entry.visibility === "visual");
```
Restored to pre-Phase-1 form:
```typescript
const wantVisual = entry.visibility === "visual" || entry.visibility === "both";
const wantCode = entry.visibility === "code" || entry.visibility === "both";
```

Plus the `[occluded — code-only verification]` reasoning marker and the 6 occlusion-routing tests in `checklist-eval.test.ts`.

**Kept (telemetry):**

- `AssemblyVisibilityEnum` and the optional `assemblyVisibility` field on `ComponentChecklistItemSchema`.
- `DECOMPOSE_CHECKLIST_ADDENDUM` paragraph instructing the LLM to emit `assemblyVisibility`.
- The parsed-decomposition-checklists log line (commit `a9b85b4`).
- Schema test cases (component-checklist.test.ts).

**Decomposition prompt edit:**

Update the wording from "occluded items will go to code-only verification" (lie in Phase 2) to:

> "For each item, ALSO emit `assemblyVisibility`: `visible` (feature visible from outside the assembled object) or `occluded` (feature hidden inside / covered by other components). This is used for training-data labels and analytics. The actual verification happens per-component in isolation — your sub-agent will see this component's own rendered views, so occlusion in the assembled context doesn't affect verification."

**Rationale for soft rollback:** The schema field has already been written to DB JSONB for v5 generations. Removing it is friction; keeping it is one optional field. The annotation has semantic value (real property of the geometry) we may want later for difficulty estimation, training data labels, or debug telemetry. Cost of keeping = ~0; cost of re-introducing later if we want it = re-running decompositions.

## Decomposition prompt discipline — component-local items only

The decomposition LLM today emits `componentChecklist` items that mix component-local and assembly-dependent concerns. Phase 2 makes the constraint structurally meaningful — items get verified at the level where they're checkable.

**New prompt section appended to `DECOMPOSE_CHECKLIST_ADDENDUM`:**

```
Each componentChecklist item MUST be verifiable against this component's own
geometry ALONE — i.e., when the component is rendered in isolation, without
any other components.

GOOD component items (verifiable alone):
  - "Body is a hollow box 50×75×2 mm with 2mm walls"     (geometry of the body)
  - "Three countersunk holes spaced 25mm apart"          (features on the body)
  - "Pin diameter is 4mm, length 75mm"                   (geometry of the pin)
  - "Knuckle is a cylindrical lobe at +Z=20mm"           (one lobe's position)

BAD component items (require assembly context):
  - "Knuckles alternate with the other leaf"             ← belongs in assemblyChecklist
  - "Pin slides through all 5 aligned knuckles"          ← belongs in assemblyChecklist
  - "Lid sits 0.5mm above body top edge"                 ← belongs in assemblyChecklist
  - "PCB rests flush against the standoffs"              ← belongs in assemblyChecklist

If a verification item depends on the relationship BETWEEN components, put it
in `assemblyChecklist` instead. Those items are verified at the assembler
stage against the assembled render.
```

**Schema change:** Add `assemblyChecklist: ComponentChecklistItem[]` to `DecompositionResult`. Optional (older decompositions may not have it). Same item shape as componentChecklist. Parsed via `parseComponentChecklist` (already exists).

**Output shape:**

```json
{
  "components": [
    {
      "name": "left_leaf_assembly",
      "description": "...",
      "componentChecklist": [
        { "item": "Body is 50×75×2 mm rectangular slab", "visibility": "code", "assemblyVisibility": "visible" },
        { "item": "Three countersunk holes at Y=±25 and Y=0", "visibility": "both", "assemblyVisibility": "visible" }
      ]
    },
    { "name": "right_leaf_assembly", "description": "...", "componentChecklist": [...] },
    { "name": "removable_pin", "description": "...", "componentChecklist": [...] }
  ],
  "assemblyChecklist": [
    { "item": "Knuckles of left and right leaves alternate without overlap", "visibility": "visual", "assemblyVisibility": "visible" },
    { "item": "Pin passes through all 5 aligned knuckles when assembled flat", "visibility": "both", "assemblyVisibility": "occluded" }
  ],
  "assemblyNotes": "Place left_leaf and right_leaf so their knuckles interlock — left at X=-23, right at X=+23..."
}
```

The orchestrator merges `assemblyChecklist` with the parent prompt's top-level `verificationChecklist` (de-duped by item text) and passes the result to the assembler as `deps.componentChecklist`.

## Cost + step budgets

**Step budget:** Sub-agents reuse `workbench.agent_max_steps` (currently 40 after Phase 0 bump). Same value as single-agent and assembler. Aligns with "treat sub-agents like single-agents" — same budget makes sense.

**Cost projection (multi-agent prompt with 4 components):**
- Sub-agents: 4 × ~$0.50 = ~$2 (was ~$0.40-1.20 in v2)
- Assembler: ~$0.50 (unchanged)
- Decomposition + canonical eval: ~$0.20 (unchanged)
- **Total per multi-agent gen: ~$2.50-3** (~3× v5)

**A/B cost projection:** 10 multi-agent × $3 + 20 single-agent × $0.30 = **~$36** (was $5-11 in v5).

**Circuit breakers:** Existing `agent_max_steps` cap is the natural circuit breaker per sub-agent. No new aggregate cap. If a prompt routinely blows budget, surface in results doc as a per-prompt observation.

## A/B test methodology

**Test set:** Same 30 prompts at `docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt`.

**Baseline (v4):** Current `main` with v2 in-loop eval + Phase 0 hygiene. Last successful A/B at multi-agent=5.95, single-agent=8.04, overall=7.28. (v5's Phase 1 occlusion routing did not ship; main is at v4 + Phase 0.)

**Treatment (v6):** v4 + Phase 2 (sub-agent self-rendering, two-tier verification, soft Phase 1 rollback, decomposition discipline).

**Execution sequence:**

1. Implement Phase 2 (per the implementation plan).
2. **Smoke test against 2 multi-agent prompts:** one PCB (`05066df7-7d80-411c-b9e6-2196d49ba80c`, Pi Zero 2 W case) and one mechanism (`352c4a35-8dc1-4932-9862-8f3aa55de774`, concealed barrel hinge). Verify sub-agent renders land in storage, sub-agent gates fire, assembler runs against top-level checklist only. ~$5, ~15 min wall.
3. If smoke passes: full A/B regen of all 30 prompts. ~$36, ~60-90 min wall.
4. Capture v4 → v6 deltas, write results doc at `docs/superpowers/specs/2026-06-07-phase2-test-results.md`.
5. Ship/iterate/escalate decision.

**Primary success criteria (vs v4):**

| Criterion | Target | Why |
|---|---|---|
| Multi-agent mean Δ | ≥ **+1.0** (5.95 → ≥ 6.95) | Phase 2 is cost-bearing; needs meaningful lift |
| Multi-agent mean (stretch) | ≥ 7.0 absolute | End-state: multi-agent quality matches single-agent |
| PCB recovery (vs v4 baselines of 7.5/7.5) | Pi `05066df7` ≥ 6.0 AND Jetson `09c2b5de` ≥ 6.0 | Both v4 successes; Phase 2 must not regress |
| M3 screw `2d902495` | ≥ 5.0 | v4 had it at 2.0; Phase 2 doesn't touch single-agent path, verify no further drop |
| Single-agent regression | Δ ≥ −0.2 | Single-agent path unchanged; should be flat |
| % sub-agent runs with cached renders | ≥ 95% | Verifies the wiring fires (the criterion v1 lacked) |
| % sub-agent forced-gate failures resolving in ≤ 5 rejections | ≥ 70% | Verifies gate produces actionable feedback, not infinite loops |
| Cost ratio vs v4 | ≤ **3×** | Explicit acceptance — Phase 2 trades cost for capability |

**Failure-mode interpretation:**

| Signal | Diagnosis |
|---|---|
| Multi-agent Δ flat | Per-component verification isn't catching enough errors. Investigate: is the gate firing? are FAIL items the right ones? |
| Multi-agent Δ positive but PCB still regresses | Specific to PCB shape (empty interiors confusing VLM even per-component). Escalate to cross-section renders. |
| High sub-agent step-cap rate | Sub-agents can't converge. Investigate which prompts; consider larger step budget or decomposition prompt iteration. |
| Cost ratio > 3× | Sub-agents looping without convergence. Tighten step cap OR pre-filter prompts where decomposition unhelpful. |
| Single-agent Δ negative | We touched something that affects single-agent. Bug — investigate. |
| < 95% sub-agent runs have cached renders | Render wiring broken. STOP — debug before further A/B work. |

**Smoke gate (before full A/B):** 2-prompt smoke is cheap insurance against "sub-agents render fine but something downstream breaks". If sub-agent renders aren't visible in `workbench/{categoryId}/{exampleId}/components/`, OR the sub-agent gate doesn't fire, STOP and debug. Don't burn $36 on broken wiring.

## Total Phase 2 budget

- LLM cost: ~$40 (smoke + A/B)
- Engineering: 3-5 days of work (spec → plan → impl → smoke → A/B → results)

## Follow-ups enabled (not in scope)

- **Cross-section / cutaway renders.** If PCB cases still struggle even with per-component renders, the next escalation is cutaway views of the assembled object. Lets the VLM see internal alignment.
- **Sub-agent prompt tuning per component type.** Mechanism components (hinges, snap-fits) may benefit from different system prompts than enclosure components (cases, panels). Heuristic-driven prompt routing.
- **Decomposition aggressiveness tuning.** With per-component renders working, the spec-LLM's `requiresDecomposition` threshold can be lowered (more prompts route multi-agent). Currently a stable trigger; revisit once Phase 2 data shows the cost-quality tradeoff.
- **Sub-agent retry routing.** If a sub-agent fails its forced gate at step cap, route to a fresh sub-agent attempt with the failure context as additional input. Deferred from v2.
- **Component-type-aware verification.** Mechanism components might need different verification (e.g., kinematic plausibility checks) than geometric ones.
- **assemblyVisibility as decomposition-quality signal.** With telemetry intact, build an analytics view to track annotation usage by category. May reveal decomposition LLM weaknesses.

## Success criteria for the spec (overall)

- Sub-agents produce per-component STLs/screenshots stored at the documented layout.
- Sub-agent forced gate fires for every multi-agent sub-agent and runs against the right checklist.
- Assembler's forced gate runs against the merged top-level + assemblyChecklist (not aggregated per-component lists).
- Phase 1 dispatcher routing rolled back; schema + telemetry preserved.
- A/B report committed showing multi-agent mean composite Δ ≥ +1.0 OR a clear failure-mode signal pointing to the next iteration.
- PCB regressions (Pi `05066df7`, Jetson `09c2b5de`) recover to ≥ 6.0.
