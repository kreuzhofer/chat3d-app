# Phase 2 — A/B Test Results

Generated: 2026-06-07

## Setup

**v4 baseline:** in-loop semantic eval v2 + Phase 0 hygiene. Multi-agent mean 5.95, single-agent 8.04, overall 7.28 ([prior results](2026-06-06-in-loop-eval-test-results.md)). For this A/B baseline scores are pulled from `workbench_examples` rows created on 2026-06-06 (before Phase 2 was applied).

**v5 (Phase 1 occlusion routing):** did NOT ship. Caused PCB regressions; rolled back as part of Phase 2.

**v6 (Phase 2 — this run):** sub-agent self-rendering, 2-tier verification (sub-agent per-component + assembler top-level merged), decomposition discipline (component-local items + assemblyChecklist), Phase 1 dispatcher routing soft-rolled back. Assembler step budget = 1.5× sub-agent budget (60 effective with `workbench.agent_max_steps = 40`).

Test set: 30 prompts from `docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt` regenerated fresh. 29 had v4 baseline scores in the comparison window (one prompt `5dd717c0` is the validator-rejected contradictory snap-fit box — correctly rejected pre-generation in v4; included in v6 cohort with score 2.0).

## Per-bucket Δ (v4 → v6)

| Bucket | n | v4 mean | v6 mean | Δ | Target | Verdict |
|---|---|---|---|---|---|---|
| Multi-agent | 10 | 6.55 | 5.44 | **−1.11** | ≥ +1.0 | ❌ FAIL |
| Single-agent | 19 | 8.04 | 7.91 | **−0.14** | ≥ −0.2 | ✅ PASS |
| Overall | 29 | 7.53 | 7.06 | **−0.47** | — | — |

## Specific prompts

| Prompt | v4 | v5 (broken, did not ship) | v6 | Target | Verdict |
|---|---|---|---|---|---|
| Pi Zero (`05066df7`) | 7.5 | 1.0 | **1.0** | ≥ 6.0 | ❌ FAIL |
| Jetson (`09c2b5de`) | 7.5 | 3.4 | **6.0** | ≥ 6.0 | ✅ at threshold |
| M3 screw (`2d902495`) | 2.0 | — | **6.0** | ≥ 5.0 | ✅ +4.0 |
| Wemos (`2341d5b6`) | 8.0 | — | 7.5 | — | mild regression |

## Phase 2 wiring observability

- **Multi-agent runs with `components/` files in storage:** **11 / 11 = 100%** (target ≥ 95%) ✅
- The per-component file persistence works end-to-end. Sub-agents render, files materialize at `workbench/{categoryId}/{exampleId}/components/{componentName}.{stl,3mf}`.

## All multi-agent results (sorted by v6 score)

| Prompt | v4 | v6 | Δ | Notes |
|---|---|---|---|---|
| `5eeab060` | 8.0 | 9.0 | +1.00 | ✅ improvement |
| `078e4d11` | 5.4 | 7.5 | +2.10 | ✅✅ biggest multi-agent gain (Odroid case) |
| `2341d5b6` | 8.0 | 7.5 | −0.50 | mild |
| `32b6c670` | 8.0 | 7.0 | −1.00 | regression |
| `09c2b5de` | 7.5 | 6.0 | −1.50 | Jetson — partial recovery from v5 |
| `24f10279` | 7.5 | 6.0 | −1.50 | regression |
| `1a1b5f13` | 5.4 | 4.4 | −1.00 | regression |
| `09b73b07` | 4.0 | 3.0 | −1.00 | regression |
| `19d8a259` | 4.2 | 3.0 | −1.20 | regression |
| `5dd717c0` | (n/a) | 2.0 | — | contradictory snap-fit box — properly handled by spec validator in v4, regenerated in v6 |
| `05066df7` | 7.5 | 1.0 | **−6.50** | ⚠⚠ Pi Zero — failed both v5 and v6 |

## Single-agent: top 5 regressions

| Prompt | v4 | v6 | Δ |
|---|---|---|---|
| `00d1eb27` | 7.6 | 3.4 | −4.20 |
| `645de13c` | 5.0 | 2.0 | −3.00 |
| `0636174a` | 9.0 | 7.8 | −1.20 |
| `00a8f375` | 9.0 | 8.2 | −0.80 |
| `008049fc` | 9.2 | 9.0 | −0.20 |

## Single-agent: top 5 gains

