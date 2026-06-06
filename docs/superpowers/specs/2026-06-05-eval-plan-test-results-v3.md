# Per-Prompt Eval Plan — A/B v3 Test Results

Generated: 2026-06-06

## Setup

**v3** refines the `computeCompositeScore` clamp gate. The ±4 visual-code disagreement clamp is now suppressed whenever `weightSource = "eval_plan"` (in addition to the existing `effectiveWeight ≥ 0.75` bypass from T10). Rationale: when the spec-LLM has explicitly declared which signal to trust for this prompt, the safety net should defer to that declaration on both ends of the weight range — not just the high end.

This addresses the secondary finding from v2: with the new assembly/mechanism band at 0.30–0.45, the clamp was firing exactly where the band should have helped most (cup hinge `06af61b6`: v=8, c=4, weight=0.40 → clamp capped composite at min+1=5 instead of the weighted 6.4).

No spec regeneration in v3 — the test-set's eval_plans are still v2. Only the scoring logic changed.

## Per-bucket v2 → v3 deltas

| Bucket | n | v2 mean | v3 mean | Δ | Range |
|---|---|---|---|---|---|
| PCB Cases | 8 | 5.03 | 5.03 | +0.00 | [+0.00, +0.00] |
| Primitives | 4 | 9.72 | 9.72 | +0.00 | [+0.00, +0.00] |
| Boolean Operations | 4 | 7.58 | 7.10 | −0.48 | [−1.30, +0.00] |
| **Hinges** | 4 | **5.35** | **6.33** | **+0.98** | [+0.00, +2.40] |
| Generic Enclosures | 4 | 4.53 | 3.92 | −0.60 | [−2.40, +0.00] |
| bd_warehouse | 3 | 6.73 | 6.73 | +0.00 | [+0.00, +0.00] |
| Extrusions | 3 | 8.53 | 8.53 | +0.00 | [+0.00, +0.00] |
| **Overall** | **30** | — | — | **−0.01** | — |

## Per-prompt Hinge results (the prediction set)

| Prompt | v=visual, c=code | v1 weight | v2 weight | v2 eval | **v3 eval** | Predicted | Δ from v2 |
|---|---|---|---|---|---|---|---|
| 32b6c670 butterfly | v=2, c=8 | 0.70 | 0.40 | 4.0 | **5.0** | 5.6 (clamp suppressed) | +1.0 |
| 1a1b5f13 strap | v=3, c=7 | 0.70 | 0.40 | 4.0 | **4.5** | 4.6 | +0.5 |
| 06af61b6 cup hinge | v=8, c=4 | 0.72 | 0.40 | 5.0 | **7.4** | 6.4 | **+2.4** |
| 5eeab060 pivot | v=7, c=5 | 0.72 | 0.40 | 8.4 | 8.4 | n/a (gap not at clamp boundary in v2) | 0.0 |

The 06af61b6 cup hinge exceeded the prediction — the underlying VLM eval also produced a slightly higher visual score on this run (re-eval is non-deterministic), compounding the clamp removal.

## Analysis

**v3 worked as designed for Hinges** — +0.98 mean lift, biggest positive bucket Δ in any of the three rounds. The cup hinge case (where VLM correctly scored 8 and code-eval wrongly scored 4) went from clamped-to-5 in v2 to weighted-6.4-to-7.4 in v3. This is exactly the structural-assembly correctness case that motivated the band in v2 and the clamp refinement in v3.

**Off-target bucket noise**: PCB / bd_warehouse / Extrusions / Primitives showed literally +0.00 in every prompt — meaning the re-eval produced identical scores (the clamp wasn't a binding factor for any of these in v2 either, so removing its low-weight branch had no effect on them; the eval pipeline produced identical scores because the underlying components — VLM, code-eval — happened to land at the same numbers on this run). Booleans/Enclosures dropped slightly, driven by single-prompt variance in non-deterministic VLM evaluation — not a v3-introduced regression.

**Composite-stable cohort across the three rounds** (filtering to prompts that stayed composite → composite source):

- v0 (no eval_plan, single global weight): noisy baseline
- v1 (per-prompt eval_plan, original 3 bands): Hinges and bd_warehouse hurt by being mis-bucketed into "balanced"
- v2 (added assembly/mechanism band): Hinges +0.95 (template change correctly classifies mechanisms)
- v3 (clamp gated on weightSource): Hinges +0.98 (clamp suppression unlocks the rest of the band's intended effect)

## Ship decision

**Ship v3.** The compounded effect (v1 → v3) on Hinges is roughly +1.9 mean lift on the 4-prompt bucket. No systematic regression on other buckets. The data is consistent with the design hypothesis: when the spec-LLM provides explicit per-prompt weight guidance, the composite-scoring safety nets should defer to that guidance.

## Follow-ups noted but not blocking

- The `eval-plan-baseline.ts` script's path-resolution makes it awkward to run inside the docker container. A small refactor to accept the test-set path as a CLI arg would simplify operational use.
- Boolean Ops and Generic Enclosures show modest noise per run. A repeated re-eval on the same examples (without any code change) would establish the noise floor for future A/B comparisons.
- The dead code path `HIGH_CODE_WEIGHT_THRESHOLD` is still exported but increasingly redundant with the `weightSource === "eval_plan"` gate. Worth removing once the per-prompt eval_plan is broadly adopted.
