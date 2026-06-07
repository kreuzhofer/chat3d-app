# Nemotron 3 Ultra vs Sonnet 4.6 — Model Swap A/B

Generated: 2026-06-07

## TL;DR

**The A/B test could not be completed.** 0/30 prompts produced a usable result with Nemotron-3-Ultra (vllm-gx10) as `workbench_codegen`. 23 examples ended in `render_status=error`, 7 stayed `pending` until the poll deadline, and not a single example received an `eval_score`. This is not a quality regression — it is a complete pipeline collapse caused by the local vLLM endpoint being unable to sustain 30 concurrent long-running streaming requests within the existing timeout budgets.

**Parity claim:** not evaluable. Nemotron cannot be declared comparable or worse on quality from this run — we never got past the codegen stream stage on enough prompts to score.

## Setup

- Cohort: same 30 prompts from `docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt`.
- Architecture: Phase 2 (advisory composite gate, `agent_max_steps=60`).
- Sole change vs v6.2: `workbench_codegen` purpose flipped from `claude-sonnet-4-6` to `nemotron-3-ultra-mtp` (provider `vllm-gx10`).
- All other purposes (vlm_eval, embeddings, agent_orchestration, conversation, decomp-decider) stayed on Sonnet 4.6.
- Confirmed via `/api/admin/llm-purposes`:
  - `workbench_codegen -> nemotron-3-ultra-mtp`
  - `vlm_eval -> Claude Sonnet 4.6`
  - `agent_codegen -> Claude Sonnet 4.6` (note: this is a separate purpose from `workbench_codegen`)

Start: 2026-06-07 20:57:37 CEST (`/tmp/p2-nemotron-start.txt` = 1780858657).

## What happened

All 30 generate jobs were accepted (HTTP 202) within ~60s of dispatch. Backend started streaming Nemotron responses for all 30 in parallel.

The vllm-gx10 endpoint then began emitting tokens extremely slowly. Backend heartbeat logs show single LLM calls running for 8–15+ minutes with `estimatedReasoningTokens` climbing in the low thousands. Example log lines:

```
elapsedMs: 535408ms (8.9 min)  reason: heartbeat   reasoningTokens: 2343
elapsedMs: 538606ms (8.9 min)  reason: heartbeat   reasoningTokens: 2357
elapsedMs: 541725ms (9.0 min)  reason: heartbeat   reasoningTokens: 2371
```

Three things then went wrong in tandem:

1. **LLM stream hard timeout (15 min)** — many requests exceeded `timeoutMs: 900000` and were aborted with `"LLM stream hard timeout — aborting"`.
2. **Generation timeout (30 min) in agent-codegen** — 9 prompts hit `"Generation timed out after 30 minutes"` with `"agent codegen stream failed — no steps produced"`. Those prompts were marked `timeout_observed` for future routing.
3. **Undici body timeout (1800s) in workbench-batch** — 7 jobs failed with `BodyTimeoutError: Body Timeout Error`, which terminates the whole single-prompt job (so eval never runs, even if codegen had partially succeeded).

A handful of prompts that did receive some tokens hit secondary failures:
- Nemotron emitted code that used `BuildPart` without importing it (`Name error in project code: name 'BuildPart' is not defined`).
- `reference pre-retrieval failed` due to `Headers Timeout Error` on embedding/RAG calls (`rag-gap-dedup` failed 3 attempts) — the same endpoint contention spilling into other purposes that share it.

After ~60 minutes elapsed, no new heartbeats and no new job-finished events were appearing — the pipeline had fully stalled. Test was stopped at this point.

## Per-prompt outcome

| Prompt (short) | render_status | eval_score | code_len |
|---|---|---|---|
| 078e4d11 | pending | NULL | 0 |
| 05066df7 (Pi Zero) | pending | NULL | 0 |
| 19d8a259 | error | NULL | 6225 |
| 09b73b07 | error | NULL | 0 |
| 2341d5b6 (Wemos) | error | NULL | 0 |
| 09c2b5de (Jetson) | pending | NULL | 0 |
| 24f10279 | error | NULL | 0 |
| 10024302 | pending | NULL | 0 |
| 07e7526a | pending | NULL | 0 |
| 084375fa | error | NULL | 0 |
| 09df32d8 | error | NULL | 0 |
| 0b1a1ba1 | error | NULL | 0 |
| 645de13c | error | NULL | 1219 |
| 008049fc | error | NULL | 0 |
| 00bd1aed | error | NULL | 1162 |
| 027bc5cc | pending | NULL | 0 |
| 1a1b5f13 | error | NULL | 0 |
| 06af61b6 | error | NULL | 0 |
| 32b6c670 | error | NULL | 0 |
| 5eeab060 | pending | NULL | 0 |
| 020c6ab4 | error | NULL | 0 |
| 00a8f375 | error | NULL | 1587 |
| 5dd717c0 (snap-fit box) | error | NULL | 0 |
| 03909b59 | error | NULL | 0 |
| 00d1eb27 | error | NULL | 0 |
| 026e71b9 | error | NULL | 0 |
| 2d902495 (M3 screw) | error | NULL | 0 |
| 00880a28 | error | NULL | 0 |
| 03a8e28f | error | NULL | 0 |
| 0636174a | error | NULL | 1543 |

