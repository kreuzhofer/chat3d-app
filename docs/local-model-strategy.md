# Local Model Strategy — Path to a Self-Hosted Build123d Codegen Model

Last updated: 2026-06-12
Status: strategy of record. Supersedes the model-selection discussion in `docs/pricing-and-llm-quality-considerations.md` and extends `docs/dataset-release-and-finetune-plan.md`.

## 1. Goal

Train and serve an open-source codegen model that:

1. runs comfortably on **≤ 2× DGX Spark** (2 × 124 GB unified, GB10/arm64), leaving the other 2 nodes free for training;
2. sustains **≥ 25–30 tps per generation stream** (50+ is the ideal);
3. matches or beats frontier models **at this one niche**: writing Build123d code and reasoning about spatial construction — where even frontier models routinely fail;
4. is continuously improved from chat3d's own data via dgx-manager's train→merge→deploy→benchmark loop.

Paid frontier models are retained **only as judges/evaluators** (VLM eval, code review scoring). They write no production code long-term. Token volume in the judge role is a small fraction of codegen volume, which is what makes the economics work.

## 2. What the experiments established (evidence base)

Full data in `docs/oss-model-evaluation.md`. The three load-bearing facts:

1. **Quality near-parity is achievable with OSS today, but only at unusable speed.** Nemotron Ultra 550B (nomtp + prefix caching) scored Δ −0.22 vs Sonnet 4.6 on paired prompts — but at 11.5 tps on all 4 nodes.
2. **The speed floor is achievable, but with a quality gap.** Super 120B NVFP4 runs 25 tps on one node at Δ −0.90 untrained. Nano (59 tps) is far too weak (Δ −2.73) — there is a hard intelligence floor somewhere between 30B-A3B and 120B-class for this task.
3. **A large share of the OSS failure mass is harness-environment, not model capability.** MTP broke tool calls entirely; missing prefix caching doubled step latency; fixed 60-min timeouts killed runs that were converging. After fixing just two of these (nomtp + caching), Ultra's agent_submitted coverage went from ~10% to 62%. The harness can buy back a lot of what smaller models lack — see §5.

### Hardware physics (why MoE is forced)

GB10's unified memory bandwidth (~273 GB/s LPDDR5x) bounds decode speed by bytes-read-per-token ≈ active-param bytes. Rough per-stream ceilings at NVFP4 (~0.55 B/param effective):

| Architecture | Active params | Theoretical ceiling | Measured |
|---|---|---|---|
| Dense 27B | 27B | ~18 tps | 14.2 (BF16, so ~4× more bytes — NVFP4 would be ~25–30) |
| MoE ~120B class | ~12B | ~40 tps | 25.0 (Super NVFP4) |
| MoE 35B-A3B | 3.5B | ~140 tps | 80 (FP8, dgx-manager bench) |
| MoE 30B-A3B | 3B | ~160 tps | 58.9 (Nano NVFP4) |

Dense models ≥ 27B cannot hit 50 tps per stream on this hardware, period. The relaxed floor (25–30 tps) admits dense-27B-NVFP4 marginally and 120B-A12B-class MoE comfortably. **Conclusion: the production model will be MoE (or ≤ 14B dense); the intelligence question is whether fine-tuning closes the gap at acceptable active-param count.**

### Fine-tuning reality on dgx-manager

- Dense LoRA: proven, easy (Qwen3.6-27B fine-tuned twice on chat3d data, May 2026; SQL pilots showed 23%→90% lifts on Gemma E4B).
- MoE LoRA: works but sharp-edged — fused 3D expert tensors need the PEFT `target_parameters` patch (proven on Qwen3.6-35B-A3B, 56%→67% SQL); silent-regression risk if experts are missed (Gemma 26B-A4B incident); multi-node ZeRO-3 is 25× slower if NCCL falls back off InfiniBand.
- The full loop (dataset → train → merge → auto-generated vLLM recipe → deploy → benchmark) is API-driven and battle-tested.

## 3. Model selection

### Recommendation: two-track, converge after measurement

