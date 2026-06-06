# In-Loop Semantic Eval — Design v2 (Post-Smoke-Test Rethink)

**Date:** 2026-06-06
**Status:** Draft (awaiting user review)
**Supersedes:** `docs/superpowers/specs/2026-06-06-in-loop-semantic-eval-design.md` (v1)

## Why a v2

The v1 design assumed sub-agents in multi-agent codegen would have cached rendered files at submit time, allowing a forced per-component verification gate to fire on each sub-agent's submission. The Task 10 smoke run revealed this assumption is wrong:

- Sub-agents run with `disableRender: true` — they write Python code fragments (e.g. `def body() -> Part: ...`), not standalone-runnable Build123d models.
- The assembler is the first agent with render access. It composes sub-component code + assembly logic, then renders.
- Result with the v1 wiring: `deps.getLastRenderedFiles()` is always empty when sub-agents submit, the forced gate's render-presence guard skips the verification, `onChecklistEvaluated` never fires, `sub_agent_verifications` stays NULL in the DB.

The v1 spec built ~70% of the right infrastructure for the wrong execution point. v2 keeps the infrastructure, moves the gate.

## Motivation (unchanged from v1)

For complex multi-part prompts (especially decomposed multi-agent generations), discrete checklist items would benefit from being verifiable INSIDE the agent loop — analogous to how Claude uses tests during normal coding tasks. The diagnostic from the v3 A/B retest confirmed this: the worst-performing multi-agent prompts each had discrete, individually-checkable spec items that failed silently — missing standoffs, wrong port positions, leaves not coplanar.

These failure modes manifest in the *assembled* render, not in any sub-component in isolation. The right verification point is the assembler.

## Goal

Add a forced per-component verification gate at the **assembler's** `submit_result`. The gate verifies all componentChecklists (aggregated across components, tagged with `componentName`) against the assembled render. The assembler has authority to repair sub-component code or composition logic to satisfy failures. Single-agent prompts remain unchanged.

## Non-goals

- **No replacement of post-submit eval.** Composite scoring (visual + code, weighted by eval_plan) remains canonical. The gate is in-loop reinforcement, not a scoring change.
- **No forced gating for single-agent prompts.** Tool exists but unused for them (no `componentChecklist` populated). Preserves v1's single-agent treatment.
- **No verification at sub-agent submit.** Sub-agents can't render their fragments; verification there is structurally infeasible and was the cause of v1's smoke-test failure.
- **No render-pipeline changes.** Uses the assembler's existing render cache.
- **No retry-budget cap on the assembler.** Existing `maxSteps` (typically 25) is the natural budget.
- **No mapping of single-agent `verificationCriteria` into `componentChecklist` to make the tool useful there.** Possible future iteration; out of scope.

## Architecture / data flow

```
                        Multi-agent (forced gate at assembler)
                        ──────────────────────────────────────
  Spec ─► decomposePrompt ─► components: [{name, description, componentChecklist}]
                                              │
              ┌───────────────────────────────┘
              ▼
       sub-agents run, return code fragments    ← no checklist plumbing here
              │
              ▼
       Assembler agent receives:
         • sub-component code + descriptions
         • aggregated componentChecklists, flattened, componentName tagged per item
         • top-level verificationChecklist (unchanged)
         • evaluate_checklist tool (callable proactively)
         • render access (validate_and_render)
              │
              ▼
       Assembler renders the assembly, attempts submit_result
              │
              ▼
       FORCED GATE (non-disableRender branch of submit_result):
         run runChecklistEval once with the flat aggregated checklist
         any FAIL → return "SUBMISSION REJECTED" + per-component breakdown
         UNCERTAIN-only → allow submit
              │
              ▼
       Existing post-eval pipeline (unchanged)


                        Single-agent (unchanged from v1 design)
                        ──────────────────────────────────────
       evaluate_checklist tool registered but no checklist populated → no-op.
       No forced gate. Existing eval pipeline unchanged.
```

## Components

### 1. Aggregation: per-component checklists → flat assembler checklist

In `runMultiAgentCodegen`, after decomposition completes and before the assembler's `runAgentCodegen` is invoked:

