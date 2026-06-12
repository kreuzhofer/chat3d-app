# OSS Model Evaluation — Consolidated Results

Last updated: 2026-06-12
Status: **living document** — update after every model-swap A/B.

This consolidates every open-source-model experiment run against the workbench harness, replacing the need to read the per-run reports in `docs/superpowers/specs/2026-06-0{7,8}-nemotron-*.md` (kept as historical records). Numbers below were re-validated against the production DB via the admin API on 2026-06-12, after the per-(prompt, model) dedup trim.

## Methodology

- **Cohort:** 30 prompts, fixed set at `docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt`. Mix of single-agent and multi-agent (decomposition) prompts.
- **Baseline:** Claude Sonnet 4.6 (Bedrock) under the v6.2 Phase-2 harness (advisory composite gate, `workbench.agent_max_steps=60` during the A/B series).
- **Swap protocol:** only the `workbench_codegen` purpose is re-mapped; vlm_eval, spec generation, code review, embeddings stay on their default models. Serial dispatch (one prompt at a time), 60-min per-prompt cap, vLLM health probe every 3 prompts.
- **Scoring:** composite eval (visual VLM + code review + assertions). `eval_source` matters:
  - `agent_submitted` — the agent completed its loop and submitted; the only fully trustworthy bucket.
  - `composite` — post-agent fallback eval; usable.
  - `code_only` — render failed, score derived from code alone; **systematically inflated** (observed 9.0–10.0 scores on prompts whose geometry never rendered). Exclude from headline metrics.
  - `assertion_fail` — deterministic dimensional check failed; reliable negative signal.

## Headline results (validated 2026-06-12)

Paired same-prompt comparison vs Sonnet 4.6, variant side restricted to `agent_submitted`:

| Variant | Paired n | Sonnet avg | Variant avg | Δ | agent_submitted coverage | Per-stream tps (c=1) |
|---|---|---|---|---|---|---|
| **Ultra 550B nomtp-caching** | 13 | 8.90 | 8.68 | **−0.22** | 13/21 (62%) | ~11.5 (4-node) |
| Ultra 550B nomtp-soak | 4 | 8.85 | 8.90 | +0.05 | 4/5 | — |
| Ultra 550B nomtp (orig) | 3 | 9.07 | 8.27 | −0.80 | 3/4 | — |
| Super 120B NVFP4 | 11 | 8.49 | 7.59 | **−0.90** | 11/21 (52%) | 25.0 |
| Nano 30B-A3B NVFP4 | 13 | 8.79 | 6.06 | **−2.73** | 13/30 (43%) | 58.9 |
| Ultra mtp / mtp-soak / mtp2-soak / mtp-fixed-soak | 1–3 each | — | — | n/a | 1–3 per run (collapse) | 11–20 |

Sonnet 4.6 reference: 30/30 scored, 24/30 `agent_submitted` (80% coverage), all-source mean 7.63, agent_submitted mean 8.15.

Effective scores (non-`agent_submitted` treated as 0, over attempted prompts) — the "what would production feel like" view:

| Variant | Attempted | Effective mean |
|---|---|---|
| Sonnet 4.6 (all-source) | 30 | 7.63 |
| Ultra nomtp-caching | 21 | 5.38 |
| Super 120B | 21 | 3.98 |
| Nano | 30 | 2.63 |
| All MTP variants | 17–30 | 0.51–0.88 |

## Throughput (llama-benchy, dgx-manager runs of 2026-06-05/08)

| Model | Quant | Nodes | tg tps c=1 | tg per-req tps c=4 | pp tps c=1 |
|---|---|---|---|---|---|
| Nemotron Nano 30B-A3B | NVFP4 | 1 | **58.9** | 39.9 | 3248 |
| Nemotron Super 120B | NVFP4 | 1 | **25.0** | 17.1 | 427 |
| Nemotron Super 120B + MTP | NVFP4 | 1 | 19.7 | 1.2 (!) | 332 |
| Nemotron Ultra 550B-A55B | NVFP4 | 4 (TP=4) | 11.5 | 8.2 | 379 |
| chat3d-build123d-02 (Qwen3.6-27B LoRA) | BF16 | 1 | 14.2 | 13.6 | 825 |

Notes:
- MTP **hurt** Super's measured throughput and destroyed c=4 per-request decode (1.2 tps) — speculative decoding pays off only when acceptance rate is high; for Build123d code + long reasoning it wasn't.
- Qwen3.6-35B-A3B was benchmarked separately in dgx-manager work: BF16→FP8 gave ≈1.6× (50→80 tps c=1). It has **not** yet been run against the 30-prompt cohort.

## Quality-vs-speed map (the core trade-off)

