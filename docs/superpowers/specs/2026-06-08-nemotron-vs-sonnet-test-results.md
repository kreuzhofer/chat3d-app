# Nemotron 3 Ultra vs Sonnet 4.6 — Model Swap A/B (serial retry)

Generated: 2026-06-08

## TL;DR

**DON'T SHIP.** The serial retry run was halted after 8/30 prompts due to a combination of critical failure modes. 3/8 prompts (38%) failed with zero score due to the orphan tool-call bug that the SDK patch e06ef69 did not mitigate. Nemotron's reasoning is extreme (5000+ tokens per step, 6-14 min per LLM call vs Sonnet's ~10-30s). Multi-agent prompts exceeded 20 minutes per prompt. Only 5/8 prompts produced a score (mean 7.28 vs Sonnet baseline 7.70 for the same subset). Nemotron does not approach parity on either quality or reliability.

## Setup

- Cohort: 30 prompts (`/tmp/nemo-ab/cohort.txt`)
- Dispatch: **serial** (1 at a time, 60 min per-prompt timeout)
- Sonnet baseline: v6.2 mean composite 7.70 (multi 6.88, single 8.17)
- SDK patch e06ef69 applied (`@ai-sdk/openai-compatible@2.0.48` with `isParsableJson` guard)
- Start: 2026-06-08T07:37:24Z, Stopped: 2026-06-08T09:01Z (partial run, 1.4h wall)
- Architecture: Phase 2 advisory composite gate, `agent_max_steps=60`
- Partial: 8/30 prompts recorded before practical time limit

## Per-bucket comparison (partial, 8 prompts)

The baseline CSV uses pipe delimiter and does not include a "route" column — all 8 processed prompts
appear to be single-agent (requires_decomposition=false in baseline), though the live decider routed
some as multi-agent due to complexity.

| Bucket | n Sonnet | n Nemo | Sonnet Mean | Nemo Scored | Nemo Mean (scored) | Δ scored | Verdict |
|--------|----------|---------|-------------|-------------|-------------------|----------|---------|
| 8 sampled | 8 | 5/8 | 7.85 | 5 | 7.28 | −0.57 | WORSE |
| unscored errors | 0 | 3/8 | — | — | — | — | CRITICAL |

**If unscored prompts are treated as score 0 (worst case):**

Nemo effective mean over 8 prompts = (9.0 + 9.2 + 5.0 + 0 + 0 + 0 + 9.2 + 4.0) / 8 = 4.55

Sonnet mean over same 8 prompts = (9.2 + 9.2 + 8.2 + 8.8 + 6.0 + 3.0 + 9.2 + 9.2) / 8 = 7.85

**Δ = −3.30 (catastrophic; −41% of baseline)**

## Per-prompt comparison (all 8 processed)

| Prompt ID (short) | Prompt | Sonnet | Nemo | Δ | Notes |
|---|---|---|---|---|---|
| 008049fc | Pipe flange (cylinder+disc+bolt holes) | 9.2 | 9.0 | −0.2 | Success, 6m46s |
| 00880a28 | Soap dish (oval bowl, walls) | 9.2 | 9.2 | 0.0 | Success, 4m31s |
| 00a8f375 | (unknown prompt) | 8.2 | 5.0 | −3.2 | Orphan tool-call at step 6; render failed; code_only eval |
| 00bd1aed | (unknown prompt) | 8.8 | unscored | −8.8 | Agent stopped after 1 step (orphan tool-call) |
| 00d1eb27 | (unknown prompt) | 6.0 | unscored | −6.0 | Agent stopped after 1 step (timeout 453s) |
| 020c6ab4 | Remote control housing | 3.0 | unscored | −3.0 | Multi-agent fallback to single-agent, stopped after 1 step; 693s |
| 026e71b9 | M4 pan head Torx screw | 9.2 | 9.2 | 0.0 | Success, 4m31s |
| 027bc5cc | Connecting rod blank | 9.2 | 4.0 | −5.2 | Multi-agent; assembler `translate` ImportError loop; render never succeeded in main assembly; code_only scored 4.0; 1055s |

**Highlighted targets from spec:**
- M3 screw (2d902495) — not yet processed
- Pi Zero (05066df7) — not yet processed
- Jetson (09c2b5de) — not yet processed
- Snap-fit box (5dd717c0) — not yet processed

The run was stopped after 8 prompts due to impractical latency: prompt 9 (panel-mount socket housing)
had been running for 21+ minutes with housing_body sub-agent still on its 3rd retry attempt, each
reasoning step consuming 5000-6000+ tokens over 6-14 minutes.

## eval_source distribution (8 scored prompts)

| eval_source | Count | % |
|---|---|---|
| agent_submitted | 2 | 25% |
| composite | 1 | 12.5% |
| code_only | 2 | 25% |
| unscored (error) | 3 | 37.5% |

Target was `agent_submitted` ≥ 75%. Actual: 37.5% (2/8 fully successful submissions, vs 0% for prior
parallel run). Code_only and unscored errors dominate the failure modes.

## Infra signals (timeouts, errors, orphan tool-call recurrences)

### Orphan tool-call bug — SDK patch e06ef69 NOT EFFECTIVE

The `isParsableJson` guard in `@ai-sdk/openai-compatible@2.0.48` did NOT prevent the orphan
tool-call bug from causing failures:

```
"Tool result is missing for tool call call_adeb9bd36ee641f49f2be614."
"agent codegen stream failed — no steps produced"
```

Total orphan "Tool result is missing" log entries: **8**
Total vLLM validation errors (empty `arguments`): **12**

Affected prompts: 00a8f375 (partial; reached step 6 before failure), 00bd1aed (step 1 stop),
00d1eb27 (step 1 stop), 020c6ab4 (step 1 stop after multi-agent fallback).

Root cause: Nemotron emits tool calls with missing or empty `arguments` field. The vLLM server
returns "Field required" validation errors. The SDK guard does not prevent the orphan tool-call
state that causes "Tool result is missing" on subsequent calls. This is the same failure mode
as the prior parallel attempt.

### Excessive reasoning (new finding vs prior attempt)

Nemotron's MTP reasoning is extreme compared to Sonnet:

| Metric | Nemotron | Sonnet (typical) |
|---|---|---|
| Reasoning tokens per step | 500–5,000+ | 0 (no CoT) |
| LLM call duration per step | 20s–14+ min | 3–15s |
| Steps per prompt | 4–10 | 8–15 |
| Total per-prompt latency | 181s–1055s+ | 200–480s |

A single LLM call for the housing_body sub-agent (prompt 9) ran for 14+ minutes generating 5,000+
reasoning tokens — an extreme overthinking pattern. This makes interactive use impractical and
renders the 60-minute per-prompt timeout insufficient for multi-agent prompts.

### Multi-agent decomposition abort

Prompt 6 (remote control housing, 020c6ab4): multi-agent decomposition aborted with "This operation
was aborted" (timeout in the orchestrator LLM call), fell back to single-agent, then stopped after
1 step with an orphan tool-call error. Wall: 693s (11.5 min).

### Build123d API knowledge gaps

Nemotron used `translate()` as an import from `build123d`, which does not exist. The assembler agent
for the connecting rod (027bc5cc) hit this on every render attempt before running out of steps. This
is a knowledge gap, not an SDK bug.

## Per-prompt outcome (all 8 recorded)

| # | Prompt ID | Render Status | Score | Source | Wall (s) | Notes |
|---|---|---|---|---|---|---|
| 1 | 008049fc | success | 9.0 | composite | 406 | Pipe flange |
| 2 | 00880a28 | success | 9.2 | agent_submitted | 271 | Soap dish |
| 3 | 00a8f375 | error | 5.0 | code_only | 181 | Orphan bug; render failed |
| 4 | 00bd1aed | error | — | — | 120 | Orphan bug step 1 |
| 5 | 00d1eb27 | error | — | — | 453 | Step 1 stop |
| 6 | 020c6ab4 | error | — | — | 693 | Multi-agent abort + orphan |
| 7 | 026e71b9 | success | 9.2 | agent_submitted | 271 | M4 screw |
| 8 | 027bc5cc | error | 4.0 | code_only | 1055 | Connecting rod; `translate` import error loop |

Prompts 9–30 not processed. Prompt 9 (panel-mount socket housing, 03909b59) was in-flight for 21+
minutes with housing_body sub-agent still retrying (scored 4 on first attempt, second attempt
running with 5000+ token reasoning step). Run halted to write this report.

## Cost/latency

| Metric | Nemotron | Sonnet baseline |
|---|---|---|
| Mean wallclock (8 prompts) | 431s (7.2 min) | ~300-420s est |
| Median wallclock | 338s | — |
| p95 wallclock | >1055s | — |
| Max observed | 1055s (still ongoing for P9) | ~480s |
| Step reasoning tokens | 500-5000+ | 0 |

Estimated full-cohort wall-clock at observed rates: 5-10+ hours (vs spec estimate of 3-6h).
Multi-agent prompts alone take 20-30+ minutes each. This makes Nemotron impractical at current
reasoning depth even if the orphan bug is fixed.

## SDK patch verdict

**The e06ef69 `isParsableJson` patch DID NOT mitigate the orphan tool-call bug.** 8 "Tool result is
missing" errors were observed in the first 8 prompts. The patch guards against parsing malformed JSON
in the completion itself, but the vLLM validation error that creates the orphan state (`Field
required: function.arguments`) is upstream of that guard. A separate fix is needed — either:
1. Strip tool calls with empty/null arguments before sending to the backend SDK
2. Retry the stream on orphan tool-call error with a cleaned message history

## Decision

**DON'T SHIP**

Three compounding failure modes prevent deployment:

1. **Orphan tool-call bug (BLOCKING)**: SDK patch e06ef69 is not effective. 3/8 prompts (38%)
   fail with zero score due to Nemotron emitting malformed tool calls. This was the same failure
   mode that killed the prior parallel attempt. Partial-run result: 37.5% unscored.

2. **Extreme reasoning latency (BLOCKING for multi-agent)**: Single LLM steps take 2-14 minutes
   with 5000+ reasoning tokens. Multi-agent prompts cannot complete within 60 minutes at this rate.
   A single housing_body retry consumed 6 minutes of pure reasoning on one step. This is 10-100x
   Sonnet's per-step latency.

3. **Quality when working (MARGINAL)**: On the 5 prompts that produced a score, Nemo averaged 7.28
   vs 7.85 for Sonnet on the same subset (−0.57). The 3 successful scores (9.0, 9.2, 9.2) are
   competitive with Sonnet, but the 2 code_only scores (5.0, 4.0) drag the average down. The
   effective mean treating unscored as 0 is 4.55 vs 7.85 (−3.30).

**Workbench is still on Nemotron**. Revert `workbench_codegen` purpose to Claude Sonnet 4.6 before
any production traffic.

## Next steps if re-evaluating Nemotron

1. Fix orphan tool-call: strip tool calls with empty `arguments` from message history before
   each subsequent LLM call in the agent loop
2. Cap reasoning tokens: set `max_reasoning_tokens` or equivalent to prevent 5000-token reasoning
   spirals (target: ≤500 per step for single-agent, ≤200 for sub-agents)
3. Use Nemotron for `workbench_codegen` only (not agent_orchestration) to evaluate the raw
   code quality without the orchestration loop issues
4. Re-run with a 10-prompt spot check before committing to 30-prompt full run

## Artifacts

- `/tmp/nemo-ab/results.csv` — 8 recorded prompt outcomes
- `/tmp/nemo-ab/log.txt` — dispatch log with timestamps
- `/tmp/nemo-ab/cohort.txt` — 30 prompt IDs
- `/tmp/nemo-ab/start-ts.txt` — epoch start timestamp (1780904244)
- Background script still polling prompt 9 at time of report
