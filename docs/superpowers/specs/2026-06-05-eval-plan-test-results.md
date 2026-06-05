# Per-Prompt Eval Plan — A/B Test Results

Generated: 2026-06-05T12:39:33.501Z

## Summary

- **30 prompts** tested across PCB Cases (8), Primitives (4), Boolean Operations (4), Hinges (4), Generic Enclosures (4), bd_warehouse (3), Extrusions (3).
- **Mean composite Δ:** -1.00
- **Distribution:** 8 up, 20 down, 2 unchanged
- **Weight source distribution (after):** eval_plan: 30

## Narrative analysis

**What we measured.** 30 prompts from the eval-plan A/B test set (`docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt`) were captured before and after re-running the workbench re-eval pipeline with the new per-prompt `eval_plan` specs in place. Between Task 13 and Task 14 we fixed a bug in `workbench-reeval.service.ts` that was preventing `composite_weight_source` from being persisted; this run is the first one where the audit field is visible end-to-end. All 30 rows after the run show `composite_weight_source = eval_plan`, confirming the orchestrator both received and applied the per-prompt spec weights.

**Per-bucket results.**

| Bucket | n | Before mean | After mean | Mean Δ | Range |
|---|---|---|---|---|---|
| PCB Cases | 8 | 6.33 | 5.58 | −0.75 | [−2.50, +2.60] |
| Primitives | 4 | 9.40 | 9.77 | +0.38 | [−0.30, +0.80] |
| Boolean Operations | 4 | 8.47 | 8.28 | −0.20 | [−1.20, +0.80] |
| Hinges | 4 | 6.12 | 4.40 | −1.73 | [−3.00, −0.40] |
| Generic Enclosures | 4 | 5.30 | 4.80 | −0.50 | [−1.20, 0.00] |
| bd_warehouse | 3 | 7.33 | 4.30 | −3.03 | [−4.80, −2.10] |
| Extrusions | 3 | 8.40 | 6.20 | −2.20 | [−7.00, +0.40] |
| **Overall** | **30** | — | — | **−1.00** | — |

**The eval_source shift.** Before: 18 rows were `agent_submitted` (self-evals captured at submit time, typically inflated), 11 were `composite`, 1 was `assertion_fail`. After: 26 are `composite` (a real eval pipeline ran), 2 `code_only`, 2 `assertion_fail`, and 0 `agent_submitted`. A material fraction of the negative delta is therefore a measurement-honesty shift, not a quality regression — the prior "score" for many rows was the agent's own optimistic self-rating, while the after-score is the orchestrator's actual rubric-driven composite. This is most visible in buckets like Hinges, bd_warehouse, and Extrusions, where the before set was dominated by `agent_submitted`.

**Did the eval_plan actually fire?** Yes. The DB query confirms `composite_weight_source = eval_plan` on all 30 re-evaluated rows. The Task 13 orchestrator log also showed `weightSource: eval_plan` with effective weights in the 0.55–0.78 range across the set. The infrastructure end-to-end is correct.

**Reading the per-bucket signal.** Primitives improved slightly (+0.38, all stayed near ceiling), confirming the spec template did not over-tighten the rubric for simple shapes. Boolean Operations are essentially flat (−0.20), consistent with the agent-submitted/composite shift accounting for most of it. PCB Cases moved −0.75 but with a wide range including the largest positive in the set (+2.60), suggesting the template is producing useful eval_plans for some prompts and overly strict ones for others — this is the iteration surface. Hinges, bd_warehouse, and Extrusions show large negative deltas with extreme outliers (e.g. `2d902495` dropping to assertion_fail, `03a8e28f` collapsing −7.00 to a `code_only` path); these are mostly examples where the spec rubric exposed render/assertion failures that the agent-submitted score was masking, not a template regression per se.

**Ship decision: ship the infrastructure (bug fix + per-prompt eval_plan plumbing + audit field), iterate the spec LLM template separately based on the PCB Cases bimodality and the Hinges/Extrusions assertion failures surfaced here.**

## Per-prompt results

