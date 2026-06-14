# OSS Model Evaluation — Consolidated Results

Last updated: 2026-06-14
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

| Variant | VL? | Paired n | Sonnet avg | Variant avg | Δ | agent_submitted coverage | Per-stream tps (c=1) |
|---|---|---|---|---|---|---|---|
| **Ultra 550B nomtp-caching** | ✗ | 13 | 8.90 | 8.68 | **−0.22** | 13/21 (62%) | ~11.5 (4-node) |
| Ultra 550B nomtp-soak | ✗ | 4 | 8.85 | 8.90 | +0.05 | 4/5 | — |
| Ultra 550B nomtp (orig) | ✗ | 3 | 9.07 | 8.27 | −0.80 | 3/4 | — |
| Super 120B NVFP4 | ✗ | 11 | 8.49 | 7.59 | **−0.90** | 11/21 (52%) | 25.0 |
| Nano 30B-A3B NVFP4 | ✗ | 13 | 8.79 | 6.06 | **−2.73** | 13/30 (43%) | 58.9 |
| **Gemma 4 12B Unified W4A16** (M1, full 30) | ✅ | 13 | 8.89 | 8.56 | **−0.33** | 13/30 (43%) | 22.2 |
| **Gemma 4 26B-A4B W4A16** (M1, full 30) | ✅ | 16 | 8.76 | 8.46 | **−0.31** | 16/30 (53%) | **53.8** |
| **Qwen3.6-35B-A3B FP8** (M1, full 30) | ✗ | 18 | 8.44 | 8.04 | **−0.40** | 22/30 (73%) | **~50** |
| Ultra mtp / mtp-soak / mtp2-soak / mtp-fixed-soak | ✗ | 1–3 each | — | — | n/a | 1–3 per run (collapse) | 11–20 |

Sonnet 4.6 reference: 30/30 scored, 24/30 `agent_submitted` (80% coverage), all-source mean 7.63, agent_submitted mean 8.15.

**VL? = natively vision-language capable** (can ingest the rendered .3mf screenshots), which decides whether a model could double as its own VLM evaluator or support a VLM-conditional SFT track. Determined by base-model architecture, not the chat3d `supports_vision` flag — that flag is unreliable here (the reused M1 test slot inherited `true` from a prior Gemma occupant, and the Nemotron rows are inconsistent: Ultra shows `true`, Super `false`, though both are text-only). Basis: **Gemma 4** is natively multimodal (unified vision+text, like Gemma 3) → ✅. **Nemotron Ultra/Super/Nano** tested here are the text-only LLM variants (the VL line is a separate "Nemotron Nano VL" model) → ✗. **Qwen3.6-35B-A3B-FP8** is the text MoE; Qwen ships vision separately as the `-VL` line (the deploy build log showed a text-only architecture, no vision tower) → ✗. **Implication:** only the two **Gemma 4** candidates can support a self-VLM-eval or VLM-conditional SFT without adding a separate vision model — a real point in their favour given the workshop dataset includes renders.

Effective scores (non-`agent_submitted` treated as 0, over attempted prompts) — the "what would production feel like" view:

| Variant | Attempted | Effective mean |
|---|---|---|
| Sonnet 4.6 (all-source) | 30 | 7.63 |
| Ultra nomtp-caching | 21 | 5.38 |
| Super 120B | 21 | 3.98 |
| Nano | 30 | 2.63 |
| Gemma 4 12B Unified W4A16 (M1) | 30 | 3.71 |
| Gemma 4 26B-A4B W4A16 (M1) | 30 | 4.51 |
| Qwen3.6-35B-A3B FP8 (M1) | 30 | 5.60 |
| All MTP variants | 17–30 | 0.51–0.88 |

## Throughput (llama-benchy, dgx-manager runs of 2026-06-05/08)