```typescript
type AssemblerChecklistItem = ComponentChecklistItem & { componentName: string };

const assemblerChecklist: AssemblerChecklistItem[] = decomposition.components.flatMap((c) =>
  (c.componentChecklist ?? []).map((item) => ({ ...item, componentName: c.name })),
);
```

A 4-component prompt with 3-4 items per component yields a flat list of 12-16 items. Each item carries its source component's name.

The assembler's deps get this list:

```typescript
componentChecklist: assemblerChecklist,
componentName: "assembler", // optional, for logging diagnostics
onChecklistEvaluated: (verification) => {
  // populate the existing subAgentVerifications accumulator,
  // but now keyed by componentName extracted from each result's item
  // (see §5 for shape change)
},
```

### 2. Forced verification gate at assembler `submit_result`

Lives in `packages/backend/src/services/agent-tools.service.ts` `submit_result.execute`, in the **non-`disableRender`** branch (the existing branch that the assembler enters; single-agent enters this branch too but lacks `componentChecklist`, so the gate skips).

Sequence inside `submit_result`:

```
1. Existing assertion check                  ← unchanged, fails fast on hard violations
2. Existing render success check             ← unchanged
3. NEW: forced componentChecklist gate
   - skip if deps.componentChecklist empty/undefined
   - try:
       verification = runChecklistEval({
         checklist: deps.componentChecklist,
         originalIndices: deps.componentChecklist.map((_, i) => i),
         code: deps.fs.getMainCode(),
         renderedFiles: deps.getLastRenderedFiles(),
         evalPlan: deps.evalPlan ?? null,
         visualVerify: verifyChecklistItemVisual,
         codeVerify: verifyChecklistItemCode,
       });
       deps.onChecklistEvaluated?.(verification);
       any FAIL → return formatted SUBMISSION REJECTED message
     catch (err): logger.warn, fall through to onSubmit  ← gate failure ≠ permanent block
4. Existing full eval pipeline               ← unchanged, canonical scoring
5. onSubmit()
```

**Verdict rules** (unchanged from v1):
- Any FAIL → reject submission; assembler retries
- UNCERTAIN does NOT block
- All PASS or PASS+UNCERTAIN → fall through

**Rejection message format** — component-grouped output, leveraging the `componentName` tagged per item:

```
SUBMISSION REJECTED — 2 of 12 component-checklist item(s) failed:

  Component "body":
    Item 0 [VISUAL]: "Body is hollow"
      FAIL — top view shows solid block; no interior cavity visible.

  Component "pin":
    Item 3 [CODE]: "Pin diameter is 3mm"
      FAIL — code uses pin_dia=4 in the pin sub-component (line 12).

Fix these and try submit_result again. UNCERTAIN items are allowed; FAIL items are not.
```

The component name in each section header makes the message actionable — the assembler knows which sub-component's code to edit.

**Why the existing dispatcher works without change:** `runChecklistEval` takes a flat checklist and produces flat results. The gate iterates the results to build the grouped message — pure presentation logic. `runChecklistEval` itself doesn't need to know about `componentName`.

**Budget:** existing assembler `maxSteps` (typically 25). If the assembler exhausts retries, it submits whatever it has and the canonical eval pipeline records failures via composite score. No special retry counter.

### 3. Assembler repair authority + system prompt rewrite

The current assembler system prompt (Task 8) says "DO NOT try to repair sub-component issues yourself — your job is composition." v2 **reverses this**. The assembler is the final author of the result.

**New assembler responsibilities:**
- Compose sub-components into the assembled object (existing)
- Render and verify the assembly (existing tool access)
- Repair failures surfaced by the forced gate — modify sub-component code, composition logic, or both
- Use `evaluate_checklist` proactively before submit to scope-check own work