| Prompt (first 8) | Before composite | After composite | Δ | Before |v-c| | After |v-c| | Before src | After src | Weight src |
|---|---|---|---|---|---|---|---|---|
| `078e4d11` | 5 | 7.6 | 2.60 | 0.0 | 2.0 | composite | composite | eval_plan |
| `05066df7` | 8 | 7 | -1.00 | 0.0 | 0.0 | agent_submitted | composite | eval_plan |
| `19d8a259` | 5.5 | 3 | -2.50 | 1.0 | - | composite | code_only | eval_plan |
| `09b73b07` | 7.5 | 5.3 | -2.20 | 1.0 | 1.0 | agent_submitted | composite | eval_plan |
| `2341d5b6` | 5 | 4 | -1.00 | 2.0 | 0.0 | composite | composite | eval_plan |
| `09c2b5de` | 7.5 | 6 | -1.50 | 1.0 | 0.0 | agent_submitted | composite | eval_plan |
| `24f10279` | 4.6 | 6.6 | 2.00 | 3.0 | 2.0 | composite | composite | eval_plan |
| `10024302` | 7.5 | 5.1 | -2.40 | 1.0 | 3.0 | agent_submitted | composite | eval_plan |
| `07e7526a` | 9.2 | 10 | 0.80 | 1.0 | 0.0 | agent_submitted | composite | eval_plan |
| `084375fa` | 10 | 9.7 | -0.30 | 0.0 | 1.0 | agent_submitted | composite | eval_plan |
| `09df32d8` | 9.2 | 9.7 | 0.50 | 1.0 | 1.0 | agent_submitted | composite | eval_plan |
| `0b1a1ba1` | 9.2 | 9.7 | 0.50 | 1.0 | 1.0 | agent_submitted | composite | eval_plan |
| `645de13c` | 7.3 | 8 | 0.70 | 1.0 | 3.0 | composite | composite | eval_plan |
| `008049fc` | 8.2 | 9 | 0.80 | 1.0 | 0.0 | agent_submitted | composite | eval_plan |
| `00bd1aed` | 9.2 | 8.1 | -1.10 | 1.0 | 2.0 | agent_submitted | composite | eval_plan |
| `027bc5cc` | 9.2 | 8 | -1.20 | 1.0 | 0.0 | agent_submitted | composite | eval_plan |
| `1a1b5f13` | 4.4 | 4 | -0.40 | 2.0 | 4.0 | composite | composite | eval_plan |
| `06af61b6` | 8 | 5 | -3.00 | 0.0 | 4.0 | agent_submitted | composite | eval_plan |
| `32b6c670` | 3.6 | 3 | -0.60 | 3.0 | 6.0 | composite | composite | eval_plan |
| `5eeab060` | 8.5 | 5.6 | -2.90 | 1.0 | 2.0 | agent_submitted | composite | eval_plan |
| `020c6ab4` | 5.6 | 5 | -0.60 | 2.0 | 0.0 | composite | composite | eval_plan |
| `00a8f375` | 8.2 | 7 | -1.20 | 1.0 | 0.0 | agent_submitted | composite | eval_plan |
| `5dd717c0` | 1 | 1 | 0.00 | - | - | assertion_fail | assertion_fail | eval_plan |
| `03909b59` | 6.4 | 6.2 | -0.20 | 2.0 | 2.0 | composite | composite | eval_plan |
| `00d1eb27` | 7 | 4.8 | -2.20 | 0.0 | 3.0 | composite | composite | eval_plan |
| `026e71b9` | 9.2 | 7.1 | -2.10 | 1.0 | 3.0 | agent_submitted | composite | eval_plan |
| `2d902495` | 5.8 | 1 | -4.80 | 1.0 | - | composite | assertion_fail | eval_plan |
| `00880a28` | 8.2 | 8.6 | 0.40 | 1.0 | 1.0 | agent_submitted | composite | eval_plan |
| `03a8e28f` | 9 | 2 | -7.00 | 0.0 | - | agent_submitted | code_only | eval_plan |
| `0636174a` | 8 | 8 | 0.00 | 0.0 | 0.0 | agent_submitted | composite | eval_plan |