| Model | Quant | Nodes | tg tps c=1 | tg per-req tps c=4 | pp tps c=1 |
|---|---|---|---|---|---|
| Nemotron Nano 30B-A3B | NVFP4 | 1 | **58.9** | 39.9 | 3248 |
| Nemotron Super 120B | NVFP4 | 1 | **25.0** | 17.1 | 427 |
| Nemotron Super 120B + MTP | NVFP4 | 1 | 19.7 | 1.2 (!) | 332 |
| Nemotron Ultra 550B-A55B | NVFP4 | 4 (TP=4) | 11.5 | 8.2 | 379 |
| chat3d-build123d-02 (Qwen3.6-27B LoRA) | BF16 | 1 | 14.2 | 13.6 | 825 |
| Gemma 4 12B Unified (dense) | W4A16 | 1 | 22.2 | — | — (node-metric, mid-stream) |
| **Gemma 4 26B-A4B (MoE, ~4B active)** | W4A16 | 2 (TP=2) | **53.8** | — | — (3× timed 256–300 tok completions post-run: 53.8/54.1/54.7) |
| **Qwen3.6-35B-A3B (MoE, ~3B active)** | FP8 | 1 (TP=1) | **~50** | — | — (post-run 256-tok probe: 50.4 tps end-to-end incl. TTFT; matches earlier 49.9/51.6 probes) |

Notes:
- MTP **hurt** Super's measured throughput and destroyed c=4 per-request decode (1.2 tps) — speculative decoding pays off only when acceptance rate is high; for Build123d code + long reasoning it wasn't.
- Qwen3.6-35B-A3B was benchmarked separately in dgx-manager work: BF16→FP8 gave ≈1.6× (50→80 tps c=1). **Now run against the 30-prompt cohort (2026-06-14, M1): paired Δ −0.40, ~50 tps TP=1, see headline table.** The earlier dgx-manager 80 tps was c=1 llama-benchy on shorter sequences; under the agent harness with long Build123d completions the sustained per-stream rate sits at ~50.

## Quality-vs-speed map (the core trade-off)

```
            quality (paired Δ vs Sonnet, agent_submitted)
   0 ┤              ● Gemma 26B-A4B (−0.31, 54 tps)  ← in the box
     │             ● Gemma 12B (−0.33, 22 tps)  ● Ultra nomtp-caching (−0.22, 11.5)
−0.4 ┤                                       ● Qwen3.6-35B-A3B (−0.40, 50 tps)  ← in the box
−0.5 ┤·········································□ TARGET BOX (Δ≥−0.5, ≥25–30 tps)···
−1.0 ┤              ● Super 120B (−0.90, 25 tps)
−1.5 ┤
−2.0 ┤
−2.5 ┤                                       ● Nano (−2.73, 59 tps)
     └──────────┬──────────┬──────────┬──────────┬───
               10         25         40         60   tps per stream
```

**Gemma 4 26B-A4B is the first tested model that lands in the target box** (Δ −0.31 at ~54 tps/stream) — near-parity quality on completed prompts *and* comfortably above the 25–30 tps floor, thanks to the MoE (~4B active params) on TP=2. The catch is **coverage, not quality**: only 16/30 prompts reach `agent_submitted` (53%). The decomposition tail (the 6-prompt cluster that also broke the 12B) accounts for the entire gap — 2 hard timeouts + 4 low-scoring render-fails. That gap is exactly what agentic SFT + harness stall/recovery guards target, which makes the 26B-A4B the **strongest SFT-base candidate to date**: it already has the speed and the per-prompt quality; it needs convergence reliability on hard prompts. See `docs/local-model-strategy.md`.

**Qwen3.6-35B-A3B FP8 also lands in the box** (Δ −0.40 at ~50 tps/stream, TP=1) and is the **second-strongest SFT-base candidate**. Its profile differs from the 26B in an informative way: it trades ~0.1 of paired quality for **markedly better coverage — 22/30 agent_submitted (73%) vs the 26B's 53%**, the best non-Sonnet coverage in the series. Where the Gemmas hit the decomposition tail with *no-code timeouts*, Qwen mostly *converges with code* on hard prompts (only 2 no-code errors all run; the rest of the tail is low-scoring `agent_submitted`/`code_only`, not stalls). So Qwen's failure mode is **quality-on-hard-prompts, not convergence** — the paired Δ damage is concentrated in 4 prompts (−3.0, −1.9, −1.0, −0.8) while 14 of 18 paired prompts are at/near parity. Net read: **26B-A4B wins on raw quality + VL capability; Qwen wins on coverage/reliability at TP=1 (frees a node).** Both are viable SFT bases; the 26B's VL capability remains the tiebreaker given the render-heavy dataset.

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

