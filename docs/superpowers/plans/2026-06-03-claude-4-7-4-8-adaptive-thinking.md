# Claude 4.7 / 4.8 Adaptive Thinking Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make thinking work for Claude Opus 4.7 and 4.8 (and any future 4.7+ Anthropic models) on Bedrock and direct Anthropic by switching to the new `thinking.type=adaptive` + `output_config.effort` API while keeping the existing `thinking.type=enabled` + `budgetTokens` path working unchanged for Claude 4.6 and earlier.

**Architecture:** Add a small predicate `useAdaptiveThinking(modelName)` that detects 4.7+ Claude model names. In `buildGenerateOptions()`, branch on this predicate: adaptive-style models get `reasoningConfig: { type: "adaptive", maxReasoningEffort }` (Bedrock) or `thinking: { type: "adaptive" }` + `effort` (Anthropic direct); older models keep the existing `type: "enabled"` + `budgetTokens` path. The DB-stored thinking effort levels (`low`/`medium`/`high`/`max`) map 1:1 to the SDK's `maxReasoningEffort` values. Nothing changes for non-Anthropic models or for token accounting (`maxOutputWithThinking()` continues to add the budget headroom — that headroom is harmless for adaptive mode since the SDK no longer auto-adds to `maxTokens`).

**Tech Stack:** TypeScript, `@ai-sdk/amazon-bedrock@^4.0.65` (installed: 4.0.108), `@ai-sdk/anthropic@^3.0.0` (installed: 3.0.79), vitest

---

## Context

### The bug

Recent backend logs show repeated failures for every workbench batch run using `bedrock/global.anthropic.claude-opus-4-7` and `bedrock/global.anthropic.claude-opus-4-8`. The Bedrock InvokeModel call returns:

```
The model returned the following errors: "thinking.type.enabled" is not supported for this model.
Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.
```

This error currently breaks both:
- `agent-multi` decomposition (falls back to single agent — degraded but recovers)
- `agent-codegen` runs (no fallback — the prompt fails entirely)

Older Claude models (4.6 and earlier) still accept `thinking.type=enabled` and must keep working.

### How the AI SDK forwards thinking config

We verified by reading `node_modules/@ai-sdk/amazon-bedrock/dist/index.js` (lines 836–940). For Anthropic models on Bedrock:

| `reasoningConfig.type` | Required co-fields | What the SDK sends to Bedrock |
|---|---|---|
| `"enabled"` | `budgetTokens` | `thinking: { type: "enabled", budget_tokens: N }` + adds N to `maxTokens` |
| `"adaptive"` | `maxReasoningEffort` (and optionally `display`) | `thinking: { type: "adaptive" }` + `output_config: { effort: <"low"\|"medium"\|"high"\|"xhigh"\|"max"> }` |

For direct Anthropic (`@ai-sdk/anthropic` schema at `dist/index.d.ts` lines 173–225), the SDK accepts:
- `thinking: { type: "adaptive", display? }` paired with `effort: "low"|"medium"|"high"|"xhigh"|"max"` at the top level
- `thinking: { type: "enabled", budgetTokens }` (legacy)

### Current code

`packages/backend/src/services/llm-config.service.ts:543-585` (`buildGenerateOptions`) hard-codes `type: "enabled"` for all Anthropic models. This is the single function we must change — all five callers (`agent-codegen`, `agent-multi`, `decomposition-decision`, `spec-generation`, `workbench-prompt-improve`, `curation-llm`, `llm.service` itself) flow through it.

### Effort level mapping

DB stores effort as a string: `low | medium | high | max` (see `THINKING_BUDGETS` at `llm-config.service.ts:149-154`). Map to SDK `maxReasoningEffort`:

| DB value | SDK `maxReasoningEffort` |
|---|---|
| `low` | `"low"` |
| `medium` | `"medium"` |
| `high` | `"high"` |
| `max` | `"max"` |

