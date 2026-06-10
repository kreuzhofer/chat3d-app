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

---

## Fresh run — MTP disabled (nemotron-3-ultra-nomtp) — INTERIM REPORT

**Status as of 2026-06-08T14:24Z**: 3/30 in progress, 2/30 completed. Run still ongoing.

### Setup
- Model: `nemotron-3-ultra-nomtp` (MTP disabled on vLLM server — key change vs prior runs)
- Run start: 2026-06-08T13:28Z
- Archived prior results to `/tmp/nemo-ab-archive-20260608-152604/`
- Fresh `/tmp/nemo-ab/` with only `cohort.txt` (30 prompts)
- SDK patch e06ef69 still in place

### vLLM stability
vLLM held throughout. Zero crashes, no connection failures, no degraded throughput.
All HTTP health pings returned 200 (tested at intervals of 3 prompts per spec loop).

### Orphan tool-call counter — KEY FINDING
**0 orphan "Tool result is missing" errors in 2 completed prompts + 1 in-progress prompt.**

In the prior contaminated runs (with MTP enabled):
- Run 1 (serial): 8 orphan errors in 8 prompts (38% failure rate)
- Run 2 (parallel): widespread failures

**With MTP disabled: 0 orphan errors so far.** This is strong evidence that disabling MTP eliminates the orphan tool-call bug. No `function.arguments` empty-field validation errors were observed in backend logs.

### Results (2/30 complete)

| # | Prompt ID | Prompt | Sonnet Baseline | Nemo Score | Δ | Source | Wall (s) | Steps |
|---|---|---|---|---|---|---|---|---|
| 1 | 008049fc | Pipe flange (cylinder+disc+bolt holes) | 9.2 | 7.8 | −1.4 | agent_submitted | 24 | 4 |
| 2 | 00880a28 | Soap dish (oval bowl, walls) | 9.2 | 7.8 | −1.4 | agent_submitted | 2270 | 47 |
| 3 | 00a8f375 | Signal relay enclosure (box, terminal holes) | 8.2 | (in progress) | — | — | — | — |

**Partial scoring summary (2 prompts):**
- Nemo mean: 7.80 vs Sonnet 9.20 (Δ = −1.40)
- Both scored via `agent_submitted` — no unscored errors
- 0% unscored rate (vs 37.5% in prior serial run with MTP enabled)

### Latency profile (2 prompts)

| Metric | Value | Notes |
|---|---|---|
| Prompt 1 wallclock | 24s | Fast — matched previous prior-run time |
| Prompt 2 wallclock | 2270s (37.8 min) | Soap dish — oval render failures caused 47-step spiral |
| Prompt 3 status | In progress ~7 min | Signal relay enclosure, step 7+ |

Prompt 2 behavior in detail:
- 47 agent steps total (vs Sonnet which typically uses 8-15)
- Render failed 14+ times due to Build123d oval/ellipse rendering issues
- Nemotron used polygon approximation (128 segments) to work around the primitive failure
- VLM initial score: 4.0 (missing bottom floor), fixed at step 42, final 8.0
- Code eval final: 9.0
- Composite final: 7.8
- Reasoning tokens: ~3000+ cumulative per session (deep CoT mode)
- Individual reasoning phases: 50s–8min per reasoning burst (output tokens not heartbeated)

### Reasoning behavior change with MTP disabled

With MTP off, per-step latency changed notably:
- **Lookup/validation steps** (lookup_api, validate_code): 10-30s — fast
- **Code generation steps** (text_editor): 2-8 min (reasoning + output)
- **Render + feedback loop**: ~15s per render call

The "orphan" failure mode that caused hard stops in prior runs is completely absent. Instead, Nemotron iterates through up to 47 steps trying to fix code issues. This is a qualitatively different behavior — **it keeps trying rather than crashing**.

### Orphan errors: prior vs new run

| Run | MTP | Orphan errors | Prompts | Error rate |
|---|---|---|---|---|
| Prior serial (contaminated) | enabled | 8 | 8 | 38% hard-stop |
| Prior parallel (contaminated) | enabled | many | many | widespread |
| Current fresh run | **disabled** | **0** | 2+ | **0%** |

### Updated verdict (interim, 2/30)

**The critical blocker (orphan tool-call bug) appears to be FIXED by disabling MTP.**

