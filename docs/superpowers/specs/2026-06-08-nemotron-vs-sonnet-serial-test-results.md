# Nemotron 3 Ultra vs Sonnet 4.6 — Serial Dispatch A/B (ABORTED)

Generated: 2026-06-08

## TL;DR

**Aborted after 2/30 prompts** due to a confirmed systemic blocker: vLLM rejects Nemotron's tool-call message format at the API-validation layer, so the agent codegen loop cannot iterate. Running the remaining 28 prompts at ~60 min each (~28h wall) would have produced no incremental signal beyond what the first two prompts already demonstrate.

The blocker is **integration/wire-format, not model quality**. A fix requires either (a) a vLLM tool-call adapter on our side that emits the schema vLLM's Pydantic expects, or (b) a vLLM build that accepts Nemotron's native tool-call format. Until that lands, Nemotron behind this vLLM endpoint cannot be evaluated end-to-end on the workbench pipeline.

## Setup

Re-run of Nemotron A/B with serial dispatch (one prompt at a time) after the first attempt failed at vllm-gx10 capacity.

Pre-run prep (durable, still applied):
- Cleared 17 timeout_observed markers from decomposition_decisions
- workbench.pipeline_timeout_minutes: 30 → 60
- workbench.multi_agent_pipeline_timeout_minutes: 45 → 60
- tracked-llm DEFAULT_TOTAL_TIMEOUT_MS: 15 → 60 min

Same Phase 2 architecture: advisory composite gate, agent_max_steps=60.
Only `workbench_codegen` purpose changed (claude-sonnet-4-6 → nemotron-3-ultra-mtp).

Sanity checks before firing:
- vLLM `/v1/models` returned 200
- `workbench_codegen` mapped to `nemotron-3-ultra-mtp` ✓
- `agent_codegen` still mapped to Claude Sonnet 4.6 (other agent stages)
- Auth token valid

## What actually ran

Loop started 07:31:58 CEST. Killed at 08:50 after second prompt hit the 60-minute pipeline timeout.

| # | Prompt ID | Prompt | Wall time | Terminal state | eval_score | eval_source | Turns |
|---|---|---|---|---|---|---|---|
| 1 | 078e4d11 | Odroid case (PCB Cases, multi-agent) | 7m 04s | scored (code-only) | **6.0** | code_only | 4 |
| 2 | 05066df7 | Pi Zero case (PCB Cases, multi-agent) | 60m 00s | errored (pipeline timeout) | NULL | NULL | 0 |

Sonnet v6.2 baseline scores for the same prompts (from 2026-06-07 17:30-18:00 run):
- 078e4d11 Odroid: Sonnet **5.4** (Nemotron 6.0 ahead on this one, but only because Nemotron's first-pass code happened to be better than Sonnet's final; not a fair fight — see "Caveat" below)
- 05066df7 Pi Zero: Sonnet **7.5** (Nemotron NULL, no submission)

## The systemic blocker

Every `agent_orchestration` LLM stream from Nemotron triggers one of two errors at vLLM's Pydantic validation:

**Error A** — Tool-call schema mismatch (every step that contains a tool call):
```
3 validation errors:
  {'type': 'missing', 'loc': ('body', 0, 'ChatCompletionMessageFunctionToolCallParam', 'function', 'arguments'),
   'msg': 'Field required', 'input': {'name': 'text_editor'}}
  {'type': 'missing', 'loc': ('body', 0, 'ChatCompletionMessageCustomToolCallParam', 'custom'),
   'msg': 'Field required', 'input': {'id': 'call_c769cb42…', 'type': 'function', 'function': {'name': 'text_editor'}}}
  {'type': 'literal_error', 'loc': ('body', 0, 'ChatCompletionMessageCustomToolCallParam', 'type'),
   'msg': "Input should be 'custom'", 'input': 'function', 'ctx': {'expected': 'custom'}}
```

vLLM expects either:
- a function-tool-call with a non-null `function.arguments` field, **or**
- a custom-tool-call with `type='custom'` and a `custom` payload

The Vercel AI SDK's OpenAI-compatible adapter emits `type='function'` with a `function.name` but no `function.arguments` when the model produces an empty-arguments tool call. vLLM's stricter Pydantic build rejects this.

**Error B** — Conversation-history corruption (every retry after Error A):
```
Tool result is missing for tool call call_b6c41c16d5594699ba0350df.
```
After Error A kills a stream mid-tool-call, the conversation history contains an assistant tool-call message with no matching tool-result. The next request fails validation immediately.