**System prompt additions** (replaces Task 8's advisory verification block):

```
You are the assembly agent. You have RENDER access and the evaluate_checklist tool.
Your job is not just composition — you are the final author of the result.

Per-component verification checklists are attached. Each item has a componentName
indicating which sub-component it targets. You may modify any sub-component's code
to satisfy these items — the original sub-agent code is a starting point, not
sacred. Composition fixes are also fair game.

Workflow:
1. Compose the assembly from the sub-component code.
2. validate_and_render.
3. Call evaluate_checklist proactively to verify items against the rendered view.
4. Fix failures by editing sub-component code or composition logic.
5. Re-render and re-verify.
6. submit_result when confident.

On submit, a forced verification will run on the full checklist. Any FAIL item
blocks submission with feedback on which component and what failed. UNCERTAIN
items pass through. Use the feedback to target your next fix.
```

**What gets removed from Task 8's prompt:**
- The "DO NOT try to repair sub-component issues yourself" sentence
- The "best-effort, attempt to assemble anyway" framing
- The advisory `verificationParagraph` (no longer needed — gate provides live feedback)

**What stays from Task 8:**
- The observability log line (`assembler received components with verification failures`) — still useful at the orchestration level. It now logs counts the gate is about to produce, not advisory data.
- The `componentsForAssembler` data-flow shape — kept but consumed as gate input rather than as advisory prompt text.

### 4. What to revert / keep / change from current code state

Concrete list of changes from the current `main` (which has Tasks 1-9 implemented per v1):

**Revert (v1 wiring was inert, must be removed):**
- Task 5's gate insertion in the `disableRender: true` branch of `submit_result` — remove. Sub-agent path returns to its pre-Task-5 behavior (assertions, empty-code check, onSubmit).
- Task 7's `componentChecklist` / `componentName` / `onChecklistEvaluated` wiring on sub-agent deps in `runMultiAgentCodegen` — remove from sub-agent invocations only.
- Task 8's "DO NOT try to repair" instruction in the assembler system prompt — delete.
- Task 8's "best-effort assemble anyway" framing + advisory `verificationParagraph` — delete (gate provides live feedback instead).

**Keep, unchanged:**
- Task 1 types (`ComponentChecklistItem`, `ChecklistVerdict`, `ChecklistItemResult`, `ComponentVerificationResult`)
- Task 2's `runChecklistEval` dispatcher
- Task 3's `verifyChecklistItemVisual` / `verifyChecklistItemCode` / `parseChecklistVerdictText`
- Task 4's `evaluate_checklist` tool registration (becomes functionally assembler-only since only assembler has `componentChecklist` populated; tool registration stays uniform)
- Task 6's `decomposePrompt` extension emitting `componentChecklist`
- Task 9's DB columns + persistence layer (column names and types stay)

**Extend:**
- `ComponentChecklistItem` gains optional `componentName?: string` (or introduce `AssemblerChecklistItem = ComponentChecklistItem & { componentName: string }` — TBD by implementer based on type-narrowing impact)
- Aggregation logic in `runMultiAgentCodegen`: flatten per-component checklists with `componentName` tagged, attach to assembler `deps.componentChecklist`
- New forced-gate block in `submit_result`'s **non**-`disableRender` branch (mirrors the removed Task 5 block, repositioned, with grouped-by-component message format)
- Assembler system prompt: add the repair-authority block from §3
- `subAgentVerifications` accumulator: populated by the assembler's gate via `deps.onChecklistEvaluated`. Data shape may need to change from "keyed by component name" to "single composite verification + per-componentName breakdown derived from the flat result list". Implementer decides.

**Implications for the existing `evaluate_checklist` tool (Task 4):**
- Tool checks `deps.componentChecklist`. With v2, only the assembler has it populated.
- Single-agent runs: tool registered but always returns "No verification checklist is configured" — no-op.
- Sub-agent runs: same — no-op.
- Tool stays registered everywhere for uniformity; assembler is the only effective caller.

**File-level impact estimate:**
- `agent-tools.service.ts`: gate moves from `disableRender:true` branch to non-`disableRender` branch; ~0 net lines
- `agent-multi.service.ts`: aggregation logic added (~15 lines), sub-agent wiring removed (~15 lines); ~0 net lines
- `prompts/agent-system-prompt.ts`: assembler prompt rewrites (~30 added, ~20 removed)
- `utils/component-checklist.ts`: small type extension (~5 lines)
- Test files for Tasks 5/7/8 need updating to reflect the moved gate location

### 5. A/B test methodology + success criteria

**Test set:** the existing 30 prompts at `docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt`. Partition by `requiresDecomposition`:
- Multi-agent prompts (~10 of 30) — the forced-gate cohort
- Single-agent prompts (~20 of 30) — control; should be unaffected

**Baseline (v3):** state on `main` BEFORE Tasks 5-9 wiring took effect — i.e., per-prompt eval_plan with v3 clamp-suppress-on-eval-plan. Already captured at `/tmp/eval-plan-v3-after.tsv` (re-capture from DB if stale).

**Treatment (v4-redesign):** the Option 2 architecture from this spec — assembler-time forced gate verifying per-component checklists, repair authority, etc.

**Execution sequence:**
1. Re-confirm baseline TSV (already captured)
2. Apply the redesign per the new plan
3. Rebuild backend container
4. **Regenerate fresh** all 30 prompts (not re-eval — the new gate fires during fresh generation)
5. Capture metrics + observability:
   - Composite score per prompt
   - `sub_agent_verifications` content (now expected to be non-null for multi-agent runs)
   - Assembler step count + gate-rejection count per multi-agent generation
6. Write comparison at `docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md`

**Primary success criteria:**
1. **Multi-agent prompts: mean composite Δ ≥ +0.5** — the primary hypothesis. If multi-agent prompts don't move, the gate isn't producing useful repair signal.
2. **Killer prompts: ≥ 2 of 5 worst v3 multi-agent prompts flip from FAIL-class (<5) to PASS-class (≥ 7)** — concrete proof the gate catches what canonical eval missed.
3. **Single-agent prompts: mean composite Δ ≥ −0.2** — regression check.
4. **`sub_agent_verifications` populated for all multi-agent generations** — verifies the wiring actually fires. This is the metric the v1 smoke test would have caught had we run the smoke before the A/B.
5. **Cost per generation ≤ 1.5× baseline** — ceiling for shipping.

**Failure-mode interpretation:**

| Failure mode | Diagnosis |
|---|---|
| Multi-agent Δ flat, gate rejected often, assembler couldn't fix | Capability bottleneck — assembler can't repair sub-component issues |
| Multi-agent Δ flat, gate rarely rejected | Checklist items too lenient — decomposition prompt template needs sharpening |
| Multi-agent Δ positive but cost > 1.5× | Assembler iterating too many times — consider retry-budget cap |
| `sub_agent_verifications` still NULL | Wiring still broken — investigate immediately |
| Single-agent Δ regressing | Gate accidentally firing on single-agent — check the `componentChecklist` empty-guard |

**Cost projection:**
- Single-agent (~20 of 30): no gate, no extra cost ≈ $0
- Multi-agent (~10 of 30): gate runs ~12-16 items per attempt, assembler may iterate 1-3 times → ~$0.20-0.80 extra per multi-agent gen
- A/B total extra cost: ~$2-8 vs baseline ~$3 = **$5-11 total, ~45-90 min wall time**

## Success criteria for the spec (overall)

- v1's sub-agent gate + sub-agent deps wiring removed (verified inert by smoke).
- Aggregated per-component checklists flow to the assembler's `componentChecklist` dep.
- Forced gate fires at assembler `submit_result` when `componentChecklist` is populated.
- Rejection message is component-grouped and actionable.
- Assembler system prompt grants repair authority and removes the v1 conservatism.
- A/B test report committed showing multi-agent mean composite Δ ≥ +0.5 OR a clear failure-mode signal pointing to the next iteration.
- `sub_agent_verifications` column populated for every multi-agent generation in the A/B.

## Follow-ups enabled (not in scope)

- **Single-agent `verificationCriteria` → `componentChecklist` mapping.** Would make the `evaluate_checklist` tool useful for single-agent runs. Mostly mechanical; defer.
- **Sub-agent rendering in isolation.** If we later add a way for sub-agents to render their fragment standalone, we could re-introduce sub-agent-level verification as additional defense-in-depth. Architectural change.
- **Retry-budget cap on the assembler gate.** If A/B reveals cost blowup, add a counter that lets the assembler submit after N rejections. Currently rely on `maxSteps`.
- **Per-checklist-item eval in post-submit pipeline.** Would give per-item granularity to canonical scoring. Tempting; confounds A/B and changes scoring; defer.
- **Section / cutaway render angles.** Would help BOTH the assembler's gate and the existing post-submit VLM eval by reducing occlusion. Orthogonal workstream.
- **Aggressive decomposition.** If gate helps multi-agent strongly, force the spec LLM's complexity threshold down to push more prompts through the multi-agent path.