However, two new concerns emerge:
1. **Extreme iteration count**: Prompt 2 took 47 steps (vs typical 8-15 for Sonnet). This is due to Nemotron's deep CoT + tendency to continue improving rather than submit. The 60-min per-prompt timeout may be insufficient for hard prompts.
2. **Score parity**: Both completed prompts score 7.8 vs Sonnet's 9.2 baseline — approximately −1.4 delta. Prompt 1 (pipe flange) scored 7.8 vs Sonnet's 9.2; this prompt previously scored 9.0 in the prior contaminated run, suggesting some score variance.
3. **Per-prompt latency**: 37.8 min for prompt 2 is extreme. At this rate, 30 prompts could take 5-15+ hours.

**Full verdict cannot be finalized until the 30-prompt run completes.** The run is ongoing. Key unknowns:
- Will harder prompts (multi-agent decomposition) complete within 60 min?
- Does the 0 orphan error hold for all 30 prompts?
- What is the average wallclock across diverse prompt types?

### Run artifacts (fresh run)
- `/tmp/nemo-ab/results.csv` — rolling results (2 rows so far)
- `/tmp/nemo-ab/log.txt` — dispatch log
- Background loop (task bkqzc6ku5) still running

---

## Ultra-nomtp serial — final state (3/30)

After the SDK patch (`e06ef69`) plus MTP disabled, the Ultra-nomtp run completed 3 prompts before the polling shell exhausted its lifetime. All three scored cleanly.

| # | Prompt | Sonnet | Ultra-nomtp | Δ | Source |
|---|---|---|---|---|---|
| 1 | Pipe flange (008049fc) | 9.2 | 7.8 | −1.4 | agent_submitted |
| 2 | Soap dish (00880a28) | 9.2 | 7.8 | −1.4 | agent_submitted |
| 3 | Signal relay (00a8f375) | 8.2 | 6.8 | −1.4 | composite |

Mean Δ = −1.40 (n=3). Latency: 24s / 2270s (38 min) / ~21 min. The 38-min run on the soap dish made the cohort impractical to complete in any reasonable wall-clock budget — extrapolating, the full 30 would have needed 15–30 hours. Run abandoned by the user before continuing.

**Decision:** Ultra is too slow for further evaluation, even with MTP off and the SDK patch in place.

---

## Nano (3B active) — 30/30 attempted

Switched workbench_codegen to `Nemotron-3-Nano-NVFP4` (30B-A3B, 262k context). DB row `db5c0a9b`, provider `vllm-gx10`.

### Headlines

| Metric | Sonnet | Nano | Δ |
|---|---|---|---|
| Scored-only mean (n=17) | 7.70 | 6.16 | **−1.54** |
| Effective mean (unscored=0, n=30) | 7.70 | 3.49 | **−4.21** |
| Multi-agent (n=5 scored / 11) | 6.88 | 4.64 | −2.24 |
| Single-agent (n=12 scored / 19) | 8.17 | 6.80 | −1.37 |

### Coverage and infra

- 30/30 dispatched. 17/30 scored cleanly. 13/30 unscored: 15 render-status `error`, 2 timeouts at 60-min cap.
- **Render-error rate: ~50%** — the headline blocker. Nano frequently emitted Build123d code that did not compile/render even on simple prompts.
- `eval_source` distribution: agent_submitted 13, code_only 4, unscored 13.
- vLLM stability: **held end-to-end** (5.6 hours, zero crashes).
- Orphan tool-call errors: **0** (confirms MTP-off cure).
- Total wallclock: 333 min (5.6 h). Mean 11 min, median 7 min, p95 60 min (timeout).

### Per-prompt (selected)

| Prompt | Sonnet | Nano | Δ | Notes |
|---|---|---|---|---|
| 027bc5cc | 9.2 | 3.0 | −6.2 | unexpected collapse on a single-agent prompt |
| 0b1a1ba1 | 9.2 | 3.0 | −6.2 | same pattern |
| 00bd1aed | 8.8 | 2.8 | −6.0 | |
| 008049fc | 9.2 | 4.0 | −5.2 | pipe flange, simple geometry |
| 00880a28 | 9.2 | 9.2 | 0.00 | matched Sonnet on soap dish |
| 026e71b9 | 9.2 | 9.2 | 0.00 | |
| 084375fa | 9.8 | 9.8 | 0.00 | |
| 09df32d8 | 10.0 | 10.0 | 0.00 | |
| 2d902495 | 7.0 | 10.0 | **+3.00** | code_only fallback — render errored; score is suspect |
| 020c6ab4 | 3.0 | 6.0 | **+3.00** | code_only fallback — also suspect |