| Prompt | v4 | v6 | Δ |
|---|---|---|---|
| `2d902495` (M3 screw) | 2.0 | 6.0 | +4.00 |
| `10024302` | 7.5 | 8.6 | +1.10 |
| `09df32d8` | 9.2 | 10.0 | +0.80 |
| `020c6ab4` | 5.0 | 5.4 | +0.40 |
| `06af61b6` | 7.5 | 7.8 | +0.30 |

## FAIL-class distribution (< 5.0)

- Multi-agent: 5 / 11 below 5.0 (Pi `05066df7`, `09b73b07`, `19d8a259`, `1a1b5f13`, `5dd717c0`)
- Single-agent: 2 / 19 below 5.0 (`00d1eb27`, `645de13c`)

## Decision

**ITERATE.** Phase 2 fails the primary criterion (multi-agent Δ < +1.0; actual −1.11).

### What worked
- **Phase 2 wiring is structurally correct.** 100% of multi-agent runs persisted per-component STL/3MF to the expected storage paths. Sub-agents render their components in isolation, gate fires, decomposition emits `assemblyChecklist`. The infrastructure works.
- **M3 screw recovered +4.0** (2.0 → 6.0). Phase 2 fixed the v4 regression that originally motivated Phase 1. The smoke target prompt validates Phase 2's mechanism for the single-agent case it touched.
- **Jetson partially recovered** (1.0 → 6.0 vs v5; still −1.5 vs v4).
- **One PCB case improved +2.10** (`078e4d11` Odroid: 5.4 → 7.5).
- **Single-agent path effectively unchanged** (Δ −0.14 within target tolerance −0.2). Phase 2 doesn't touch single-agent code; the small regression is LLM-variance noise.

### What failed
- **Multi-agent cohort dropped −1.11.** The regression is concentrated in PCB Cases (5/6 PCB-style enclosures regressed). The Pi Zero case stayed broken at 1.0 — the same failure mode diagnosed during smoke: decomposition emits a "lid_cap opens upward" item interpreted as contradictory by the verifier, the assembler enters an unwinnable retry loop, hits step cap, and is force-evaluated on a degraded intermediate render.

### Mechanism summary
The Phase 2 architecture is sound but exposes a class of failure the v4 assembler-side gate avoided through gate position:
1. **Strict per-item checklist verification at sub-agent submit** catches geometry bugs early when the components are simple. (Works: 9 of 11 components verified cleanly across the cohort.)
2. **Strict per-item assembly-level checklist** can lock the assembler into unwinnable loops when decomposition emits a contradictory item that the assembler-render-LLM cannot satisfy. (Failure: Pi Zero.)
3. **Assembler budget (60 steps) still runs out** on prompts where the assembler does sub-component repair AND chases checklist verifications. (Hinge variance smoke; also `1a1b5f13`, `19d8a259` likely.)

### Recommended next phase
Three independent investigations, in order of expected ROI:

1. **Soften the assembler's forced gate on already-passing components.** If a sub-component's submit-time checklist was passed, the assembler-level gate should NOT re-verify the same item (which the v6 merged checklist may do). Smaller, more targeted gate at the assembler. ~1-2 days. Most likely fix for Pi-class lock loops.

2. **Decomposition prompt iteration for PCB Cases category specifically.** Surface the "lid opens upward" contradiction class to the spec LLM. The current decomposition prompt may be over-emitting under-specified assembly items. ~1-2 days. Addresses the root cause, not just the symptom.

3. **Cross-section renders for occluded-interior shapes.** Deferred from Phase 1 spec; the PCB body interior remains a blind spot for VLM scoring even with per-component renders. Larger lift, addresses a different failure mode (visual_score vs code_eval_score divergence).

## Notable per-prompt observations

- `078e4d11` (Odroid case) climbed 5.4 → 7.5: the per-component rendering let the body sub-agent verify its standoff geometry cleanly, and the assembler had budget to compose without re-litigating sub-component details.
- `5eeab060` (multi-agent) +1.0: typical case where Phase 2's mechanism works as designed.
- `00d1eb27` (single-agent) dropped −4.2: surprising — Phase 2 doesn't touch single-agent code. Likely LLM non-determinism on a specific prompt, similar to the hinge variance documented in the smoke test investigation.
- `5dd717c0`: the contradictory snap-fit-box prompt. v4 had it correctly rejected pre-generation by the spec validator; v6 generated it (validator may not have re-rejected). Worth checking whether the validator behavior changed.
