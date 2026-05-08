# Dataset Release & First Fine-Tune Plan

**Status:** Planning. Tracking doc — update as decisions land and results come in.
**Owner:** Daniel
**Created:** 2026-05-03

This doc tracks the path from "we have a curated workbench dataset" to "we publicly release a 3D-CAD code-generation dataset and a fine-tuned open model that demonstrates its value." The intent is to back the next LinkedIn post with an actual artifact, not commentary.

---

## Why this exists

The v1 LinkedIn article (`vault/04-content/linkedin/003-chat3d-agents/`) made the case that agents are scaffolding and training is the foundation. The next article should not re-argue that thesis — it should *demonstrate* it by releasing the dataset and a fine-tuned model that proves it.

Framing for the next post: **"Frontier LLMs can't reliably generate code for niche programmatic CAD libraries because there's no public dataset. We built one. Here's the dataset, here's a fine-tuned open model, here's how it compares to Claude Sonnet on the same prompts."**

The supporting RAG / sub-skill / agent-loop work becomes one paragraph of evidence ("the dataset is rich enough that even in-context retrieval lifts approval rate dramatically — fine-tuning bakes that in") rather than the whole article.

---

## Open questions (decide before starting)

| # | Question | Status |
|---|----------|--------|
| 1 | Which base model to fine-tune? | Tentatively `gpt-oss-120b` per roadmap |
| 2 | LoRA via Unsloth on DGX Spark — still the plan? | Need to confirm |
| 3 | How many examples in the held-out benchmark? | Proposed: ~100 |
| 4 | Dataset license? | Proposed: CC-BY-4.0 for data, Apache-2.0 for model |
| 5 | Hosting platform? | Proposed: HuggingFace (`datasets` + `models`) |
| 6 | Anonymize / scrub prompt text before release? | Need scrub pass on user-derived prompts |
| 7 | Release as one big dataset or split by category? | Proposed: one dataset with `category` field |
| 8 | Include traces / agent conversations, or just `(prompt, code, screenshots)`? | Proposed: minimal `(prompt, code, screenshots, score)` for first release; full traces in a separate companion dataset later |

---

## Plan

### Phase 1 — Lock the dataset shape (1-2 days)

- [ ] Decide on release schema: minimum fields per row (`prompt`, `code`, `score`, `screenshots[]`, `category`, `model_used_to_generate`).
- [ ] Decide on training-format export: LLaMA-Factory JSONL is already supported (`workbench-training-export.service.ts`). Confirm it produces what Unsloth expects.
- [ ] Define a **frozen held-out set** of ~100 prompts, stratified by category, that will be used for benchmarking. **Crucial: these must NOT appear in the training split.** Add a flag on the prompt rows.
- [ ] Audit prompt text for anything that shouldn't be public (PII, private references, bug tracker URLs, etc.).

### Phase 2 — Dataset release (parallel with Phase 3)

- [ ] Choose license, write `LICENSE`, write `README.md` for the HuggingFace dataset card.
- [ ] Write a small export script that produces the public dataset from the live DB — versioned, reproducible.
- [ ] Upload to HuggingFace (`datasets/<org>/chat3d-build123d-v1` or similar).
- [ ] Write a `DATASHEET.md` covering: collection method, eval methodology, known limitations, biases (e.g., over-representation of simple primitives), categories distribution.

### Phase 3 — Fine-tune

- [ ] Confirm DGX Spark availability + Unsloth setup.
- [ ] Train LoRA on the training split (everything except the 100 held-out prompts).
- [ ] Decide hyperparams (rank, learning rate, epochs). Probably start with Unsloth defaults for `gpt-oss-120b`.
- [ ] Save adapter, push to HuggingFace as `models/<org>/chat3d-build123d-lora-v1`.

### Phase 4 — Benchmark

The benchmark is the article's core table.

- [ ] Run the held-out 100 prompts through:
  - **A.** Fine-tuned model, no agent, no RAG (single shot)
  - **B.** Fine-tuned model, agent loop, no RAG
  - **C.** Sonnet, no agent, no RAG (single shot)
  - **D.** Sonnet, full pipeline (agent + RAG) — current production
  - **E.** Opus, full pipeline — upper bound
- [ ] Report per row: composite eval score, render success, approval status, cost USD, latency seconds.
- [ ] Aggregate: mean score, approval rate, total cost, total time.
- [ ] Use the existing experiment framework — should slot in cleanly.

### Phase 5 — Article + release announcement

- [ ] Write the article around the benchmark table.
- [ ] Publish dataset + model to HuggingFace.
- [ ] LinkedIn post + cross-post to relevant communities (HN, /r/MachineLearning, Build123d Discord).

---

## Working hypotheses (to test, not assume)

| Hypothesis | Expected result | Risk if wrong |
|------------|----------------|---------------|
| Fine-tuned model A beats Sonnet C on first-shot single-call | Yes, by ~1-2 composite-score points | If false: fine-tuning didn't internalize patterns; need more data or different base |
| Fine-tuned model A approaches Sonnet D (full pipeline) | Yes, within ~0.5 points | If false: agent scaffolding is doing more than we think; can't collapse it |
| Fine-tuned + agent (B) beats Sonnet + agent (D) | Yes, by ~1 point | If false: agent loop dominates regardless of model — the model isn't the bottleneck |
| Cost per prompt for fine-tuned drops 5-10× vs Sonnet pipeline | Yes | If false: we get quality parity but no cost win — still a win, but a different story |

---

## Two fine-tune targets, not one

The original framing of this doc treated "the fine-tune" as a single codegen-focused effort. Empirical work in May 2026 surfaced that there are actually two separable, differently-sized fine-tune opportunities:

