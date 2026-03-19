# Pricing & LLM Quality Considerations

## Pricing Tiers

| | Starter | Pro | Team |
|---|---|---|---|
| Price | EUR 20/month | EUR 49/month | TBD |
| Trial | -- | 7-day free trial | -- |
| Generations | Limited per month | Increased per month | TBD |
| Exports | STL, 3MF | STL, 3MF, STEP | TBD |
| Users | Single user | Single user | Multi-user |
| Rendering | Queued (local model) | Priority (commercial API) | TBD |

During the early access period, free trial access is offered to select waitlist members.

## Generation Cost Analysis

### Commercial API Costs

Per-generation costs vary widely depending on complexity:

| Complexity | Estimated cost | Example |
|---|---|---|
| Simple (single object, basic shape) | EUR 0.02--0.10 | "Make a cube with rounded edges" |
| Medium (multi-part, moderate detail) | EUR 0.50--1.00 | "Create a phone stand with cable slot" |
| Complex (assemblies, multi-turn refinement) | EUR 2.00--5.00+ | Multi-turn conversation refining a gearbox |

The two-stage pipeline (conversation LLM + code generation LLM) means each generation involves at least two LLM calls plus rendering compute.

### Margin Risk at Current Pricing

| Scenario | Avg cost/gen | Starter (EUR 20) break-even | Pro (EUR 49) break-even |
|---|---|---|---|
| Mostly simple | ~EUR 0.10 | ~200 generations | ~490 generations |
| Mixed usage | ~EUR 0.75 | ~27 generations | ~65 generations |
| Power user (complex) | ~EUR 3.00 | ~7 generations | ~16 generations |

Starter is thin on margin. Generation caps must be set carefully to avoid losses on heavy users.

## Local Inference Strategy

### Hardware: Dual DGX Spark Cluster

- Investment: EUR 5,000
- Power consumption: 50W idle, 300W max during generation
- Electricity cost: EUR 0.29/kWh
- Target model: Qwen3.5-122B (fine-tuned on Chat3D training data)
- Expected throughput: 20--30 tokens per second

### Electricity Costs (24/7 Operation)

| Utilization | Avg power | Monthly kWh | Monthly cost |
|---|---|---|---|
| Always idle | 50W | 36 kWh | EUR 10 |
| 20% utilization | ~100W | 72 kWh | EUR 21 |
| 50% utilization | ~175W | 126 kWh | EUR 37 |
| Full blast 24/7 | 300W | 216 kWh | EUR 63 |

### Generation Throughput

Assuming ~1,000--1,500 output tokens per generation (conversation + code gen combined):

| | 20 tps | 30 tps |
|---|---|---|
| Time per generation | ~50--75s | ~33--50s |
| Max generations/day (theoretical) | ~1,150--1,700 | ~1,700--2,600 |
| Max generations/month (at ~60% efficiency) | ~21,000--31,000 | ~31,000--47,000 |

### Local vs. Commercial API Cost Comparison

| | Local (12-mo payoff) | Commercial API |
|---|---|---|
| Fixed cost/month | ~EUR 440 | EUR 0 |
| Cost per generation | ~EUR 0.01--0.02 | EUR 0.10--5.00 |
| 1,000 gens/month | EUR 440 total | EUR 500--2,000 |
| 5,000 gens/month | EUR 440 total | EUR 2,500--10,000 |

Local inference becomes cheaper than commercial APIs after roughly 200--500 generations per month, depending on complexity mix.

### Hardware Amortization

| Payoff period | Hardware/month | + Electricity (20% util) | Total fixed cost/month |
|---|---|---|---|
| 12 months | EUR 417 | EUR 21 | EUR 438 |
| 18 months | EUR 278 | EUR 21 | EUR 299 |
| 24 months | EUR 208 | EUR 21 | EUR 229 |

### Break-Even in Subscribers

| Payoff period | Starter subs needed (EUR 20) | Pro subs needed (EUR 49) |
|---|---|---|
| 12 months | ~22 | ~9 |
| 24 months | ~12 | ~5 |

After hardware payoff, running costs drop to ~EUR 21/month electricity -- essentially pure margin.

### Scaling Options

If fine-tuned Qwen 122B quality is insufficient, additional DGX Spark machines can be added:

| Setup | Model | Est. TPS | Additional cost | Monthly electricity |
|---|---|---|---|---|
| 1x DGX Spark (current) | Qwen 122B | 20--30 | EUR 5,000 (paid) | ~EUR 21 |
| 2x DGX Spark | Qwen 122B (faster) or ~200B | 10--20 | +EUR 5,000 | ~EUR 42 |
| 3x DGX Spark | Up to ~300B | 5--15 | +EUR 10,000 | ~EUR 63 |

Even at 3 machines (EUR 15,000 total), ~50 Starter subscribers cover 12-month payoff. The economics hold at scale.

## Fine-Tuning Roadmap

### Training Data Pipeline

The curation pipeline (distillation, tagging, approval workflow) feeds the training dataset:

- **First fine-tune target:** ~1,000 curated examples
- **12-month goal:** 10,000 examples from admin curation + user contributions
- **Data sources:** Admin-curated high-quality examples, user-submitted examples (quality-gated through curation pipeline)

### Quality Gate for Training Data

User-submitted examples must pass through the curation pipeline to avoid diluting the dataset with mediocre examples. Only admin-approved, distilled, and tagged examples enter the training set.

## Phased Rollout Strategy

### Phase 1: Data Collection (Current)

- Serve all traffic via commercial APIs
- Build training dataset through curation pipeline
- Instrument generation pipeline to capture baseline metrics

### Phase 2: First Fine-Tune & Shadow Testing

- Fine-tune Qwen3.5-122B on ~1,000 examples
- Run fine-tuned model in shadow mode (generate but don't serve to users)
- Compare outputs against commercial API results on a benchmark set

### Phase 3: Gradual Traffic Splitting

Route increasing percentages of Starter traffic to the local model while monitoring:

- **Percentage-based:** 10% -> 25% -> 50% -> 100% of Starter traffic
- **Complexity-based:** Simple prompts to local model first, complex prompts stay on commercial API
- **Hybrid fallback:** Local model gets first attempt; if it fails validation/lint, fall back to commercial API transparently

### Phase 4: Full Tier Split

- **Starter:** Local fine-tuned model, queued, ~EUR 0.01/gen
- **Pro:** Commercial API, priority/no queue, higher quality guarantee

## Traffic Splitting Strategies

Multiple approaches can be combined:

1. **Percentage-based routing:** Gradually increase local model share while monitoring quality metrics
2. **Complexity-based routing:** Route by estimated prompt complexity -- simple shapes to local, assemblies to commercial API
3. **Pipeline stage splitting:** Use local model for conversation/intent stage, commercial API for code generation (or vice versa, based on which stage the fine-tune handles better)
4. **Draft-and-refine:** Local model generates first pass cheaply; commercial API only called if output fails validation. Could cut API costs 60--80% even before fine-tune is production-ready.
5. **User-facing quality toggle:** "Fast generation" (local) vs. "High quality" (API) -- lets users self-select, provides preference data for calibration

## Metrics to Track Per Model

| Metric | Purpose |
|---|---|
| First-attempt success rate | Valid Build123d code on first try |
| Retry count | How many attempts before valid output |
| Lint violations by rule | Which code quality rules the model struggles with |
| Render success rate | Code compiles and produces valid 3D output |
| User rating distribution | Subjective quality assessment |
| Token count per generation | Cost tracking |
| Generation time | Latency / queue time tracking |
| Cost per successful generation | True cost including retries and fallbacks |

### Quality Benchmark

Before deploying the fine-tuned model, define a benchmark of ~50 representative prompts across difficulty levels. Run through both fine-tuned and commercial models, compare on all metrics above. This establishes the quality gap and informs routing decisions.

## Key Risks

1. **Fine-tuned model quality:** If the Qwen 122B fine-tune doesn't reach ~80%+ of commercial API quality on Build123d code, Starter users churn and hardware sits underutilized.
2. **Starter margin:** Without strict generation caps, heavy users make Starter unprofitable even on commercial APIs.
3. **Trial abuse on Pro:** Power users could consume EUR 15--50 in API costs during the 7-day trial without converting. Consider capping trial generations rather than offering unlimited time-based access.
4. **Training data quality:** User-submitted examples need rigorous quality gating to avoid degrading the fine-tune.