```
            quality (paired Δ vs Sonnet, agent_submitted)
   0 ┤                          ● Ultra nomtp-caching (−0.22, 11.5 tps)
−0.5 ┤
−1.0 ┤              ● Super 120B (−0.90, 25 tps)
−1.5 ┤
−2.0 ┤
−2.5 ┤                                       ● Nano (−2.73, 59 tps)
     └──────────┬──────────┬──────────┬──────────┬───
               10         25         40         60   tps per stream
```

Nothing tested so far sits in the target box (Δ ≥ −0.5 at ≥ 25–30 tps). Ultra has the quality but is 2–3× too slow and needs all 4 nodes; Super has the speed floor but a 0.9-point gap; Nano has speed to spare but is far too weak. **Closing Super's (or Qwen-35B-A3B's) quality gap via fine-tuning is the shortest path into the box** — see `docs/local-model-strategy.md`.

## Infrastructure findings (hard-won, do not relearn)

1. **MTP (multi-token prediction) on vLLM is the root cause of the orphan tool-call bug.** Streamed tool calls arrive with truncated/empty `arguments`; the Vercel AI SDK then replays an orphan tool_use block and Bedrock-style validation fails with "Tool result is missing". Every MTP variant (mtp, mtp-soak, mtp2-soak, mtp-fixed-soak) collapsed to 1–3 completed agent loops out of 17–30. Every nomtp variant scored normally. The SDK-side patch (`patch-package` guard in `@ai-sdk/openai-compatible@2.0.48`, commit `e06ef69`) is necessary but NOT sufficient — a second vLLM-side pathway (`Field required: function.arguments`) bypasses it. **Run agentic tool-use workloads with MTP off.**
2. **vLLM prefix caching is the single biggest latency lever.** The nomtp-caching run took agent_submitted coverage from ~50% to 62% and produced the only near-parity quality result. The agent loop replays the full conversation every step, so a stable prompt prefix makes step N cost only the delta.
3. **"running" ≠ "ready".** dgx-manager reports a deployment running when the container starts; 120B+ models need 2–6 min more to load weights and bind :8000. Always smoke with an actual chat completion before dispatching work.
4. **Concurrency:** vllm-gx10 sustains ~16 parallel requests well; the chat3d backend's per-provider semaphore (`llm_providers.max_concurrent`) is set to 12 for vllm-gx10. The original parallel 30-prompt dispatch (30 × multi-agent fan-out) melted a single node — serial outer dispatch with inner fan-out ≤ 12 is the working envelope.
5. **60-min timeout autopsy (nomtp-caching run):** of 5 timeouts, 3 had 2.5–4.8 KB of plausible code in flight and a successful render behind them — they were *converging slowly* (10–15 min single reasoning steps), not stuck. 1 was a genuine loop: 9 steps of research/validation tools without ever creating `main.py`. Implications: (a) model-aware timeouts would recover most "slow" failures; (b) a no-code stall guard would catch the loops cheaply. Details in `docs/codegen-harness-audit.md` §10.
6. **Cost note:** Ultra 4-node inference ties up the entire cluster (no training possible concurrently). Super/Nano leave 2–3 nodes free.

## Fine-tune history (dgx-manager, validated via API 2026-06-12)

| Job | Date | Base | Dataset | Status |
|---|---|---|---|---|
| chat3d-build123d-01 | 2026-05-10 | Qwen/Qwen3.6-27B | chat3d-training-data-combined.jsonl (real traces, openai format) | completed + merged |
| chat3d-build123d-02-synthetic-16k | 2026-05-13 | Qwen/Qwen3.6-27B | agent-synthetic-training-data.jsonl, max_seq 16384 | completed + merged + benchmarked |

The end-to-end pipeline (dataset upload → LoRA via DeepSpeed ZeRO → merge → vLLM recipe generation → deploy → benchmark) is proven. What has **not** been done yet: running a fine-tuned model through the 30-prompt harness cohort to get a quality Δ comparable to the table above. That is the missing measurement.

## Open questions / next measurements

1. **Qwen3.6-35B-A3B FP8 on the 30-prompt cohort** — the most promising untested point (80 tps c=1, MoE-FT proven on dgx-manager).
2. **Gemma 4 12B Unified (released 2026-06-03) on the cohort** — dense encoder-free multimodal, 256k ctx, native tool use; easiest FT substrate of all candidates and the only one that could *see its own renders* in-loop. tps to verify (~35–45 est. at NVFP4).
3. **gpt-oss-120b on the cohort + benchy** — 117B/A5.1B MXFP4, already registered on vllm-gx10 and anecdotally very fast, but never measured in this series; FT possible-but-unproven (fused MoE experts + MXFP4-native weights).
4. **chat3d-build123d-02 (27B LoRA) on the cohort** — we have tps (14.2 BF16) but no harness quality score; NVFP4 quant would also lift tps.
5. **Ultra nomtp-caching completion** — 21/30 attempted; the remaining 9 prompts would firm up the −0.22 estimate.
6. **Super 120B with prefix caching** — Super was tested before the caching lesson; its coverage (52%) may improve materially.