1. **Conversation-purpose fine-tune (small, fast).** Replaces the OSS chat model's default behaviour on the conversation/intent stage. Sonnet-generated conversation replies (1-2 sentences, no code, after a `[CODEGEN_NEEDED]` tag) are already accumulating in `chat_items`. Training Qwen3.6-27B on (prompt → conciseReply) pairs would fix two observed failure modes at once: (a) Qwen ignoring the "1-2 sentences" instruction (writes 1700+ tokens of intent text) and (b) Qwen burning 6,000+ reasoning tokens on a trivial intent acknowledgement. This is a smaller dataset, smaller LoRA, faster experiment than the codegen target — useful as a proof point before the bigger run.

2. **Codegen-purpose fine-tune (large, the v1 plan).** Original framing — trains the model on workbench-approved (prompt → Build123d code) examples. Closes the API-knowledge gap.

Treat them as distinct experiments. #1 is a "does fine-tuning fix instruction-following on this OSS model" probe with a fast feedback loop. #2 is the dataset-release-grade artifact backing the next LinkedIn post.

## Living notes

Add observations as we learn things. Date entries.

### 2026-05-05
- **First end-to-end Qwen3.6-27B experiment COMPLETED** (100 prompts, workbench_codegen, run `4a0bff08`, ~11h wall-clock 18:06 → 05:07 UTC).
  - **81% auto-approval (81/100), mean composite 8.70**, visual 8.6, code-eval 9.2, assertion pass 100%.
  - Avg 7.0 steps/prompt, 6.6 min/prompt, **31 output tok/s**, **$0.00196/prompt → $0.196 total**.
  - Failure breakdown of the 19 non-approved prompts:
    - **11 × "agent codegen failed to render"** — agent loop ran to step budget without producing renderable code. Sample (`b407ae62` rounded L-shape, 12 steps, 30 min): genuine OCCT geometry failure (`BRep_API: command not done` in `fillet_2d`) the model couldn't fix. This bucket is real codegen weakness, not infra.
    - **6 × pipeline timeout** — 30-min `agent_orchestration` hard timeout, mostly Qwen marathon-thinking on a single step (e.g. `04d4b72d` accumulated 27k+ reasoning tokens with 0 output tokens before abort).
    - **2 × low-score** — `2061586c` ev=7.4 (just below 7.5 threshold), `76e8ad91` ev=3.0 (genuine quality miss).
  - Tool-call validation errors (Qwen omitting `function.arguments`) seen during the run but did not push prompts into the failed bucket — the agent retried and recovered.
- Per-step Qwen reasoning at `low` thinking effort: simple prompts ~14s/step, complex prompts can hit ~30 min on a single step. Conversation purpose was so verbose (1700-token "intent" replies + 6K reasoning) that reverting it to Claude Sonnet was necessary to keep chat path usable.
- Identified two-fine-tune-target framing (see section above): a small conversation-purpose fine-tune to fix Qwen's verbosity + over-thinking on the intent stage, and the original codegen-purpose fine-tune. The conversation one is a fast proof-point and uses the (Sonnet conversation reply) data we're already accumulating.
- **Headline.** Qwen3.6-27B reaches 81% auto-approval at $0.0020/prompt — vs. Sonnet+RAG production which sits at ~85–89% on saturated categories at far higher cost. Pre-fine-tune baseline established. Fine-tune should aim to (a) close the ~5-point quality gap, (b) eliminate marathon-thinking timeouts (the 6 timeout failures alone would bump approval to 87%), (c) keep the cost advantage.

### 2026-05-03
- Doc created. v1 article is published; v2 will be backed by fine-tune results.
- Mission framing: this is about releasing a public training dataset for niche programmatic CAD, not about defending the v1 thesis.
- Empirical signal that training will work: across 4 categories, post-RAG-saturation regen success rate jumped from ~30% to ~89% on previously-failing complex prompts. If 3 in-context atoms produce that lift, fine-tuning on 1,400+ should compound the effect.
- RAG saturation observed in Mechanical Components: after 3 rounds with auto-decomposition active, the gap detector found nothing new to spawn. Approval rate plateaued at 84.4%. Remaining failures are composition / reasoning, not coverage. This is exactly the regime fine-tuning should target.
- **bd_warehouse Examples saturation test (validates the regime).** Started at 86.7% (65/75). Ran 2 rounds with the new inter-round sub-skill drain instrumented. **Both rounds: zero sub-skills spawned.** Each round produced exactly +1 approval (88.0% → 89.3%), consistent with random LLM noise at the threshold rather than the model genuinely learning more. Net cost ~$2.40 for 2 random-noise approvals. Strong evidence that RAG-saturated categories cannot be pushed past ~85-89% by more retrieval — the agent has the atoms, can't compose. This is the strongest argument yet that fine-tuning is the next-best lever; we now have at least 2 saturated categories (Mechanical 84.4%, bd_warehouse 89.3%) that can serve as benchmark categories where the fine-tune should show outsized gains vs Sonnet+RAG. Worth tracking these separately in the held-out benchmark set.

---

## Related docs

- [`roadmap.md`](roadmap.md) — Near-term: fine-tuning section
- [`tool-use-training-datasets.md`](tool-use-training-datasets.md) — Public datasets for fine-tuning tool use
- [`pricing-and-llm-quality-considerations.md`](pricing-and-llm-quality-considerations.md) — Cost economics that motivate fine-tuning
- [`dataset-expansion-plan.md`](dataset-expansion-plan.md) — Plan to grow the dataset to 10K examples