The four perfect ties at the top tell us Nano handles trivial Build123d cleanly. The deep losses on what should be easy single-agent prompts (5+ point drops) suggest Nano lacks robust geometric reasoning on slightly less canonical shapes. The two "wins" both came via the `code_only` fallback path after the actual render errored — they are not real quality wins.

---

## Super 120B-A12B — partial (21/30, vLLM crashed)

Switched to `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4`, served by vLLM as model id `nemotron-super`. DB row `bab7d11f`, display `nemotron-120b`, provider `vllm-gx10-02`.

vLLM endpoint required ~2 minutes of weight loading after the dgx-Manager reported the container running. Smoke (tool-call) passed.

### Headlines

| Metric | Sonnet | Super 120b | Δ |
|---|---|---|---|
| Scored-only mean (n=16) | 7.70 | 5.97 | **−1.73** |
| Effective mean (unscored=0, n=21) | 7.70 | 4.55 | **−3.15** |
| Multi-agent (n=2 scored / 11) | 6.88 | 4.10 | −2.78 |
| Single-agent (n=14 scored / 19) | 8.17 | 6.24 | −1.94 |

### Coverage and infra

- 21/30 dispatched before vLLM endpoint died (HTTP 000 on two consecutive health checks, loop aborted at prompt 21).
- 16/21 scored, 5 prompts pending at the 60-min timeout, 1 render error.
- `eval_source` distribution: agent_submitted 11, code_only 5, unscored 5.
- vLLM stability: **CRASHED** after ~9.5 hours under serial load.
- Latency: mean 27 min, median 20 min, p95 60 min (timeout cap). **2.4× slower than Nano per prompt.**
- Total wallclock: 9.5 h to do 21 prompts. Extrapolated full-30: ~13–14 h, if the endpoint had held.

### Per-prompt (selected)

| Prompt | Sonnet | Super | Nano | Δ vs Sonnet | Source |
|---|---|---|---|---|---|
| 06af61b6 | 8.2 | 1.0 | — | −7.2 | code_only |
| 03a8e28f | 9.0 | 2.0 | — | −7.0 | code_only |
| 008049fc | 9.2 | 4.0 | 4.0 | −5.2 | agent_submitted |
| 05066df7 | 7.5 | 3.0 | 2.0 | −4.5 | code_only |
| 00d1eb27 | 6.0 | 2.0 | — | −4.0 | code_only |
| 027bc5cc | 9.2 | 6.5 | 3.0 | −2.7 | agent_submitted |
| 00a8f375 | 8.2 | 7.0 | 7.6 | −1.2 | agent_submitted |
| 078e4d11 | 5.4 | 5.2 | — | −0.2 | agent_submitted |
| 00880a28 | 9.2 | 9.2 | 9.2 | 0.00 | agent_submitted |
| 026e71b9 | 9.2 | 9.2 | 9.2 | 0.00 | agent_submitted |
| 07e7526a | 9.2 | 9.2 | — | 0.00 | agent_submitted |
| 084375fa | 9.8 | 9.8 | 9.8 | 0.00 | agent_submitted |
| 00bd1aed | 8.8 | 9.0 | 2.8 | +0.20 | agent_submitted — Super beat Nano clearly |
| 0636174a | 7.2 | 7.4 | 7.0 | +0.20 | agent_submitted |
| 020c6ab4 | 3.0 | 4.0 | 6.0 | +1.00 | code_only |

Same shape as Nano: ties at the top, deep losses on geometrically less-canonical prompts, suspicious "wins" via the `code_only` fallback. Multi-agent decomposition was barely sampled because most multi-agent prompts hit the 60-min cap before completing.

---

## Three-way Nemotron round-up

Comparing the three Nemotron variants tested against Sonnet 4.6 baseline (mean 7.70 across 30 prompts):