(SDK's `xhigh` is not currently a DB value — not needed.)

### Model-name detection

We need a predicate that returns `true` for Claude 4.7 and newer. Sample model names from prod DB:

```
global.anthropic.claude-opus-4-6-v1     → false (use enabled)
global.anthropic.claude-sonnet-4-6      → false (use enabled)
global.anthropic.claude-opus-4-7        → true  (use adaptive)
global.anthropic.claude-opus-4-8        → true  (use adaptive)
```

Pattern to detect: model name matches `/claude-(opus|sonnet|haiku)-4-([7-9]|\d{2,})\b/`. This catches Claude 4.7, 4.8, 4.9, 4.10, … 5.x is out of scope (Anthropic numbering will likely jump to 5-0 next major; if/when those arrive, the matcher needs a separate clause or we revisit).

### Why not a DB column

We considered adding `llm_models.thinking_api_style` enum (`enabled` | `adaptive`). Rejected: requires a migration and seeder update for a problem that already has a deterministic name-based answer per Anthropic's pattern. Pattern matching is reversible — if Anthropic changes the rules again, we update the predicate. (YAGNI.)

### Files touched

- Create: `packages/backend/src/services/__tests__/llm-config.thinking.test.ts` — new unit-test file for `buildGenerateOptions` thinking branches (no existing test covers this function)
- Modify: `packages/backend/src/services/llm-config.service.ts` — add `useAdaptiveThinking()` + branch in `buildGenerateOptions()`

No DB migration. No callsite changes. No new public API surface.

### Verification

- Vitest unit tests for the helper and `buildGenerateOptions` for all four branches: (older Bedrock / new Bedrock / older Anthropic / new Anthropic).
- Manual Docker rebuild of backend, retry one of the failing prompts on `claude-opus-4-7` or `claude-opus-4-8` (or trigger a batch run from the workbench UI) and confirm via logs that the stream no longer errors with `thinking.type.enabled`.

---

## Task 1: Add `useAdaptiveThinking` predicate + unit tests

**Files:**
- Create: `packages/backend/src/services/__tests__/llm-config.thinking.test.ts`
- Modify: `packages/backend/src/services/llm-config.service.ts` (insert helper near the existing `thinkingBudget` function around line 156)

- [ ] **Step 1: Write the failing tests for `useAdaptiveThinking`**

Create `packages/backend/src/services/__tests__/llm-config.thinking.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { useAdaptiveThinking } from "../llm-config.service.js";

describe("useAdaptiveThinking", () => {
  it("returns true for Claude Opus 4.7 (bedrock global tag)", () => {
    expect(useAdaptiveThinking("global.anthropic.claude-opus-4-7")).toBe(true);
  });

  it("returns true for Claude Opus 4.8 (bedrock global tag)", () => {
    expect(useAdaptiveThinking("global.anthropic.claude-opus-4-8")).toBe(true);
  });

  it("returns true for Claude Sonnet 4.7 direct (anthropic SDK id)", () => {
    expect(useAdaptiveThinking("claude-sonnet-4-7")).toBe(true);
  });

  it("returns true for Claude Haiku 4.10 (future double-digit minor)", () => {
    expect(useAdaptiveThinking("claude-haiku-4-10")).toBe(true);
  });

  it("returns false for Claude Opus 4.6 (legacy enabled style)", () => {
    expect(useAdaptiveThinking("global.anthropic.claude-opus-4-6-v1")).toBe(false);
  });

  it("returns false for Claude Sonnet 4.6", () => {
    expect(useAdaptiveThinking("global.anthropic.claude-sonnet-4-6")).toBe(false);
  });

  it("returns false for Claude 4.5 / 4.0 / 3.x", () => {
    expect(useAdaptiveThinking("claude-opus-4-5-20251101")).toBe(false);
    expect(useAdaptiveThinking("claude-sonnet-4-20250514")).toBe(false);
    expect(useAdaptiveThinking("claude-3-7-sonnet-20250219-v1:0")).toBe(false);
  });

  it("returns false for non-Claude model names", () => {
    expect(useAdaptiveThinking("gpt-oss-120b")).toBe(false);
    expect(useAdaptiveThinking("Qwen3.5-397B-A17B-int4")).toBe(false);
    expect(useAdaptiveThinking("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose run --rm backend npx vitest run src/services/__tests__/llm-config.thinking.test.ts
```

Expected: FAIL — `useAdaptiveThinking is not a function` or similar import error.

- [ ] **Step 3: Add `useAdaptiveThinking` to `llm-config.service.ts`**

Insert this block immediately after the `maxOutputWithThinking` function (currently ending at line 175). Match the existing comment style:

```typescript
// ── Adaptive vs enabled thinking detection ──────────────────────────
// Claude Opus/Sonnet/Haiku 4.7 and later require the new
// `thinking.type=adaptive` + `output_config.effort` shape on Bedrock
// and the Anthropic direct API. Earlier models (4.6 and below) still
// require `thinking.type=enabled` + `budgetTokens` and reject `adaptive`.
//
// Match strategy: name contains `claude-(opus|sonnet|haiku)-4-N` where
// N >= 7 OR N has two or more digits. This works regardless of provider
// prefix (`global.anthropic.`, `us.anthropic.`, bare anthropic SDK id).
const ADAPTIVE_THINKING_PATTERN = /claude-(?:opus|sonnet|haiku)-4-(?:[7-9]|\d{2,})\b/;

export function useAdaptiveThinking(modelName: string): boolean {
  return ADAPTIVE_THINKING_PATTERN.test(modelName);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose run --rm backend npx vitest run src/services/__tests__/llm-config.thinking.test.ts
```

Expected: PASS — all 9 assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/llm-config.service.ts \
        packages/backend/src/services/__tests__/llm-config.thinking.test.ts
git commit -m "$(cat <<'EOF'
Add useAdaptiveThinking() predicate for Claude 4.7+

Detects Claude Opus/Sonnet/Haiku 4.7 and newer model names so we can
switch them to the adaptive thinking API in a follow-up step. Older
models keep the legacy budgetTokens path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Branch `buildGenerateOptions` on the predicate

**Files:**
- Modify: `packages/backend/src/services/llm-config.service.ts:543-585`
- Modify: `packages/backend/src/services/__tests__/llm-config.thinking.test.ts` (extend with `buildGenerateOptions` cases)

- [ ] **Step 1: Write failing tests for the four `buildGenerateOptions` thinking branches**

Append to `packages/backend/src/services/__tests__/llm-config.thinking.test.ts`:

```typescript
import { buildGenerateOptions, type LlmModelConfig } from "../llm-config.service.js";

function cfg(overrides: Partial<LlmModelConfig>): LlmModelConfig {
  return {
    id: "test-id",
    provider: "bedrock",
    providerType: null,
    modelName: "global.anthropic.claude-opus-4-6-v1",
    displayName: "test",
    label: "test/label",
    costPer1mInput: 0,
    costPer1mOutput: 0,
    maxOutputTokens: 4096,
    maxContextTokens: 200000,
    supportsThinking: true,
    thinkingEffort: "medium",
    supportsVision: false,
    supportsEmbeddings: false,
    streamingEnabled: true,
    vlmEvalPreamble: null,
    endpointUrl: null,
    apiKey: "test",
    maxConcurrent: null,
    ...overrides,
  };
}

describe("buildGenerateOptions — thinking config", () => {
  it("Bedrock 4.6 → reasoningConfig.type=enabled with budgetTokens", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "bedrock", modelName: "global.anthropic.claude-opus-4-6-v1", thinkingEffort: "medium" }),
    );
    expect(opts.providerOptions).toEqual({
      bedrock: { reasoningConfig: { type: "enabled", budgetTokens: 4096 } },
    });
  });

  it("Bedrock 4.7 → reasoningConfig.type=adaptive with maxReasoningEffort", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "bedrock", modelName: "global.anthropic.claude-opus-4-7", thinkingEffort: "medium" }),
    );
    expect(opts.providerOptions).toEqual({
      bedrock: { reasoningConfig: { type: "adaptive", maxReasoningEffort: "medium" } },
    });
  });

  it("Bedrock 4.8 with high effort → maxReasoningEffort=high", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "bedrock", modelName: "global.anthropic.claude-opus-4-8", thinkingEffort: "high" }),
    );
    expect(opts.providerOptions).toEqual({
      bedrock: { reasoningConfig: { type: "adaptive", maxReasoningEffort: "high" } },
    });
  });

  it("Anthropic direct 4.6 → thinking.type=enabled with budgetTokens", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "anthropic", modelName: "claude-opus-4-6", thinkingEffort: "low" }),
    );
    expect(opts.providerOptions).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 1024 } },
    });
  });

  it("Anthropic direct 4.7 → thinking.type=adaptive + top-level effort", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "anthropic", modelName: "claude-opus-4-7", thinkingEffort: "max" }),
    );
    expect(opts.providerOptions).toEqual({
      anthropic: { thinking: { type: "adaptive" }, effort: "max" },
    });
  });

  it("thinking disabled (no effort) → no thinking provider option", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "bedrock", modelName: "global.anthropic.claude-opus-4-7", thinkingEffort: null }),
    );
    expect(opts.providerOptions).toBeUndefined();
  });

  it("supportsThinking=false → no thinking provider option even with 4.7 name", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "bedrock", modelName: "global.anthropic.claude-opus-4-7", supportsThinking: false }),
    );
    expect(opts.providerOptions).toBeUndefined();
  });

  it("unknown effort string → no thinking provider option (budget=0)", () => {
    const opts = buildGenerateOptions(
      cfg({ provider: "bedrock", modelName: "global.anthropic.claude-opus-4-7", thinkingEffort: "bogus" }),
    );
    expect(opts.providerOptions).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
docker compose run --rm backend npx vitest run src/services/__tests__/llm-config.thinking.test.ts
```

Expected: the 9 `useAdaptiveThinking` tests pass, but the 4 adaptive-branch tests (`Bedrock 4.7`, `Bedrock 4.8`, `Anthropic direct 4.7`) FAIL because `buildGenerateOptions` still emits the `enabled` shape for all Anthropic models.

- [ ] **Step 3: Update `buildGenerateOptions` to branch on `useAdaptiveThinking`**

In `packages/backend/src/services/llm-config.service.ts`, replace the thinking block inside `buildGenerateOptions` (currently lines 552-570). Find:

```typescript
  // Anthropic thinking/reasoning (direct API and Bedrock). Always use
  // the documented `type: "enabled"` shape with an explicit budgetTokens —
  // this is the only thinking config the @ai-sdk/amazon-bedrock and
  // @ai-sdk/anthropic providers actually forward to the upstream API.
  const type = sdkType(cfg);
  if (cfg.supportsThinking && cfg.thinkingEffort) {
    const budget = thinkingBudget(cfg.thinkingEffort);
    if (budget > 0) {
      if (type === "bedrock") {
        providerOptions.bedrock = {
          reasoningConfig: { type: "enabled", budgetTokens: budget },
        };
      } else {
        providerOptions.anthropic = {
          thinking: { type: "enabled", budgetTokens: budget },
        };
      }
    }
  }
```

Replace with:

```typescript
  // Anthropic thinking/reasoning (direct API and Bedrock). Claude 4.7+
  // requires the adaptive API; earlier Claude models require the legacy
  // budgetTokens API and reject `adaptive`. See useAdaptiveThinking().
  const type = sdkType(cfg);
  if (cfg.supportsThinking && cfg.thinkingEffort) {
    const adaptive = useAdaptiveThinking(cfg.modelName);
    const budget = thinkingBudget(cfg.thinkingEffort);
    if (adaptive) {
      // Effort levels in our DB (`low|medium|high|max`) are a subset of
      // the SDK's `maxReasoningEffort` enum and pass through unchanged.
      const effort = cfg.thinkingEffort;
      if (type === "bedrock") {
        providerOptions.bedrock = {
          reasoningConfig: { type: "adaptive", maxReasoningEffort: effort },
        };
      } else if (type === "anthropic") {
        providerOptions.anthropic = {
          thinking: { type: "adaptive" },
          effort,
        };
      }
    } else if (budget > 0) {
      if (type === "bedrock") {
        providerOptions.bedrock = {
          reasoningConfig: { type: "enabled", budgetTokens: budget },
        };
      } else if (type === "anthropic") {
        providerOptions.anthropic = {
          thinking: { type: "enabled", budgetTokens: budget },
        };
      }
    }
  }
```

Note the two intentional differences vs. the old code:
1. The outer `else` for the `enabled` branch is now `else if (type === "anthropic")` rather than a bare `else`, matching the new adaptive branch — the original code's bare `else` was a latent bug that would have written an `anthropic` provider option for non-Anthropic providers (e.g., openai-compatible) if they ever set `supportsThinking=true`. We constrain both branches to known types.
2. We drop the `// The previous "adaptive" config ... was silently dropped by the AI SDK Bedrock provider` comment from `THINKING_BUDGETS` (lines 144-147) — the comment is now wrong (the SDK does forward it, as of the installed 4.0.108) and would mislead a future reader.

Also update the comment block at lines 140-148 to remove the obsolete claim. Find:

```typescript
// ── Thinking budget mapping ──────────────────────────────────────────
// Effort levels map to thinking-token budgets used by Claude's
// `thinking: { type: "enabled", budgetTokens: N }` provider option.
// Both the direct Anthropic SDK and the AWS Bedrock SDK accept this
// shape (Bedrock as `reasoningConfig`). The previous "adaptive" config
// (`type: "adaptive"`, `maxReasoningEffort`) was silently dropped by
// the AI SDK Bedrock provider — see DB evidence: 0 reasoning_tokens
// across 9k+ Sonnet 4.6 events. Always use `type: "enabled"`.
```

Replace with:

```typescript
// ── Thinking budget mapping ──────────────────────────────────────────
// Effort levels map to thinking-token budgets used by Claude's
// `thinking: { type: "enabled", budgetTokens: N }` provider option
// (used for Claude 4.6 and earlier). Claude 4.7+ uses the adaptive
// API and ignores budgetTokens — see useAdaptiveThinking(). The
// budgets here still drive maxOutputWithThinking() in both modes so
// max_tokens has headroom for the model to think.
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
docker compose run --rm backend npx vitest run src/services/__tests__/llm-config.thinking.test.ts
```

Expected: all 17 assertions PASS (9 predicate + 8 buildGenerateOptions).

- [ ] **Step 5: Run the wider backend test suite to check for regressions**

```bash
docker compose run --rm backend npx vitest run
```

Expected: same pass/fail count as before the change. (The repo currently reports 343/344 passing per the most recent commit message; this change should not move that needle.)

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/llm-config.service.ts \
        packages/backend/src/services/__tests__/llm-config.thinking.test.ts
git commit -m "$(cat <<'EOF'
Use adaptive thinking API for Claude 4.7+ on Bedrock and Anthropic

Claude Opus 4.7 and 4.8 reject thinking.type=enabled with:
  "thinking.type.enabled" is not supported for this model.
  Use "thinking.type.adaptive" and "output_config.effort"

Switch buildGenerateOptions to emit the adaptive shape for any
Claude 4.7+ model (detected by name) while keeping the existing
budgetTokens path for 4.6 and earlier. Effort levels (low/medium/
high/max) pass through unchanged to maxReasoningEffort.

Fixes batch generation failures for global.anthropic.claude-opus-4-7
and global.anthropic.claude-opus-4-8 seen in recent workbench runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Rebuild backend and verify a live 4.7 / 4.8 run succeeds

**Files:** none changed (verification only).

- [ ] **Step 1: Rebuild and restart the backend container**

```bash
docker compose build backend && docker compose up -d backend
```

Expected: build finishes without TypeScript errors; the new container starts.

- [ ] **Step 2: Tail backend logs for thinking errors**

In one terminal:

```bash
docker compose logs -f backend 2>&1 | grep -iE "thinking|claude-opus-4-(7|8)"
```

Leave this running for the next step.

- [ ] **Step 3: Trigger a workbench batch run on a 4.7 or 4.8 model**

Either:
- Pick a small batch in the workbench UI (Admin → Workbench → Run Batch) with `bedrock/global.anthropic.claude-opus-4-7` as the codegen model, OR
- Re-run any one of the prompts that failed in the logs (e.g., the IDs `21aba22c-…` or `5dd717c0-…` listed in the bug report) via the curation/workbench UI.

If neither is convenient, run the existing test-prompt script with an opus-4-7 override:

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
# Find the model id for opus-4-7
MODEL_ID=$(curl -s http://localhost/api/admin/llm-models -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; m=[r for r in json.load(sys.stdin) if r['model_name']=='global.anthropic.claude-opus-4-7'][0]; print(m['id'])")
echo "opus-4-7 model id: $MODEL_ID"
# (Then trigger a batch run via the appropriate admin endpoint — exact endpoint depends on
# the current workbench-batch API; see packages/backend/src/routes/admin/workbench.routes.ts.)
```

- [ ] **Step 4: Confirm no `thinking.type.enabled` error appears**

In the log-tail window, you should see successful streaming for the 4.7 / 4.8 model. You should NOT see:

```
"thinking.type.enabled" is not supported for this model
```

Expected: agent codegen loop runs through to completion (`agent codegen complete` or similar) and `workbench-batch` does not log `prompt generation failed` with the thinking error.

- [ ] **Step 5: Verify older Claude models still work**

Trigger one batch run on `bedrock/global.anthropic.claude-opus-4-6-v1` or `bedrock/global.anthropic.claude-sonnet-4-6` and confirm it still succeeds (still using the legacy `thinking.type=enabled` path).

Check the request reaches Bedrock with the right shape by looking for the AI SDK's debug logs or the existing `tracked-llm` logs — there is no separate "thinking style" log line, but the absence of an error and presence of `reasoning_tokens > 0` in `usage` events is the success signal.

- [ ] **Step 6: Final commit if anything changed during verification**

If verification surfaced no issues, no commit needed. If a tiny fix was required, commit it as a follow-up rather than amending Task 2.

---

## Out of scope

- Adding `xhigh` as a DB effort level: SDK supports it but we currently don't use it. Add when a use case appears.
- Switching older Claude models (4.6 and earlier) to adaptive: not needed and likely impossible per Bedrock's per-model API constraints.
- Adding a per-model `thinking_api_style` DB column: rejected as premature complexity (see Context).
- Forward-compat for Claude 5.x: the predicate matches `4-N` only; when 5.x arrives we update the predicate and add tests in the same shape as Task 1.
- Upgrading `@ai-sdk/*` packages: installed versions already include adaptive support; no upgrade required.