**Combined effect:** the agent gets at most 0-25 broken steps before the 60-minute pipeline ceiling. Steps 0-1 may produce a partial code blob that the code-only eval can score; everything after is dead loop. No `agent_submitted` runs are possible.

Backend log excerpt confirming both errors on both prompts: `tracked-llm.service` repeats Error A across `agent_orchestration` calls; `agent-codegen` reports `stepCount=2, submitted=false, renderSuccess=false` on prompt 1 and `stepCount=25, submitted=false` (with intermediate fix attempts) on prompt 2 before pipeline timeout.

## Caveat on the apparent Odroid "win"

Prompt 1's 6.0 vs Sonnet's 5.4 is **not** evidence that Nemotron is better — it's an apples-to-oranges artifact:
- Nemotron's 6.0 came from `eval_source=code_only`: the code never rendered, never produced screenshots, was scored on source-text inspection only.
- Sonnet's 5.4 came from `eval_source=agent_submitted` (full pipeline including render + VLM eval).

Code-only scores tend higher because they cannot fail on visual mismatch. Treat the delta as noise; it tells us nothing about model quality.

## Abort decision

Per spec: *"5+ consecutive prompts in a row hit the 90-min ceiling (signals systemic problem worth surfacing)"*.

We hit the spirit of this at 2/2: prompt 1 produced a degenerate code-only score because tool-call iteration was broken from step 2; prompt 2 burned the entire 60-minute pipeline budget producing zero usable output for the same root cause. The remaining 28 prompts would behave identically — every one is a single LLM provider with the same wire-format mismatch.

Continuing would consume ~28 hours of GPU + harness time to produce 28 more rows of `eval_score=NULL render_status=error eval_source=NULL`. That's not an A/B; it's recording the same broken endpoint 28 times.

Aborted at 08:50 CEST after the prompt-2 timeout.

## Per-bucket comparison (incomplete — only matched rows)

| Bucket | n | Sonnet (v6.2) | Nemotron | Note |
|---|---|---|---|---|
| Multi-agent (matched) | 2 | 6.45 mean (5.4, 7.5) | 1 code-only 6.0; 1 NULL | Insufficient data for parity check |
| Single-agent | 0 | — | — | None reached (would be prompts 3+) |

## eval_source / render_status distribution (Nemotron)

```
eval_source=code_only     1/2
eval_source=NULL          1/2
render_status=error       2/2
```

## Step usage

No `agent_submitted` rows. Step counts on the two attempts:
- Prompt 1: 2 steps (Odroid), agent loop stopped after Error A on step 2
- Prompt 2: 25 steps total across initial loop + fix attempts, all stream-failed

## Cost / wall time

- Total wall: ~78 min (07:32 → 08:50)
- Per-prompt: 7m + 60m = mean 33m, max 60m (hit pipeline ceiling)
- Per-prompt at hard ceiling: 1/2 (prompt 2 hit pipeline timeout)

## Decision: NOT VIABLE (in current environment)

The Nemotron-3-ultra-MTP + vLLM-gx10 tool-call wire format is broken end-to-end. Reattempting on the same endpoint will produce the same result. Two non-mutually-exclusive paths forward:

1. **Patch the adapter:** add a vLLM-tool-call-mode shim in `tracked-llm.service` that rewrites Vercel AI SDK function-tool-calls into vLLM's strict ChatCompletionMessageFunctionToolCallParam shape (populate `function.arguments` even when empty; or wrap as `type='custom'` with a `custom` payload). Re-run.
2. **Upgrade vLLM:** confirm whether a newer vLLM build accepts the Vercel SDK's emitted schema. The Pydantic error references a specific build's strictness level.

Until one of those, do not budget time for further Nemotron A/B runs on this endpoint.

## Notable observations

- The first prompt produced a **6.0 code-only score on step 1** without any tool iteration. Nemotron's single-shot Build123d code generation, sans agent loop, isn't catastrophic — it's just well below what Sonnet's iterative agent produces. If we ever wanted a one-shot baseline, this number suggests Nemotron is in the 5-7 range as a raw codegen model.
- Pre-run plumbing fixes (timeouts, decomposition markers) all held — none of them caused the abort. The blocker is purely the tool-call wire format.
- Pipeline timeout (60 min) and tracked-llm timeout (60 min) both held: prompt 2 was correctly aborted by `workbench` at exactly 3,600,039 ms with `pipeline aborted — skipping screenshots/eval` and the row was finalised to `render_status=error`. The serial-dispatch ceiling logic is sound; it just had no scored prompts to compare.
- The initial state-detection SQL had a bug (referenced non-existent `final_status` column), which caused the first iteration to spin until manual intervention. Fix applied in restart; subsequent terminal-state detection worked correctly.