- Codegen produced *some* code on 5/30 prompts; in every case the pipeline still ended in `error` (either compile error like `BuildPart` not imported, or the body/stream timeout killed the job before eval).
- `eval_score` populated on 0/30.
- `eval_source` populated on 0/30.

## Aggregated infrastructure errors

Counts in the 60-minute window after dispatch:

| Signal | Count |
|---|---|
| `Generation timed out after 30 minutes` (agent codegen) | 9 |
| `BodyTimeoutError` (undici, workbench-batch) | 7 |
| `marked … timeout_observed — future routing pinned to multi-agent` | 17 |
| `reference pre-retrieval failed` / `semantic dedup check failed` (RAG/embedding contention) | many (10+ per minute at peak) |
| `LLM stream hard timeout — aborting` | several |

## Per-bucket comparison

Cannot compute — no scored rows on Nemotron side.

| Bucket | n_nemotron_scored | Sonnet v6.2 | Nemotron | Δ | Verdict |
|---|---|---|---|---|---|
| Multi-agent | 0 | 6.88 | n/a | n/a | not evaluable |
| Single-agent | 0 | 8.17 | n/a | n/a | not evaluable |
| Overall | 0 | 7.70 | n/a | n/a | not evaluable |

## Specific prompts

Cannot compute — Pi Zero, Jetson, M3 screw all ended pending/error with no code or null eval_score.

## eval_source distribution

| eval_source | count | pct |
|---|---|---|
| NULL | 30 | 100% |

`agent_submitted` target: ≥ 75%. Actual: 0%. **Hard failure.**

## Components/ persistence

Not measurable on this run — no sub-agent verifications completed.

## Step usage

No agent_conversation array reached a meaningful length. Most prompts produced 0–2 agent steps before the LLM stream gave up. The 30-step budget is a moot point when the LLM cannot finish a single tool-use response within the per-call timeout.

## Cost / latency

- Wall time per prompt: 1800s+ (all jobs hit at least one timeout).
- vllm-gx10 throughput under 30 concurrent streams: insufficient to clear even single agent steps within the 15-min stream timeout for most prompts.
- Sonnet 4.6 on Bedrock typically clears the same cohort in ~5–8 minutes per prompt with 4-way concurrency.

## Decision

**Cannot make a parity claim.** This run does not show Nemotron is worse on quality, nor does it show it is comparable — it shows the current vllm-gx10 deployment cannot service this workload at 30-way concurrency under the current timeout settings.

Recommended next steps before re-running:

1. **Reduce concurrency.** Dispatch prompts serially or in batches of 2–4 instead of all 30 at once. Sonnet baselines were also dispatched with `sleep 2`, but the Bedrock backend tolerates the concurrency; vllm-gx10 clearly does not.
2. **Raise stream timeout for Nemotron.** Either lift `tracked-llm` hard timeout from 15 min, or set a per-purpose/per-model timeout so Nemotron gets more headroom while Sonnet stays at 15 min.
3. **Raise undici body timeout in workbench-batch** above 30 min (or make it driven by the LLM hard timeout × expected step count).
4. **Investigate vllm-gx10 capacity.** Heartbeat logs showed tokens trickling in (≈3–4 reasoning tokens per second per stream while 30 streams were active). This points to GPU saturation or a vLLM batch-scheduler config issue, not a model quality issue.
5. **Re-run with concurrency = 1 first.** A serial run of all 30 prompts establishes Nemotron's per-prompt quality and latency under no contention. Only after that is known should concurrent runs be attempted.

## Notable observations

- The `BuildPart` import-missing error suggests Nemotron may emit Build123d code with assumed-imported symbols. On a clean (uncontended) run, this could surface as a real quality finding; for now it's only an anecdotal data point from one of 5 prompts that produced any code.
- The `decomp-decider` marked 17 prompts as `timeout_observed` for `(prompt, model=nemotron-3-ultra-mtp)`. Future routing will skip single-agent for those prompts even after the infra issue is fixed. Worth manually clearing those rows before re-running, otherwise the re-run will not be apples-to-apples vs the Sonnet baseline.
- The same vllm-gx10 endpoint also serves embeddings (via Sonnet's `embedding` purpose, possibly), and `rag-gap-dedup` failures during the codegen storm imply the contention spilled across purposes. Re-running with serial dispatch should also reduce embedding-side fallout.
- The `5dd717c0` contradictory snap-fit box prompt cannot be reassessed here — it ended in error with no code generated.

## Artifacts

- Raw final state: `/tmp/p2-nemotron-final-state.csv`
- Start timestamp: `/tmp/p2-nemotron-start.txt` (1780858657, 2026-06-07 18:57:37 UTC)
- Fired prompts log: `/tmp/p2-nemotron-fired.log`
- Backend logs: docker compose logs on chat3d-backend covering the 60 min window after start