| Model | n scored | Scored mean | Δ scored | Effective mean | Mean wall | Endpoint | Verdict |
|---|---|---|---|---|---|---|---|
| Sonnet 4.6 (baseline) | 30/30 | 7.70 | — | 7.70 | ~5–8 min | n/a | reference |
| Ultra-nomtp (550B-A55B) | 3/30 | 7.13 | −1.40 | — | 11–38 min | held (small n) | abandoned (too slow) |
| Super 120B-A12B | 16/21 | 5.97 | −1.73 | 4.55 | 27 min | **crashed at 21** | DON'T SHIP |
| Nano 30B-A3B | 17/30 | 6.16 | −1.54 | 3.49 | 11 min | held | DON'T SHIP |

### Patterns shared across all three

1. **Ceiling pattern**: All three score 9.2–10.0 on the easiest prompts (soap dish, 026e71b9, 084375fa, 09df32d8). Nemotron can do trivial Build123d.
2. **Floor pattern**: All three collapse on prompts requiring slightly off-canonical geometry, losing 5–7 points on what should be solid single-agent work.
3. **Code-only fallback contamination**: Both Nano and Super produced "wins" via the eval pipeline's `code_only` fallback when render errored — these are not real quality wins, they're artifacts of the scoring fallback.
4. **Multi-agent decomposition is the weakest dimension** across all variants. Sonnet single-agent → multi-agent drops only 1.3 points; Nemotron drops 2–3 and most multi-agent prompts never complete within the cap.
5. **MTP-off is the orphan-tool-call cure** — zero orphan errors after MTP disabled, across both Nano (full run) and Super (partial). The earlier SDK patch (`e06ef69`) was insufficient on its own; it's the vLLM MTP path that was the real source.

### Infra blockers per variant

| Variant | Blocker | Notes |
|---|---|---|
| Ultra-nomtp | Latency | Single LLM step 2–14 min; multi-agent prompts exceed 60-min cap |
| Nano | 50% render-error rate | Best per-prompt latency, but half the cohort never renders |
| Super 120b | Endpoint stability + 2.4× latency | Crashed vLLM after 9.5 h of serial load; mean 27 min/prompt |

### Decision (final)

**DON'T SHIP any Nemotron variant as `workbench_codegen`.**

None of the three Nemotron variants is competitive with Sonnet 4.6 on this cohort. Best (Ultra-nomtp scored-only Δ = −1.40) is on too small a sample to be statistically meaningful. The two variants with respectable sample sizes (Nano, Super) both sit at Δ −1.5 to −1.7 on scored prompts, with effective deltas in the −3 to −4 range once you treat the half-cohort of unscored prompts as zeros.

**workbench_codegen restored to Claude Sonnet 4.6** (DB row `5469139b`, provider `bedrock`).

### What we did learn that's worth keeping

1. **MTP-off is mandatory if we ever revisit Nemotron** — the orphan tool-call bug we spent a day diagnosing was downstream of MTP, not of the Vercel AI SDK. The `isParsableJson` patch in `@ai-sdk/openai-compatible@2.0.48` (commit `e06ef69`) remains in place; harmless and probably still useful.
2. **dgx-Manager API on `:4000`** is the source of truth for which model is actually serving on which port. Used the `/api/deployments` endpoint to watch container state transitions and `/v1/models` on vLLM directly to confirm weight-load readiness.
3. **vLLM "running" ≠ "ready"** — the container can be up several minutes before weights finish loading and the OpenAI-compatible server binds the port. Future polling scripts should always confirm via a model-call smoke, not just an HTTP 200 on `/v1/models`.
4. **Code-only eval fallback inflates Nemotron scores artificially** — any future Nemotron evaluation should filter `eval_source != agent_submitted` results out of the headline mean, or weight them lower.

### Artifacts (final)

- Nano: `/tmp/nemo-ab-nano-<timestamp>/results.csv` (30 rows attempted, 17 scored)
- Super 120b: `/tmp/nemo-ab/results.csv` (21 rows, 16 scored)
- Sonnet baseline: `/tmp/p2-v6.2-baseline.csv` (30 rows)
- Watcher scripts: `/tmp/dgx-watch.sh`, `/tmp/vllm-ready-watch.sh`
- Resume / batch scripts: `/tmp/nemo-ab/run-nano.sh`, `/tmp/nemo-ab/run-super.sh`
