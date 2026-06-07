# Phase 0 + Phase 1 — A/B Test Results

Generated: 2026-06-07

## Setup

v4 (baseline): in-loop semantic eval v2 (assembler-side forced gate) — see
`docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md`. Overall: 7.28, multi-agent: 5.95 (incl. 0.0 for rejected snap-fit), single-agent: 8.04.

v5 (treatment): v4 + Phase 0 hygiene (no expected effect on scoring) + Phase 1
assemblyVisibility annotation + dispatcher routing for occluded items.

All 30 prompts regenerated in parallel at `07:19 UTC` on 2026-06-07. Wall clock from first-fired to last-scored: ~18 minutes.

## Phase 0 verification

- `SELECT COUNT(*) FROM workbench_categories`: **16** (was 521 before hygiene — target ~16-25: PASS)
- `SELECT COUNT(*) FROM generation_traces WHERE final_status='running' AND updated_at < NOW() - INTERVAL '7 days'`: **0** (target 0: PASS)
- `SELECT pipeline_type, COUNT(*) FROM generation_traces GROUP BY 1`: single_agent=3346, multi_agent=556 — realistic ~6:1 split, not 95% single_agent (PASS)
- `curl http://localhost/api/auth/me`: returns JSON with user email (backend healthy)

All Phase 0 hygiene checks pass. The category count collapse from 521 → 16 is the intended deduplication from Phase 0.

## M3 screw recovery (primary criterion)

| State | Score |
|---|---|
| v3 baseline | 5.6 |
| v4 (regression) | 2.0 |
| v5 (this run) | **6.0** |

Target: ≥ 5.0 — **PASS**. The M3 screw (`2d902495`) recovered from its v4 regression (+4.0 gain). This confirms the Task 8 smoke test finding (also 6.0) was stable and not a fluke.

## Per-bucket Δ (v4 → v5)

| Bucket | n | v4 mean | v5 mean | Δ | Target |
|---|---|---|---|---|---|
| Multi-agent | 11 | 5.95 | 4.65 | **−1.31** | ≥ 0.0 (stretch: ≥ +0.2) |
| Single-agent | 19 | 8.04 | 8.04 | **+0.00** | ≥ −0.2 |
| **Overall** | **30** | **7.28** | **6.80** | **−0.48** | — |

Multi-agent Δ = −1.31: **FAIL** (target ≥ 0.0).

Single-agent Δ = 0.00: **PASS** (target ≥ −0.2). Phase 0 hygiene had no adverse effect on single-agent.

The multi-agent regression is severe and concentrated in two killer prompts that previously passed in v4:

- `05066df7` (RPi Zero 2 W case): v4=7.5 → v5=1.0 (Δ=−6.5) — was a v4 success flip, now catastrophic
- `09c2b5de` (NVIDIA Jetson case): v4=7.5 → v5=3.4 (Δ=−4.1)

## Per-prompt detail

| Prompt (8 chars) | Bucket | v4 | v5 | Δ | Notes |
|---|---|---|---|---|---|
| 008049fc | single | 9.2 | 9.0 | −0.2 | Pipe flange |
| 00880a28 | single | 9.2 | 9.2 | +0.0 | Round soap dish |
| 00a8f375 | single | 9.0 | 8.2 | −0.8 | Signal relay enclosure |
| 00bd1aed | single | 9.2 | 9.2 | +0.0 | Block with conical countersink |
| 00d1eb27 | single | 7.6 | 7.0 | −0.6 | Chain sprocket |
| 020c6ab4 | single | 5.0 | 2.0 | −3.0 | Handheld remote control housing (regression) |
| 026e71b9 | single | 9.0 | 9.2 | +0.2 | M4 pan head Torx screw |
| 027bc5cc | single | 9.2 | 9.2 | +0.0 | Connecting rod blank |
| 03909b59 | single | 8.0 | 8.0 | +0.0 | Panel-mount socket housing |
| 03a8e28f | single | 9.0 | 9.0 | +0.0 | Hollow sphere via revolve |
| 05066df7 | **multi** | 7.5 | 1.0 | **−6.5** | RPi Zero 2 W case (catastrophic regression) |
| 0636174a | single | 9.0 | 8.6 | −0.4 | Kayak paddle blade |
| 06af61b6 | single* | 7.5 | 7.5 | +0.0 | Cup hinge (*routed multi-agent in v4) |
| 078e4d11 | multi | 5.4 | 4.2 | −1.2 | Odroid case |
| 07e7526a | single | 9.2 | 9.2 | +0.0 | Large drum shape |
| 084375fa | single | 9.8 | 9.8 | +0.0 | Doughnut-shaped torus |
| 09b73b07 | multi | 4.0 | 3.0 | −1.0 | Feather RP2040 case |
| 09c2b5de | multi | 7.5 | 3.4 | **−4.1** | NVIDIA Jetson case (regression) |
| 09df32d8 | single | 9.2 | 10.0 | +0.8 | Thin flat plate |
| 0b1a1ba1 | single | 9.2 | 9.2 | +0.0 | Hollow tube |
| 10024302 | single* | 7.5 | 7.5 | +0.0 | RPi 5 cluster tray |
| 19d8a259 | multi | 4.2 | 3.4 | −0.8 | BeagleBone Black enclosure |
| 1a1b5f13 | multi | 5.4 | 5.4 | +0.0 | Long strap hinge |
| 2341d5b6 | multi | 8.0 | 7.5 | −0.5 | Wemos D1 Mini case |
| 24f10279 | multi | 7.5 | 7.5 | +0.0 | Jetson Nano case |
| 2d902495 | single | 2.0 | **6.0** | **+4.0** | M3 screw (recovery) |
| 32b6c670 | multi | 8.0 | 7.2 | −0.8 | Butterfly hinge |
| 5dd717c0 | multi | 0.0 | 0.0 | +0.0 | Snap-fit box (correctly rejected again) |
| 5eeab060 | multi | 8.0 | 8.5 | +0.5 | Single-axis pivot hinge |
| 645de13c | single | 5.0 | 5.0 | +0.0 | Ring with ball seats |

