# In-Loop Semantic Eval v2 — A/B Test Results

Generated: 2026-06-06

## Setup

**v3 (baseline):** per-prompt eval_plan + clamp-suppress-on-eval-plan, no in-loop gate. Baseline scores captured at `07:40` from `/tmp/eval-plan-v3-after.tsv`.

**v4 (treatment):** v3 + assembler-path forced gate + repair authority (Option 2). Tasks 1-5 landed on main. `workbench.agent_max_steps` raised from 25 → 40 preemptively before the A/B based on smoke-test observation that the assembler can hit the cap when iterating on gate rejections.

All 30 prompts regenerated in parallel (30 simultaneous background jobs) at `17:40 UTC`. Wall clock from first-fired to last-scored: ~25 minutes. The `sub_agent_verifications` field introduced in Task 4 was the primary v1→v2 confirmation criterion.

## Per-bucket Delta (v3 → v4)

| Bucket | n | v3 mean | v4 mean | Δ | Range (v4) |
|---|---|---|---|---|---|
| Multi-agent prompts | 11 | 5.10 | 5.95 | **+0.85** | [0.0, 8.0] |
| Single-agent prompts | 19 | 7.27 | 8.04 | **+0.77** | [2.0, 9.8] |
| **Overall** | **30** | **6.48** | **7.28** | **+0.80** | — |

Note: `5dd717c0` (contradictory snap-fit box prompt, v3 score 1.0 via assertion_fail) was **rejected** by the v4 prompt validator before generation, scored as 0.0 for analysis purposes. The rejection is a correct outcome — the prompt has physically contradictory gap specifications that cannot be resolved.

## Killer-prompt recovery

5 worst v3 multi-agent prompts (sorted by v3 score ascending):

| Prompt | Description (snippet) | v3 score | v4 score | Flip? |
|---|---|---|---|---|
| 5dd717c0 | Two-part snap-fit box (contradictory) | 1.0 | 0.0 (rejected) | No (validator reject) |
| 19d8a259 | BeagleBone Black enclosure (deep purple) | 3.0 | 4.2 | No |
| 05066df7 | Raspberry Pi Zero 2 W case | 4.5 | 7.5 | **YES** |
| 1a1b5f13 | Long strap hinge (200mm tapered leaves) | 4.5 | 5.4 | No |
| 2341d5b6 | Wemos D1 Mini case | 4.5 | 8.0 | **YES** |

**Flips (FAIL <5 → PASS ≥7): 2/5**

Notable non-flips: `19d8a259` improved +1.2 but didn't cross 7.0 threshold. `5dd717c0` was rejected rather than scored — this is the correct behaviour for a semantically broken prompt, not a regression.

## Observability — criterion #4

- Multi-agent generations with non-null `sub_agent_verifications`: **10/10 (100%)**
  - The 11th multi-agent prompt (`5dd717c0`) was rejected before any generation, so it never reached the assembler and correctly has no `sub_agent_verifications`.
- Single-agent generations: 19 — `sub_agent_verifications` expected to be null; all null except 2 prompts that were dynamically routed to multi-agent by the assembler despite `requires_decomposition=false`:
  - `06af61b6` (European concealed cup hinge) — assembler routed multi-agent
  - `10024302` (Raspberry Pi 5 cluster tray) — assembler routed multi-agent
- Both dynamically-routed-multi-agent prompts also have `sub_agent_verifications` populated, confirming the field is populated whenever the assembler path runs.

## Cost

| Metric | v3 baseline | v4 multi-agent | v4 single-agent | v4 blended |
|---|---|---|---|---|
| Mean prompt tokens | 377K | 791K | 307K | — |
| Mean completion tokens | 14.9K | 18.8K | 6.2K | — |
| Mean total tokens | 392K | 809K | 313K | 495K |
| Cost ratio vs v3 | 1.0x | 2.06x | **0.80x** | **1.28x** |

- Overall blended cost ratio: **1.28x** (within the 1.5x target)
- Multi-agent is 2.06x due to the sub-agent verification pass and assembler iteration; this was expected and budgeted when `max_steps` was raised to 40.
- Single-agent actually got cheaper (0.80x) — the in-loop gate catches bad code earlier and avoids unnecessary retry cycles.
- Wall time per multi-agent generation: ~15–20 minutes. Single-agent: 1–5 minutes.

## Per-prompt detail