**Track A (primary): Qwen3.6-35B-A3B, FP8/NVFP4.**
80 tps c=1 — double the ideal target, leaving headroom for best-of-N sampling (§5.4) and parallel sub-agents. MoE-FT already proven on this exact architecture in dgx-manager. Fits one node with room for 256k context KV. The unknown is its untrained Build123d quality — **measure first** (M1 below). If it lands at Δ −1.5 or better untrained, it is the best fine-tuning substrate we have; the speed surplus means we can spend tokens (retries, drafts, self-checks) to buy quality.

**Track B (fallback): Nemotron Super 120B NVFP4.**
Already measured: Δ −0.90 untrained at 25 tps — the smallest known quality gap at an acceptable speed. Costs: at the floor not the target; MoE-FT for Nemotron's architecture not yet attempted on dgx-manager (new patch work likely); NVFP4 base weights complicate LoRA (need BF16 base for training, re-quantize after merge).

**Explicitly rejected:**
- Ultra 550B serving: 4 nodes, 11.5 tps, blocks all training. Useful only as an occasional local *teacher/comparison* point.
- Nano-class (≤ 30B-A3B) as the primary: −2.73 is too far below the line for SFT alone to close. Retained as a possible **draft/sub-agent model** later (§5.4).
- Dense ≥ 27B as production: bandwidth-bound below target; keep the existing 27B LoRAs as evaluation references (M1 includes scoring one).

### Decision gate

After M1 (cohort scores for Qwen-35B-A3B and chat3d-build123d-02): pick the track with the best `(quality gap) / (closable-by-SFT likelihood)` and commit. Don't run both fine-tuning tracks in parallel — the cluster can't train two models and serve eval workloads at once.

## 4. Training plan (SFT first, RL later)

### Phase S0 — Dataset consolidation (chat3d side)

The harness already persists everything needed: `agent_conversation` (full tool-use trajectories), `agent_system_prompt`, eval scores, `eval_source`, VLM raw responses, per-component renders. Build the SFT set from:

1. **Successful Sonnet trajectories** (existing ~200+ high-scoring agent_submitted examples and growing): full multi-turn tool-use traces, converted to the target model's chat/tool template. These teach the *loop discipline* — validate → render → evaluate → fix → submit — which is exactly where OSS models waste steps.
2. **Synthetic single-shot pairs** (already exists: `agent-synthetic-training-data.jsonl`, used in the May 27B run): prompt → final code. Teaches Build123d idiom, not loop behavior.
3. **Failure-correction pairs**: render-error → fixed-code deltas mined from trajectories (the harness's error classification gives clean labels). This is the data that teaches *recovery*, the biggest observed OSS weakness.

Filtering rule (learned from this A/B series): include only `eval_source = agent_submitted` with composite ≥ 7.5; never include `code_only`-scored examples.

### Phase S1 — SFT (dgx-manager)

- LoRA (r=16 baseline, sweep up if capacity-limited) on the chosen base, 16k seq len minimum (trajectories are long; 32k preferred if memory allows on 2-node ZeRO-3).
- For Qwen-35B-A3B: use the proven `target_parameters` expert-aware recipe.
- Qualification gate: the **30-prompt cohort, run through the actual harness** (not benchy, not held-out loss). Promotion requires: paired Δ ≥ −0.5 vs Sonnet AND agent_submitted coverage ≥ 70% AND no tps regression > 10%.

### Phase S2 — Iterate SFT with self-generated data

Once the SFT model clears, e.g., Δ −0.7: let it generate against workbench prompts under the harness; the harness verifies (render + assertions) and the frontier judge scores. Trajectories scoring ≥ 7.5 become new SFT data. This is distillation from the *system* (model + harness) rather than from a frontier teacher — consistent with frontier-as-judge-only. Each round runs through the dgx-manager API: create dataset → finetune job → merge → deploy → cohort eval.

### Phase S3 — RL (GRPO/RFT) when SFT plateaus

The harness gives a rare commodity: a **cheap, automatic, partially-verifiable reward** — render success (binary), assertion pass rate (deterministic), VLM/judge composite (frontier, low volume). Reward shaping draft: `R = 0.3·render + 0.3·assertions + 0.4·(composite/10)`, with a length/step penalty to fight the observed 47-step meander. Practicality on Sparks is unproven (rollout throughput is the bottleneck); evaluate vLLM-based rollout + LoRA-GRPO frameworks when we get there. Do not start RL infra before S2 plateaus — staged risk, per the agreed approach.

## 5. Harness compensation roadmap (make the harness carry the model)

Priority-ordered; each item has evidence behind it from the A/B series. Detail in `docs/codegen-harness-audit.md` §10.

1. **Model-aware budgets.** Scale step budget and pipeline timeout by measured tps of the active codegen model (store tps-per-model from benchmarks; budget = base × (sonnet_tps / model_tps), capped). Recovers the "converging but slow" timeout class (3 of 5 timeouts in the best run).
2. **No-code stall guard.** If step ≥ 3 and `main.py` doesn't exist, inject a forcing instruction (or temporarily disable search tools). Kills the research-loop failure mode at near-zero cost.
3. **Prefix-cache-stable prompts.** Keep system prompt + early conversation byte-stable across steps (move volatile content — step counters, soft warnings — to the *end* of the message list) so vLLM prefix caching always hits. Evidence: the caching run was the only near-parity result.
4. **Best-of-N drafts where tps allows.** At 80 tps, generating 3 candidate `main.py` drafts and keeping the first that renders costs less wall-clock than one frontier step. Render success is a free filter. (This is also the future role for a Nano-class draft model.)
5. **Recovery snippet injection.** Extend render-error classification (shipped 2026-06-04) to attach a known-good fix pattern from the KB to the error message, instead of text-only errors. Directly compensates weaker error recovery.
6. **eval_source hygiene.** Exclude `code_only` from headline metrics and the auto-approval path; it inflated OSS scores by 2–4 points and will poison both dashboards and future training data if it leaks into the SFT filter.
7. **Difficulty-aware routing.** Generalize the existing `timeout_observed` mechanism into a per-(prompt-class, model) routing table — hard prompts get bigger budgets/decomposition up front rather than after a wasted hour.

## 6. Milestones

| # | Milestone | Gate | Cluster use |
|---|---|---|---|
| M0 | Docs + data hygiene: this strategy committed; eval_source filtering in metrics; cohort runner script productized (it lives in /tmp today and died with every Colima restart) | runner survives restarts; metrics exclude code_only | none |
| M1 | **Measure the gap:** Qwen3.6-35B-A3B FP8 + chat3d-build123d-02 (27B LoRA) through the 30-prompt cohort; Super re-run with prefix caching | three new rows in `oss-model-evaluation.md`; track decision A/B | 1 node serve |
| M2 | Harness compensation items 1–3 + 6 implemented | timeout-class failures < 10% on a cohort re-run | 1 node |
| M3 | SFT v1 (S0+S1) on the chosen track | Δ ≥ −0.5 paired, coverage ≥ 70%, tps ≥ 25 | 2–3 nodes train, 1 serve |
| M4 | Self-generation loop (S2), 2+ rounds | Δ ≥ −0.25 and rising round-over-round | continuous |
| M5 | Production cutover: `workbench_codegen` + chat codegen on the local model; frontier only on vlm_eval/code_review purposes | 2 weeks of production parity; cost/model < 10% of Sonnet baseline | 1–2 serve, rest train |

Beyond M5: RL (S3), and the long-bet — surpassing frontier on spatial/Build123d reasoning where the niche training data is something no general model has.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Qwen-35B-A3B untrained quality is Nano-class (gap too big for SFT) | M1 measures before committing; Track B (Super) is one decision away |
| MoE-FT silent regression (Gemma incident pattern) | always cohort-eval the merged model vs its own base before promoting; never trust loss curves alone |
| Nemotron-architecture LoRA needs new PEFT patching (Track B) | scope spike before committing to Track B; Qwen path avoids it entirely |
| Trajectory SFT teaches verbosity (47-step meanders in traces) | filter training traces by step efficiency, not just score; step-penalty in RL later |
| 4-node cluster contention (serve vs train) | Ultra retired from regular serving; eval serves on 1 node; training windows scheduled |
| Judge dependency on frontier pricing | judge volume is ~5% of codegen tokens; acceptable; local VLM judge is a post-M5 option |