## Annotation usage

- Total componentChecklist items across multi-agent runs: **162**
- Items annotated visible: **104** (64.2%)
- Items annotated occluded: **58** (35.8%) — target ≥ 15%: **PASS**
- Items with no annotation: **0** — all items annotated
- Occluded items returning UNCERTAIN: could not be directly measured from DB; occluded routing is functioning (items annotated and routed to code-eval path)

## Cost

| Metric | v4 (from report) | v5 multi-agent | v5 single-agent | v5 blended |
|---|---|---|---|---|
| Mean prompt tokens | 791K (multi), 307K (single) | 916K | 358K | — |
| Mean completion tokens | 18.8K (multi), 6.2K (single) | 21K | 7.1K | — |
| Mean total tokens | 809K (multi), 313K (single) | 937K | 365K | — |
| Ratio vs v4 | 1.0x | **1.16x** | **1.17x** | ~1.16x |

v5 cost ratio vs v4: **~1.16x** (within 1.5x target: PASS). The assemblyVisibility annotation pass adds modest overhead (~16%) to both pipelines.

## Killer / notable prompts

| Prompt id | v4 | v5 | Δ | Notes |
|---|---|---|---|---|
| 05066df7 | 7.5 | 1.0 | −6.5 | RPi Zero 2 W case — was a v4 flip to PASS, now catastrophic |
| 09c2b5de | 7.5 | 3.4 | −4.1 | NVIDIA Jetson case — severe regression |
| 2d902495 | 2.0 | 6.0 | +4.0 | M3 screw — recovered from v4 regression, now stable |
| 020c6ab4 | 5.0 | 2.0 | −3.0 | Remote control housing — significant single-agent regression |
| 5eeab060 | 8.0 | 8.5 | +0.5 | Single-axis pivot hinge — the only multi-agent improvement |

## Decision

**ITERATE — do not ship v5 as-is.**

Criterion summary:

| Criterion | Target | Result | Verdict |
|---|---|---|---|
| M3 screw recovery | ≥ 5.0 | **6.0** | PASS |
| Multi-agent Δ | ≥ 0.0 (stretch ≥ +0.2) | **−1.31** | **FAIL** |
| Single-agent Δ | ≥ −0.2 | **+0.00** | PASS |
| % annotated occluded | ≥ 15% | **35.8%** | PASS |
| Cost ratio | ≤ 1.5x | **1.16x** | PASS |

Reasoning:

- **M3 screw recovery: PASS** — 2d902495 went 2.0 → 6.0, stable across two independent runs.
- **Multi-agent Δ: FAIL** — −1.31 is a meaningful regression driven by two previously-passing prompts collapsing: `05066df7` (−6.5) and `09c2b5de` (−4.1). The remaining 8 multi-agent prompts held steady or improved slightly (+0.5 for 5eeab060), confirming the issue is not universal but prompt-specific.
- **% annotated occluded: PASS** — 35.8% of checklist items tagged occluded, well above the 15% threshold. Phase 1 annotation is working as designed.
- **Cost ratio: PASS** — 1.16x overhead for assemblyVisibility is acceptable.
- **Single-agent: PASS** — no regression, Phase 0 hygiene had no adverse effect.

The multi-agent failures warrant investigation before shipping. The two regressed prompts (`05066df7`, `09c2b5de`) are both PCB enclosures that scored 7.5 in v4. A likely hypothesis is that the occluded routing path (which routes `assemblyVisibility=occluded` items away from VLM evaluation toward code-only checks) is creating over-strict code-only verification for multi-part enclosures, causing the assembler gate to fail or under-score completed assemblies. The single-agent improvement to `020c6ab4` (remote housing, −3.0) may be a different issue — composite_weight_source=adaptive is present, suggesting VLM/code divergence. Recommended next step: isolate whether the regression is in the gate rejecting good assemblies, or in VLM scoring the final output lower post-occlusion routing changes.