| Prompt (8 chars) | Bucket | v3 | v4 | Δ | Notes |
|---|---|---|---|---|---|
| 008049fc | single | 7.2 | 9.2 | +2.0 | Pipe flange |
| 00880a28 | single | 9.0 | 9.2 | +0.2 | Round soap dish |
| 00a8f375 | single | 7.7 | 9.0 | +1.3 | Signal relay enclosure |
| 00bd1aed | single | 7.7 | 9.2 | +1.5 | Block with conical countersink |
| 00d1eb27 | single | 5.6 | 7.6 | +2.0 | Chain sprocket (slow agent, 25+ min) |
| 020c6ab4 | single | 5.0 | 5.0 | +0.0 | Handheld remote control housing |
| 026e71b9 | single | 9.0 | 9.0 | +0.0 | M4 pan head Torx screw |
| 027bc5cc | single | 7.1 | 9.2 | +2.1 | Connecting rod blank |
| 03909b59 | single | 2.0 | 8.0 | **+6.0** | Panel-mount socket housing |
| 03a8e28f | single | 9.0 | 9.0 | +0.0 | Hollow sphere via revolve |
| 05066df7 | multi | 4.5 | 7.5 | **+3.0** | RPi Zero 2 W case — FLIP |
| 0636174a | single | 7.6 | 9.0 | +1.4 | Kayak paddle blade |
| 06af61b6 | single* | 7.4 | 7.5 | +0.1 | Cup hinge (*routed multi-agent) |
| 078e4d11 | multi | 6.8 | 5.4 | -1.4 | Odroid case (regression) |
| 07e7526a | single | 9.5 | 9.2 | -0.3 | Large drum shape |
| 084375fa | single | 9.6 | 9.8 | +0.2 | Doughnut-shaped torus |
| 09b73b07 | multi | 4.8 | 4.0 | -0.8 | Feather RP2040 case (regression) |
| 09c2b5de | multi | 6.0 | 7.5 | +1.5 | NVIDIA Jetson case |
| 09df32d8 | single | 10.0 | 9.2 | -0.8 | Thin flat plate (ceiling effect) |
| 0b1a1ba1 | single | 9.8 | 9.2 | -0.6 | Hollow tube (ceiling effect) |
| 10024302 | single* | 3.0 | 7.5 | **+4.5** | RPi 5 cluster tray (*routed multi-agent) |
| 19d8a259 | multi | 3.0 | 4.2 | +1.2 | BeagleBone Black enclosure |
| 1a1b5f13 | multi | 4.5 | 5.4 | +0.9 | Long strap hinge |
| 2341d5b6 | multi | 4.5 | 8.0 | **+3.5** | Wemos D1 Mini case — FLIP |
| 24f10279 | multi | 7.6 | 7.5 | -0.1 | Jetson Nano case |
| 2d902495 | single | 5.6 | 2.0 | **-3.6** | M3 screw (worst regression) |
| 32b6c670 | multi | 5.0 | 8.0 | **+3.0** | Butterfly hinge |
| 5dd717c0 | multi | 1.0 | 0.0 | -1.0 | Snap-fit box (correctly rejected) |
| 5eeab060 | multi | 8.4 | 8.0 | -0.4 | Single-axis pivot hinge |
| 645de13c | single | 6.4 | 5.0 | -1.4 | Ring with ball seats (regression) |

Notable regressions:
- `2d902495` (M3 screw, -3.6): v4 composite_weight_source=`adaptive`, suggesting the VLM and code scores diverged badly. The screw geometry is detail-sensitive; the gate may have caused additional repair iterations that degraded the geometry.
- `078e4d11` (Odroid case, -1.4): Multi-agent assembler got high token count (1.5M prompt tokens) suggesting many iterations, but output quality dropped.
- `09b73b07` (Feather RP2040 case, -0.8): VLM noted the case body rendered as a nearly flat slab.

## Criterion summary

| Criterion | Target | Result | Verdict |
|---|---|---|---|
| #1 Multi-agent mean Δ | ≥ +0.5 | **+0.85** | PASS |
| #2 Killer-prompt flips | ≥ 2 of 5 | **2/5** | PASS (marginal) |
| #3 Single-agent mean Δ | ≥ −0.2 | **+0.77** | PASS |
| #4 sub_agent_verifications population | 100% of multi-agent | **100% (10/10)** | PASS |
| #5 Cost per generation | ≤ 1.5x baseline | **1.28x blended** | PASS |

## Decision

**SHIP.**

All 5 success criteria pass:

- **Multi-agent Δ = +0.85** (target ≥ +0.5): the in-loop assembler gate and repair authority meaningfully improve complex multi-part model quality.
- **Killer flips = 2/5** (target ≥ 2): `05066df7` (RPi Zero 2 W case, 4.5→7.5) and `2341d5b6` (Wemos D1 Mini, 4.5→8.0) flipped from FAIL to PASS.
- **Single-agent Δ = +0.77**: no regression; single-agent prompts also improved, likely from better code-review mechanics shared with the assembler path.
- **sub_agent_verifications = 100%**: every multi-agent generation that completed (non-rejected) has the field populated. This is the key v1→v2 improvement — v1 smoke would have failed this check.
- **Cost = 1.28x blended**: within budget. Multi-agent at 2.06x is expected given the added verification pass and was pre-approved.

Concerns to watch post-ship:
- `2d902495` (M3 screw) dropped -3.6; screw geometry is tight-tolerance and the gate's repair iterations may be perturbing good geometry. Track this category.
- `078e4d11` (Odroid case, -1.4) and `09b73b07` (Feather RP2040, -0.8) regressed; the assembler hit high token counts (1.5M+) indicating many repair iterations without convergence. The `max_steps=40` bump may not be enough for the hardest multi-part cases — monitor for budget exhaustion.
- `19d8a259` (BeagleBone Black, 3.0→4.2) improved but didn't flip; still in FAIL territory. This is a hard category that needs KB enrichment separately.