1. ~~**Qwen3.6-35B-A3B FP8 on the 30-prompt cohort**~~ — **DONE 2026-06-14 (M1, full 30).** Paired Δ **−0.40** (18 paired; Sonnet 8.44 → Qwen 8.04 on the same prompts), tps **~50/stream** (TP=1, MoE ~3B active — above the 25–30 target; frees the second node vs the 26B's TP=2). **Lands in the target box.** Distribution: 22 agent_submitted (73% coverage, mean 7.64 — best non-Sonnet coverage in the series), 1 composite (5.4), 5 code_only (render-fail, excluded), 2 no-code errors. Effective mean 5.60 (best of the OSS candidates). The Δ damage is concentrated in 4 hard prompts (−3.0, −1.9, −1.0, −0.8); 14/18 paired are at/near parity. Failure mode is **quality-on-hard-prompts, not convergence** (Gemma's tail was no-code timeouts; Qwen converges-with-code). **Second-strongest SFT-base candidate** — trades ~0.1 paired quality for +20pp coverage vs 26B-A4B and runs at TP=1, but lacks the Gemmas' VL capability. Raw CSV: `docs/superpowers/specs/2026-06-14-m1-qwen36-35b-a3b-results.csv`.
2. ~~**Gemma 4 26B-A4B on the cohort**~~ — **DONE 2026-06-13 (M1, full 30).** Paired Δ **−0.31** (16/30 agent_submitted, Sonnet 8.76 → 26B 8.46 on the same prompts), tps **~53.8/stream** (TP=2, MoE ~4B active — **above** the 25–30 target). **First model to land in the target box** (near-parity quality *and* target-beating speed). Distribution: 16 agent_submitted (mean 8.46), 3 composite (3.8/7.6/7.8), 2 assertion_fail (1.0), 6 code_only (render-fail, mean 2.5, excluded as inflated), 1 no-code error, 2 timeouts. Effective mean 4.51. The gap vs Sonnet is **coverage, not code quality** — the decomposition cluster (prompts 21–26) produced the 2 timeouts + most low scores. **Model-aware-timeout finding:** prompt 24 (decomposition) *converged* at 58 min to a 6.5 agent_submitted; the two timeouts (21, 23, ~63–70 min) likely would too with more headroom, so a per-model/complexity timeout would recover much of the coverage gap. Verdict: **strongest SFT-base candidate so far** — has the speed and per-prompt quality; needs convergence reliability on hard prompts (agentic SFT + stall/recovery guards). Raw CSV: `docs/superpowers/specs/2026-06-13-m1-gemma26b-a4b-results.csv`.
3. ~~**Gemma 4 12B Unified on the cohort**~~ — **DONE 2026-06-13 (M1, full 30).** Clean paired Δ −0.33 (13/30 agent_submitted), tps 22.2/stream (below 25–30 target; W4A16 dense). Key finding: **bimodal** — fast clean parity on routine prompts (60–480s, Δ≈0) but a **23% no-code-timeout rate** (7/30 burned the full 60-min cap producing zero code; prompts 21–26 were six consecutive), plus slow `composite`/`code_only` degradation (Δ −3 to −5) on the rest. The gap is agent-loop *reliability/convergence*, not code quality — exactly what agentic SFT + harness stall/recovery guards target. Verdict: viable-but-unexciting SFT base; below the tps bar and high stall rate. Compare against the faster MoE candidates (gemma4-26b-a4b, Qwen3.6-35B-A3B) before committing.
4. **gpt-oss-120b on the cohort + benchy** — 117B/A5.1B MXFP4, already registered on vllm-gx10 and anecdotally very fast, but never measured in this series; FT possible-but-unproven (fused MoE experts + MXFP4-native weights). **⛔ SKIPPED 2026-06-14 (Daniel's decision) — deploy-infra + GB10 kernel gap, NOT a model/quality issue; retry pending a dgx-claude container fix.** Three stacked failures hit on the `@eugr/openai-gpt-oss-120b` recipe (TP=1, spark-01): (a) **whole-repo pull** — the recipe fetches the entire HF repo (~195 GB: bf16 originals + Apple-Metal + the ~65 GB MXFP4 vLLM actually serves), a ~3× data tax that took 2.5h+ unauthenticated; (b) **download→load handoff stall** — all 195 GB landed on the NFS HF cache but status never left `downloading` and vLLM never loaded; (c) **snapshot-path crash on warm-cache redeploy** — vLLM is handed `…/models--openai--gpt-oss-120b/snapshots/` (the parent dir, no `<commit>` revision subdir) → `ValidationError: Invalid repository ID or local directory … no config.json` → APIServer crash. **The unstick (dgx-claude root-caused 2026-06-14, gated on Daniel's grant):** the hung unauthenticated pull died at the HF *finalize* step — all blobs are in `…/blobs/` but `snapshots/<commit>/` + `refs/main` were never written, so HF hands vLLM the empty `snapshots/` parent → ValidationError. **One authenticated `snapshot_download(openai/gpt-oss-120b, allow_patterns=<MXFP4 shards+configs>, token=HF_TOKEN)` fixes it**: it dedups against the ~65 GB MXFP4 already on NFS (no re-download), writes the missing snapshot symlinks + refs, and yields a valid model dir → vLLM loads → serves. So the two "future-nicety" asks ARE the fix for this deploy: **(1) `HF_TOKEN` in the node-agent env** (manager has it, agent doesn't; `sparkrun.ts:48` already forwards env — just the credential on the node) and **(2) `allow_patterns`=MXFP4 in the eugr recipe** (also saves the 130 GB dead-weight on every future clean pull). dgx-claude owns: a stale `status=downloading` bug (crash-capture #23 doesn't catch a pre-serving config-resolution exit) and cleanup of the two failed deploy records (`cmqcxnht6` stopped, `cmqd3wcwv` stale-failed) — will DELETE both once greenlit. Coordinated in #agent-room deploy thread. **chat3d side is ready** — model row `94e6c037` (modelName `openai/gpt-oss-120b`), workbench_codegen swap + runner are one step away once it serves. **UPDATE 2026-06-14 (terminal):** the snapshot crash was a *symptom of `/mnt/tank` ENOSPC* (the scan showed `diskFreeBytes:0`) — the HF finalize died after writing all 44 blobs but before `refs/main`/`snapshots/<commit>/`, so it was never an auth/token problem. Daniel cleared disk (**523 GB free**); a plain redeploy (`cmqdfstxm1nx036`) re-finalized `refs/main` and vLLM **loaded the model** (66–70 GB MXFP4 resident). It then crashed at `EngineCore_DP0` init on the **FlashInfer sm120 (GB10/Blackwell) MXFP4 fused-MoE** path: `PermissionError [Errno 13]` writing generated cutlass into the read-only package dir **and** `FileNotFoundError …/flashinfer/data/csrc/.../cutlass_instantiations/120_mxfp4min` — the sm120 MXFP4 cutlass templates are **absent from this container's FlashInfer build**, so a JIT-cache env redirect alone cannot fix it. Fix is a sparkrun-image change (FlashInfer build shipping sm120 MXFP4, or forcing vLLM off the flashinfer-cutlass MoE backend to a triton/marlin MXFP4 path) — **dgx-claude's container, to be coordinated**. **Daniel decided to SKIP gpt-oss-120b** for the M1 sweep and deleted the wedged deploy (`cmqdfstxm1nx036`). Row `94e6c037` left in place; **retry when dgx-claude ships sm120 MXFP4 FlashInfer support.** Full crash log saved at `/tmp/qwen-ab/gptoss.log`.
5. **chat3d-build123d-02 (27B LoRA) on the cohort** — we have tps (14.2 BF16) but no harness quality score; NVFP4 quant would also lift tps.
6. **Ultra nomtp-caching completion** — 21/30 attempted; the remaining 9 prompts would firm up the −0.22 estimate.
7. **Super 120B with prefix caching** — Super was tested before the caching lesson; its coverage (52%) may improve materially.
8. **Model-aware / complexity-scaled timeouts** — the 60-min flat cap cut off ≥2 decomposition prompts that were converging (26B prompt 24 finished at 58 min). A per-complexity timeout (or a no-code stall guard, per Infra finding #5) would recover much of the coverage gap on the MoE candidates without changing the model.
