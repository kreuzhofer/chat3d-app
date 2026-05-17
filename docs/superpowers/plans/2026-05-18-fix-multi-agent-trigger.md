# Fix Multi-Agent Decomposition Trigger — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-agent decomposition fire for prompts that actually need it (both chat and workbench), by routing on a **spec-LLM-emitted decomposition decision** instead of the broken operation-count threshold. Persist the decision + reasoning to traces so we can audit and tune retrospectively. Same logic on both surfaces — no category dependency.

**Architecture:** The spec LLM already runs before every codegen attempt and produces `SpecResult.complexity` ∈ {simple, medium, complex}. Today that value comes from a regex-on-prompt heuristic (`deriveComplexity()`) that almost never returns `"complex"` (1 of 3,208 production traces — see `docs/codegen-harness-audit.md` §6.4.5 N1). This plan extends the spec LLM output with `requiresDecomposition: boolean` + `decompositionReasoning: string`; when the LLM returns `true`, the parser sets `complexity = "complex"` and routing flips. Multi-part regex stays as a deterministic safety net (cheap; matches "snap-fit", "hinged lid", etc.). Operation-count threshold is retired. Trace root node persists `complexityTriggerReason` so post-hoc analysis is clean.

**Tech Stack:** TypeScript (strict), vitest for unit tests, Prisma ORM (one migration), pino logger. No frontend changes (admin settings already render new keys; the new spec fields surface in existing admin views via the trace).

**Why this matters:** Harness audit §6.4.5 N1. Spec-LLM routing works for chat *and* workbench identically (chat has no workbench category, which is why the earlier category-floor proposal was wrong). The decision-with-reasoning persisted in traces gives us the data to tune over time. The strategic upside: harness improvements amplify the value of cheaper OSS models (e.g. Qwen3.6 27B base + FT) — Claude can sometimes brute-force complex prompts solo; small models need the harness to scaffold for them.

**Scope NOT in this plan:**
- Rebuilding `detectPromptOperations()` — operation-count is now retired as the multi-agent trigger; if we still want it for other purposes (tier-2 prompt section selection) it can be a separate plan.
- Tuning the multi-agent decomposition prompt itself — that's a separate optimisation pass once we have routing data.
- Extending eval to chat — referenced in the harness audit but a separate plan.

---

## File Map

| File | Action | What it owns |
|---|---|---|
| `packages/shared/src/trace-types.ts` | Modify | Add `ComplexityTriggerReason` type + `complexityTriggerReason?` field on root node metadata |
| `packages/backend/src/services/spec-generation.service.ts` | Modify | Extend `SpecResult` with `requiresDecomposition` + `decompositionReasoning`; extend system prompt with rule #9; extend parser; override `complexity` when LLM says decompose; retire op-count branch in `deriveComplexity` (regex stays as fallback) |
| `packages/backend/prisma/migrations/20260518000000_spec_decomposition_fields/migration.sql` | Create | Add `requires_decomposition BOOLEAN` and `decomposition_reasoning TEXT` columns to `workbench_example_prompts` |
| `packages/backend/prisma/schema.prisma` | Modify | Mirror the two new fields on `WorkbenchExamplePrompt` |
| `packages/backend/src/services/workbench-codegen.service.ts` | Modify | Persist the two new fields when storing spec results; set `complexityTriggerReason` on trace |
| `packages/backend/src/services/query.service.ts` | Modify | Set `complexityTriggerReason` on trace for chat-side spec calls (chat has no per-prompt persistence layer; the field lives only on the trace there) |
| `packages/backend/src/services/trace-builder.service.ts` | Modify | One-line setter: `setComplexityTriggerReason(reason)` on root node metadata |
| `packages/backend/src/__tests__/spec-generation.test.ts` | Modify | Add tests for parser of new fields + complexity-override behaviour |
| `packages/backend/src/__tests__/multi-agent-trigger.integration.test.ts` | Create | Integration test: stub spec LLM response with `requiresDecomposition: true`, confirm the parser routes complexity → "complex" and trigger reason is set |
| `scripts/validate-multi-agent-trigger.sh` | Create | Helper to run the d8ac9bae fake-model validation (per-prompt comparison query + summary report) |
| `docs/codegen-pipeline-and-workbench.md` | Modify | §3.4 — describe the new trigger logic |
| `docs/codegen-harness-audit.md` | Modify | §6.4.5 N1 status update; §9 changelog |

One DB migration. No frontend changes.

---

## Task 1: Add the `ComplexityTriggerReason` shared type

**Files:**
- Modify: `packages/shared/src/trace-types.ts` (append to file)

- [ ] **Step 1: Find the right insertion point**

Run: `grep -nE "^export (type|interface)" packages/shared/src/trace-types.ts | head -10`
Expected: shows existing exported types so you know where literal-union types live in this file.

- [ ] **Step 2: Add the type**

Edit `packages/shared/src/trace-types.ts` and append (or place alongside other small literal-union types):

```ts
/**
 * Why a generation run was routed to single-agent vs multi-agent.
 *
 * - `spec_llm_decision`: the spec LLM emitted `requiresDecomposition: true`
 * - `multi_part_pattern`: prompt or interpretation matched the multi-part regex
 *   (snap-fit, hinged lid, clamshell, etc.) — fires without paying the LLM cost
 * - `single_agent_default`: none of the above — routed single-agent
 * - `spec_unavailable`: spec generation was disabled or failed; routing defaulted
 *   to single-agent without any signal
 */
export type ComplexityTriggerReason =
  | "spec_llm_decision"
  | "multi_part_pattern"
  | "single_agent_default"
  | "spec_unavailable";
```

- [ ] **Step 3: Build the shared package**

Run: `cd packages/shared && npx tsc -p tsconfig.json`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/trace-types.ts
git commit -m "shared: add ComplexityTriggerReason for multi-agent routing observability"
```

---

## Task 2: Add `complexityTriggerReason` to the trace root metadata

**Files:**
- Modify: `packages/shared/src/trace-types.ts` (root-node metadata interface)
- Modify: `packages/backend/src/services/trace-builder.service.ts` (add setter)

- [ ] **Step 1: Find the root-node metadata interface**

Run: `grep -nE "TraceRootMeta|TraceMetadata|interface.*Root" packages/shared/src/trace-types.ts | head -10`
Expected: shows the interface name (likely `TraceMetadata` or `TraceRootMeta`).

- [ ] **Step 2: Add the optional field**

Edit `packages/shared/src/trace-types.ts`. Inside the root-node metadata interface (name varies), add:

```ts
  /**
   * Why the pipeline routed to multi-agent vs single-agent.
   * Absent on traces that predate this field.
   */
  complexityTriggerReason?: ComplexityTriggerReason;
```

`ComplexityTriggerReason` is in the same file (Task 1) so no import is needed.

- [ ] **Step 3: Rebuild shared**

Run: `cd packages/shared && npx tsc -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Find the trace-builder setter pattern**

Run: `grep -nE "setPipelineType|setSourceContext" packages/backend/src/services/trace-builder.service.ts | head -10`
Expected: shows existing setter methods on the trace builder, e.g. `setPipelineType(...)`. Mirror that pattern.

- [ ] **Step 5: Add the setter**

Edit `packages/backend/src/services/trace-builder.service.ts`. Near the existing `setPipelineType` method, add (match the actual root-mutation pattern that `setPipelineType` already uses):

```ts
setComplexityTriggerReason(reason: ComplexityTriggerReason): void {
  // Same mutation pattern as setPipelineType.
  const root = this.findRoot();
  if (root) {
    (root as { complexityTriggerReason?: ComplexityTriggerReason }).complexityTriggerReason = reason;
  }
}
```

Add the import at the top of the file:

```ts
import type { ComplexityTriggerReason } from "@chat3d/shared";
```

- [ ] **Step 6: Verify build**

Run: `cd packages/backend && npx tsc -p tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/trace-types.ts packages/backend/src/services/trace-builder.service.ts
git commit -m "trace: add complexityTriggerReason setter on root node"
```

---

## Task 3: Database migration — persist decomposition decision on prompts

**Files:**
- Create: `packages/backend/prisma/migrations/20260518000000_spec_decomposition_fields/migration.sql`
- Modify: `packages/backend/prisma/schema.prisma`

We persist the LLM's decision + reasoning on the prompt row so post-hoc analysis (per-category, per-prompt) is a single SQL query.

- [ ] **Step 1: Create the migration directory and file**

```bash
mkdir -p packages/backend/prisma/migrations/20260518000000_spec_decomposition_fields
```

Then create `packages/backend/prisma/migrations/20260518000000_spec_decomposition_fields/migration.sql` with:

```sql
ALTER TABLE "workbench_example_prompts"
  ADD COLUMN "requires_decomposition" BOOLEAN,
  ADD COLUMN "decomposition_reasoning" TEXT;

COMMENT ON COLUMN "workbench_example_prompts"."requires_decomposition" IS
  'Spec LLM verdict — true means the prompt was routed to multi-agent codegen';
COMMENT ON COLUMN "workbench_example_prompts"."decomposition_reasoning" IS
  'Spec LLM''s short rationale for the requires_decomposition decision';
```

- [ ] **Step 2: Mirror in Prisma schema**

Edit `packages/backend/prisma/schema.prisma`. Find `model WorkbenchExamplePrompt {` and add inside the block (alongside the other optional spec fields like `specRawResponse`):

```prisma
  requiresDecomposition   Boolean? @map("requires_decomposition")
  decompositionReasoning  String?  @db.Text @map("decomposition_reasoning")
```

- [ ] **Step 3: Run the migration locally**

```bash
docker compose up -d postgres
cd packages/backend && npx prisma migrate deploy
npx prisma generate
```

Expected: `Applied migration: 20260518000000_spec_decomposition_fields`; Prisma client regenerated.

- [ ] **Step 4: Sanity-check the schema**

```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -c "\d workbench_example_prompts" | grep -E "(requires_decomposition|decomposition_reasoning)"
```

Expected: both columns appear, nullable, boolean and text respectively.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/prisma/migrations/20260518000000_spec_decomposition_fields packages/backend/prisma/schema.prisma
git commit -m "db: add requires_decomposition + decomposition_reasoning to workbench_example_prompts"
```

---

## Task 4: Extend spec generation — types, prompt, parser, complexity override

**Files:**
- Modify: `packages/backend/src/services/spec-generation.service.ts` (multiple sites)
- Modify: `packages/backend/src/__tests__/spec-generation.test.ts`

This is the core of the change. Subtasks broken out below.

### Task 4a: Extend `SpecResult` and `ParsedSpec`

- [ ] **Step 1: Write failing tests**

Append to `packages/backend/src/__tests__/spec-generation.test.ts`:

```ts
import { parseSpecResponse } from "../services/spec-generation.service.js";

describe("parseSpecResponse — decomposition fields", () => {
  it("parses requiresDecomposition + decompositionReasoning", () => {
    const json = JSON.stringify({
      interpretation: "A snap-fit enclosure with a base and a lid.",
      verificationChecklist: ["Is there a base?", "Is there a lid?"],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
      semanticContext: "Enclosure",
      constructionSpec: "- base 50×30×20mm\n- lid 50×30×3mm",
      verificationCriteria: [{ text: "Two distinct parts", visibility: "visual" }],
      requiresDecomposition: true,
      decompositionReasoning: "Two distinct parts (base + lid) with mating geometry; benefit from independent design before assembly.",
    });
    const result = parseSpecResponse(json);
    expect(result.requiresDecomposition).toBe(true);
    expect(result.decompositionReasoning).toContain("Two distinct parts");
  });

  it("defaults requiresDecomposition to false when missing", () => {
    const json = JSON.stringify({
      interpretation: "A 10mm cube.",
      verificationChecklist: ["Is it a cube?"],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
      semanticContext: "Cube",
      constructionSpec: "- 10×10×10mm box",
      verificationCriteria: [],
    });
    const result = parseSpecResponse(json);
    expect(result.requiresDecomposition).toBe(false);
    expect(result.decompositionReasoning).toBe("");
  });
});
```

- [ ] **Step 2: Run tests — verify fail**

Run: `cd packages/backend && npx vitest run src/__tests__/spec-generation.test.ts -t "decomposition fields"`
Expected: FAIL — fields don't exist on `ParsedSpec` yet.

- [ ] **Step 3: Extend the interfaces**

Edit `packages/backend/src/services/spec-generation.service.ts`. In the `SpecResult` interface (around line 52), add (just before `rawResponse?`):

```ts
  /** Spec LLM's verdict — true means route to multi-agent codegen. */
  requiresDecomposition: boolean;
  /** One-sentence rationale for the requiresDecomposition decision. */
  decompositionReasoning: string;
```

In the `ParsedSpec` interface (around line 149), add the same two fields.

In the `EMPTY_SPEC` constant (around line 160), add:

```ts
  requiresDecomposition: false,
  decompositionReasoning: "",
```

- [ ] **Step 4: Add parsing in `parseSpecResponse`**

Inside the existing `parseSpecResponse` function, after the existing field extractions and before the return, add:

```ts
  const requiresDecomposition = typeof parsed.requiresDecomposition === "boolean"
    ? parsed.requiresDecomposition
    : false;
  const decompositionReasoning = typeof parsed.decompositionReasoning === "string"
    ? parsed.decompositionReasoning.trim()
    : "";
```

Then include both in the returned object.

- [ ] **Step 5: Run tests — verify pass**

Run: `cd packages/backend && npx vitest run src/__tests__/spec-generation.test.ts -t "decomposition fields"`
Expected: PASS — both tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/spec-generation.service.ts packages/backend/src/__tests__/spec-generation.test.ts
git commit -m "spec-gen: add requiresDecomposition + decompositionReasoning fields to spec output"
```

### Task 4b: Update the spec system prompt

- [ ] **Step 1: Find the system prompt**

Run: `grep -n "SPEC_SYSTEM_PROMPT" packages/backend/src/services/spec-generation.service.ts | head -5`
Expected: shows the declaration around line 74.

- [ ] **Step 2: Add rule #9 to the system prompt**

Edit `packages/backend/src/services/spec-generation.service.ts`. In the `SPEC_SYSTEM_PROMPT` template literal, after the rule #8 (verificationCriteria) block and before "Be LENIENT about disambiguation":

```
9. **requiresDecomposition**: A boolean. Return true ONLY when the model genuinely benefits from splitting into 2–6 independently-designable components that are then assembled. Use these criteria:
   - Multi-part objects with distinct mating geometry (a base + a lid, a body + an arm, etc.)
   - Functional assemblies where components have clear interfaces (mounting points, hinges, snap features)
   - Spatial layouts where components can be designed independently and then placed (e.g. several different brackets on a chassis)
   Do NOT return true for:
   - Single-piece models, even if complex (a detailed gear, an organic sculpture, a decorative vase)
   - Repetitive features on one body (an array of holes, a pattern of ribs)
   - Adding small features to a base shape (fillets, chamfers, knurling)

   When in doubt, return false — multi-agent is more expensive; reserve it for prompts that clearly need it.

10. **decompositionReasoning**: One sentence (≤25 words) explaining the requiresDecomposition decision. Required regardless of true/false. Example: "Two distinct parts with mating dovetail geometry — independent design then assembly is appropriate." or "Single revolved profile; no decomposition needed."
```

In the JSON-only return template at the bottom of the prompt, add the two new fields:

```
{
  ... existing fields ...,
  "requiresDecomposition": true|false,
  "decompositionReasoning": "..."
}
```

- [ ] **Step 3: Verify build**

Run: `cd packages/backend && npx tsc -p tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/spec-generation.service.ts
git commit -m "spec-gen: prompt LLM to emit requiresDecomposition + reasoning"
```

### Task 4c: Override `complexity` when the LLM says decompose, retire op-count branch

- [ ] **Step 1: Write failing test**

Append to `packages/backend/src/__tests__/spec-generation.test.ts`:

```ts
import { resolveComplexityFromSpec } from "../services/spec-generation.service.js";

describe("resolveComplexityFromSpec", () => {
  it("returns complex+spec_llm_decision when requiresDecomposition is true", () => {
    const result = resolveComplexityFromSpec({
      promptText: "a 10mm cube",
      interpretation: "a tiny cube",
      requiresDecomposition: true,
    });
    expect(result.complexity).toBe("complex");
    expect(result.reason).toBe("spec_llm_decision");
  });

  it("returns complex+multi_part_pattern when regex matches even if LLM says no", () => {
    const result = resolveComplexityFromSpec({
      promptText: "a box with a snap-fit lid",
      interpretation: "a small enclosure",
      requiresDecomposition: false,
    });
    expect(result.complexity).toBe("complex");
    expect(result.reason).toBe("multi_part_pattern");
  });

  it("returns simple+single_agent_default for ordinary single-piece prompts", () => {
    const result = resolveComplexityFromSpec({
      promptText: "a 10mm cube with a 3mm hole through the centre",
      interpretation: "a small cube with a through-hole",
      requiresDecomposition: false,
    });
    expect(result.complexity).toBe("simple");
    expect(result.reason).toBe("single_agent_default");
  });
});
```

- [ ] **Step 2: Run test — verify fail**

Run: `cd packages/backend && npx vitest run src/__tests__/spec-generation.test.ts -t "resolveComplexityFromSpec"`
Expected: FAIL — `resolveComplexityFromSpec is not a function`.

- [ ] **Step 3: Add the new resolver and retire op-count**

Edit `packages/backend/src/services/spec-generation.service.ts`. Replace the existing complexity block (currently lines 293–311, the `MULTI_PART_PATTERN` constant + `deriveComplexity` function) with:

```ts
// ── Complexity derivation ────────────────────────────────────────────

import type { ComplexityTriggerReason } from "@chat3d/shared";

/** Patterns that indicate the model has multiple distinct parts requiring assembly.
 *  Cheap regex safety net — fires before any LLM cost. */
const MULTI_PART_PATTERN = /\b(two[- ]parts?|multi[- ]parts?|separate\s+parts?|top\s+and\s+bottom|base\s+and\s+(cover|lid|top)|lid\s+and\s+base|snap[- ]fit|hinge[ds]?\s+(lid|cover)|mating\s+parts?|interlocking|dovetail\s+joint|assembly|two[- ]piece|two[- ]halves?|upper\s+and\s+lower|clamshell)\b/i;

interface ResolveComplexityArgs {
  promptText: string;
  interpretation?: string;
  /** If undefined, only the regex path can fire complex. */
  requiresDecomposition?: boolean;
}

export interface ComplexityResolution {
  complexity: SpecComplexity;
  reason: ComplexityTriggerReason;
}

/**
 * Authoritative routing decision. Order of precedence:
 *   1. requiresDecomposition === true        → complex / spec_llm_decision
 *   2. MULTI_PART_PATTERN matches text       → complex / multi_part_pattern
 *   3. otherwise                              → simple / single_agent_default
 *
 * Notes:
 *  - "medium" is no longer used as a routing signal. The complexity field
 *    keeps its three-value type for backward compatibility with downstream
 *    consumers (system-prompt tiering, etc.) but only "simple" and "complex"
 *    matter for multi-agent routing.
 *  - Operation-count thresholds are retired — the production data showed
 *    avg detected ops 2.2–3.4 across all categories, well below the old
 *    6+ threshold (see docs/codegen-harness-audit.md §6.4.5 N1).
 */
export function resolveComplexityFromSpec(args: ResolveComplexityArgs): ComplexityResolution {
  if (args.requiresDecomposition === true) {
    return { complexity: "complex", reason: "spec_llm_decision" };
  }
  const combined = args.interpretation ? `${args.promptText} ${args.interpretation}` : args.promptText;
  if (MULTI_PART_PATTERN.test(combined)) {
    return { complexity: "complex", reason: "multi_part_pattern" };
  }
  return { complexity: "simple", reason: "single_agent_default" };
}

/**
 * Legacy synchronous form. Existing callers that just want a SpecComplexity
 * still work; they get the regex-only fallback (no LLM signal available).
 * New code should prefer `resolveComplexityFromSpec` which returns the reason.
 */
export function deriveComplexity(promptText: string, interpretation?: string): SpecComplexity {
  return resolveComplexityFromSpec({ promptText, interpretation, requiresDecomposition: false }).complexity;
}
```

- [ ] **Step 4: Update `generateSpec` to feed the LLM verdict through the resolver**

In `packages/backend/src/services/spec-generation.service.ts`, find the existing `generateSpec()` function. Where it currently does:

```ts
const complexity = deriveComplexity(promptText, parsed.interpretation);
```

Replace with:

```ts
const { complexity } = resolveComplexityFromSpec({
  promptText,
  interpretation: parsed.interpretation,
  requiresDecomposition: parsed.requiresDecomposition,
});
```

(There are likely 2 call sites; update both. The fallback path that runs when LLM parsing fails should keep using `deriveComplexity()`.)

- [ ] **Step 5: Run all spec-gen tests**

Run: `cd packages/backend && npx vitest run src/__tests__/spec-generation.test.ts`
Expected: all green — new tests pass, existing tests still pass.

- [ ] **Step 6: Verify full backend build**

Run: `cd packages/backend && npx tsc -p tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/spec-generation.service.ts packages/backend/src/__tests__/spec-generation.test.ts
git commit -m "spec-gen: route to multi-agent via spec LLM decision; retire op-count branch"
```

---

## Task 5: Persist `requires_decomposition` on the prompt row + set trace reason (workbench)

**Files:**
- Modify: `packages/backend/src/services/workbench-codegen.service.ts`

- [ ] **Step 1: Find the spec-store call site**

Run: `grep -n "requiresDecomposition\|spec_raw_response\|prisma.workbenchExamplePrompt" packages/backend/src/services/workbench-codegen.service.ts | head -20`
Expected: shows the Prisma update that writes back spec fields after generation.

- [ ] **Step 2: Add the two new fields to that update**

Edit the Prisma `update` that stores spec results. After existing fields like `specRawResponse: ...,` add:

```ts
        requiresDecomposition: specResult.requiresDecomposition,
        decompositionReasoning: specResult.decompositionReasoning,
```

- [ ] **Step 3: Set the trace trigger reason after spec resolution**

Edit `packages/backend/src/services/workbench-codegen.service.ts` near line 412 (the `wbUseMultiAgent` assignment). Replace:

```ts
const wbUseMultiAgent = specResult?.complexity === "complex";
```

with:

```ts
const wbUseMultiAgent = specResult?.complexity === "complex";

// Persist routing reason on trace. The complexity field already encodes the
// decision; we derive the reason from the same inputs the resolver used.
if (specResult) {
  const { reason } = resolveComplexityFromSpec({
    promptText: ctx.prompt,
    interpretation: specResult.interpretation,
    requiresDecomposition: specResult.requiresDecomposition,
  });
  traceBuilder.setComplexityTriggerReason(reason);
} else {
  traceBuilder.setComplexityTriggerReason("spec_unavailable");
}
logger.info(
  { useMultiAgent: wbUseMultiAgent, complexity: specResult?.complexity, requiresDecomposition: specResult?.requiresDecomposition },
  "multi-agent routing decision",
);
```

Add to the import line at the top:

```ts
import { generateSpec, deriveComplexity, resolveComplexityFromSpec, type SpecResult } from "./spec-generation.service.js";
```

- [ ] **Step 4: Verify build**

Run: `cd packages/backend && npx tsc -p tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 5: Run all backend tests**

Run: `cd packages/backend && npx vitest run`
Expected: all green; no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/workbench-codegen.service.ts
git commit -m "workbench: persist requiresDecomposition + set complexityTriggerReason on trace"
```

---

## Task 6: Set trace reason on chat path

**Files:**
- Modify: `packages/backend/src/services/query.service.ts`

- [ ] **Step 1: Find the chat routing site**

Run: `grep -n "useMultiAgent\|epSpecComplexity" packages/backend/src/services/query.service.ts | head -10`
Expected: shows line 1438 area.

- [ ] **Step 2: Add the trace reason set**

Edit `packages/backend/src/services/query.service.ts`. Near line 1438 (just after `const useMultiAgent = epSpecComplexity === "complex" && !agIsModification;`), add:

```ts
      // Persist routing reason for observability (mirror of workbench-codegen logic).
      if (specResult) {
        const { reason } = resolveComplexityFromSpec({
          promptText: userPrompt,
          interpretation: specResult.interpretation,
          requiresDecomposition: specResult.requiresDecomposition,
        });
        traceBuilder.setComplexityTriggerReason(reason);
      } else {
        traceBuilder.setComplexityTriggerReason("spec_unavailable");
      }
```

(Replace `userPrompt` with whatever variable holds the prompt text in this scope — grep for `epSpecComplexity` to see the surrounding variable names.)

Add to the import line at the top:

```ts
import { ..., resolveComplexityFromSpec } from "./spec-generation.service.js";
```

- [ ] **Step 3: Verify build**

Run: `cd packages/backend && npx tsc -p tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 4: Run all backend tests**

Run: `cd packages/backend && npx vitest run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/query.service.ts
git commit -m "chat: set complexityTriggerReason on trace via spec LLM decision"
```

---

## Task 7: Integration test — stubbed spec LLM flips routing

**Files:**
- Create: `packages/backend/src/__tests__/multi-agent-trigger.integration.test.ts`

We test the *resolver wiring* (not the live LLM call) — given a synthesized `SpecResult`, confirm the complexity field and trace reason behave correctly.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/multi-agent-trigger.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveComplexityFromSpec } from "../services/spec-generation.service.js";

describe("multi-agent trigger — end-to-end resolver", () => {
  it("LLM saying decompose + benign prompt routes complex", () => {
    const r = resolveComplexityFromSpec({
      promptText: "a 10mm cube",
      interpretation: "a tiny cube",
      requiresDecomposition: true,
    });
    expect(r).toEqual({ complexity: "complex", reason: "spec_llm_decision" });
  });

  it("LLM saying no + multi-part regex match still routes complex (safety net)", () => {
    const r = resolveComplexityFromSpec({
      promptText: "a box with a snap-fit lid",
      interpretation: "small enclosure",
      requiresDecomposition: false,
    });
    expect(r).toEqual({ complexity: "complex", reason: "multi_part_pattern" });
  });

  it("LLM saying no + no regex match routes simple (default)", () => {
    const r = resolveComplexityFromSpec({
      promptText: "a fillet on a 50mm cube",
      interpretation: "cube with rounded edges",
      requiresDecomposition: false,
    });
    expect(r).toEqual({ complexity: "simple", reason: "single_agent_default" });
  });

  it("LLM unavailable (requiresDecomposition undefined) + regex match still routes complex", () => {
    const r = resolveComplexityFromSpec({
      promptText: "a clamshell case",
      requiresDecomposition: undefined,
    });
    expect(r.complexity).toBe("complex");
    expect(r.reason).toBe("multi_part_pattern");
  });
});
```

- [ ] **Step 2: Run and confirm pass**

Run: `cd packages/backend && npx vitest run src/__tests__/multi-agent-trigger.integration.test.ts`
Expected: all 4 tests PASS (resolver is already implemented in Task 4c).

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/__tests__/multi-agent-trigger.integration.test.ts
git commit -m "test: integration test for spec-LLM multi-agent trigger"
```

---

## Task 8: Validation harness — d8ac9bae fake-model comparison

**Files:**
- Create: `scripts/validate-multi-agent-trigger.sh`

This is a runtime validation against experiment `d8ac9bae-3f42-4fb0-9af1-aaaa8d7cb536`. Existing model columns stay untouched. New "fake" model variants pointing to the same OSS endpoints get added as new runs, generate side-by-side, and we compare per-prompt.

**Manual prereq (Daniel does this — NOT part of automated steps):**
1. In Admin → Providers UI, register new model entries for the OSS models being validated, e.g.:
   - `qwen3.6-27b-fp8-base:ma` → same endpoint as `qwen3.6-27b-fp8-base`
   - `chat3d-build123d-02-synthetic-16k:ma` → same endpoint as `chat3d-build123d-02-synthetic-16k`
2. Set their display names to make the comparison legible (e.g. "Qwen3.6 27B FP8 (multi-agent)").
3. Tell the engineer the new model IDs and which experiment to update.

- [ ] **Step 1: Rebuild and deploy backend with the new code**

```bash
docker compose build backend && docker compose up -d backend
```

Expected: backend container healthy in `docker compose ps`.

- [ ] **Step 2: Create the validation script**

Create `scripts/validate-multi-agent-trigger.sh`:

```bash
#!/usr/bin/env bash
# Validate the new spec-LLM multi-agent trigger against experiment d8ac9bae.
# Assumes the new "fake" model(s) have been registered (manually) and added as
# runs on the experiment.
#
# Usage: scripts/validate-multi-agent-trigger.sh <experiment_id>
set -euo pipefail

EXPERIMENT_ID="${1:-d8ac9bae-3f42-4fb0-9af1-aaaa8d7cb536}"

echo "=== Validation report for experiment ${EXPERIMENT_ID} ==="
echo

echo "1. Routing distribution on new runs (by model + trigger reason):"
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
SELECT er.display_name AS model,
       gt.trace->'nodes'->0->>'complexityTriggerReason' AS trigger_reason,
       count(*) AS n,
       round(avg(e.eval_score)::numeric, 2) AS avg_score,
       round(avg(gt.total_cost_usd)::numeric, 4) AS avg_cost_usd
FROM experiments x
JOIN experiment_runs er ON er.experiment_id = x.id
JOIN workbench_examples e ON e.experiment_run_id = er.id
JOIN generation_traces gt ON gt.workbench_example_id = e.id
WHERE x.id = '${EXPERIMENT_ID}'
GROUP BY er.display_name, trigger_reason
ORDER BY er.display_name, trigger_reason;
"

echo
echo "2. Per-prompt score deltas — original vs :ma columns:"
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
WITH per_prompt AS (
  SELECT p.id AS prompt_id, p.prompt,
         er.display_name AS model_label,
         e.eval_score, gt.total_cost_usd,
         gt.trace->'nodes'->0->>'complexityTriggerReason' AS reason
  FROM experiments x
  JOIN experiment_runs er ON er.experiment_id = x.id
  JOIN workbench_examples e ON e.experiment_run_id = er.id
  JOIN workbench_example_prompts p ON p.id = e.prompt_id
  JOIN generation_traces gt ON gt.workbench_example_id = e.id
  WHERE x.id = '${EXPERIMENT_ID}'
)
SELECT
  left(prompt, 60) AS prompt,
  max(CASE WHEN model_label NOT LIKE '%(multi-agent)%' AND model_label NOT LIKE '%:ma%' THEN eval_score END) AS score_orig,
  max(CASE WHEN model_label LIKE '%(multi-agent)%' OR model_label LIKE '%:ma%' THEN eval_score END) AS score_ma,
  max(CASE WHEN model_label LIKE '%(multi-agent)%' OR model_label LIKE '%:ma%' THEN reason END) AS ma_reason
FROM per_prompt
GROUP BY prompt_id, prompt
HAVING max(CASE WHEN model_label LIKE '%(multi-agent)%' OR model_label LIKE '%:ma%' THEN eval_score END) IS NOT NULL
ORDER BY (max(CASE WHEN model_label LIKE '%(multi-agent)%' OR model_label LIKE '%:ma%' THEN eval_score END) - max(CASE WHEN model_label NOT LIKE '%(multi-agent)%' AND model_label NOT LIKE '%:ma%' THEN eval_score END)) DESC NULLS LAST
LIMIT 30;
"

echo
echo "3. Headline summary — only prompts routed to multi-agent:"
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
WITH ma_prompts AS (
  SELECT DISTINCT e.prompt_id
  FROM experiments x
  JOIN experiment_runs er ON er.experiment_id = x.id
  JOIN workbench_examples e ON e.experiment_run_id = er.id
  JOIN generation_traces gt ON gt.workbench_example_id = e.id
  WHERE x.id = '${EXPERIMENT_ID}'
    AND gt.trace->'nodes'->0->>'complexityTriggerReason' IN ('spec_llm_decision','multi_part_pattern')
)
SELECT er.display_name AS model,
       count(*) AS n_prompts,
       round(avg(e.eval_score)::numeric, 2) AS avg_score,
       round(avg(gt.total_cost_usd)::numeric, 4) AS avg_cost_usd
FROM ma_prompts m
JOIN workbench_examples e ON e.prompt_id = m.prompt_id
JOIN experiment_runs er ON er.id = e.experiment_run_id
JOIN generation_traces gt ON gt.workbench_example_id = e.id
WHERE er.experiment_id = '${EXPERIMENT_ID}'
GROUP BY er.display_name
ORDER BY er.display_name;
"
```

```bash
chmod +x scripts/validate-multi-agent-trigger.sh
```

- [ ] **Step 3: Trigger generation for the new runs** (after Daniel adds the fake models)

The experiment edit endpoint and "Retry failed runs" / "Generate" buttons in the admin UI handle this. Engineer waits for jobs to complete (~30–60 min depending on prompt count and OSS endpoint throughput).

- [ ] **Step 4: Run the validation report**

```bash
scripts/validate-multi-agent-trigger.sh d8ac9bae-3f42-4fb0-9af1-aaaa8d7cb536 | tee /tmp/multiagent-validation-$(date +%Y%m%d-%H%M%S).log
```

Expected: three tables — routing distribution, per-prompt deltas, headline summary scoped to multi-agent prompts.

**Acceptance criteria:**
1. **Usage:** at least one `spec_llm_decision` row appears in the trigger-reason distribution. If zero, the spec LLM is being too conservative — file a follow-up to tune rule #9 in the system prompt.
2. **Effectiveness:** on the multi-agent-routed prompts, **average score for at least one `:ma` model is ≥ its original column score**. Strong signal if the gap to the Claude baseline narrows. Negative signal (lower scores) means multi-agent overhead is hurting; investigate per-prompt before declaring failure.
3. **Cost guardrail:** average per-prompt cost on the `:ma` columns is ≤ 2.5× the original column. Above 2.5× means the multi-agent path is too expensive even when it helps; revisit.

- [ ] **Step 5: Commit the script**

```bash
git add scripts/validate-multi-agent-trigger.sh
git commit -m "scripts: validation report for multi-agent trigger experiment replay"
```

---

## Task 9: Documentation

**Files:**
- Modify: `docs/codegen-pipeline-and-workbench.md` (§3.4)
- Modify: `docs/codegen-harness-audit.md` (§6.4.5 N1 + §9 changelog)

- [ ] **Step 1: Update the architecture doc**

Edit `docs/codegen-pipeline-and-workbench.md` §3.4. Replace the opening sentence ("For `complex` prompts (6+ detected operations):") with:

> A run is routed to multi-agent decomposition when the spec LLM emits `requiresDecomposition: true`, OR when the prompt matches the multi-part safety-net regex (`snap-fit`, `hinged lid`, `clamshell`, ...). The routing reason is persisted on the trace root node as `complexityTriggerReason` ∈ `{spec_llm_decision, multi_part_pattern, single_agent_default, spec_unavailable}`. The legacy operation-count threshold is retired (production data showed it almost never fired — see `docs/codegen-harness-audit.md` §6.4.5 N1).

- [ ] **Step 2: Update the audit doc**

Edit `docs/codegen-harness-audit.md`:

In §6.4.5 row N1, append after the existing `Implication` text:

> **Status (2026-05-18):** shipped. Spec LLM now emits `requiresDecomposition` + `decompositionReasoning` on every spec call; routing flips through the resolver in `spec-generation.service.ts`. Operation-count threshold retired. Validation via `scripts/validate-multi-agent-trigger.sh` against experiment d8ac9bae using new `:ma` fake-model columns (Claude column unchanged).

In §9 changelog, prepend:

> - **2026-05-18 v1.2** — N1 (multi-agent trigger) shipped via spec-LLM decision (chat + workbench, no category dependency). Trigger reason persisted on trace root. Validation runs side-by-side with original columns on experiment d8ac9bae using `:ma` fake-model variants registered manually. Plan: `docs/superpowers/plans/2026-05-18-fix-multi-agent-trigger.md`.

- [ ] **Step 3: Commit docs**

```bash
git add docs/codegen-pipeline-and-workbench.md docs/codegen-harness-audit.md
git commit -m "docs: document spec-LLM multi-agent routing trigger"
```

---

## Self-Review

**Spec coverage check:**
- ✅ "Spec LLM emits routing decision" → Tasks 4a, 4b
- ✅ "Persist decision + reasoning in trace" → Tasks 1, 2, 5, 6
- ✅ "Persist decision + reasoning on prompt row for retrospective analysis" → Tasks 3, 5
- ✅ "Same logic for chat and workbench, no category dependency" → Tasks 5, 6 (both call the same `resolveComplexityFromSpec`)
- ✅ "Multi-part regex stays as safety net" → Task 4c
- ✅ "Operation-count trigger retired" → Task 4c (block removed; `deriveComplexity` legacy fallback no longer uses op count)
- ✅ "Validation via d8ac9bae fake-model columns" → Task 8

**Placeholder scan:** none — every step has either complete code or a precise command with expected output. Imports are spelled out; SQL is concrete.

**Type consistency check:**
- `ComplexityTriggerReason` (Task 1) is consumed by trace setter (Task 2), `ComplexityResolution` (Task 4c), and trace assertions in validation queries (Task 8). All four sites use identical literal values: `spec_llm_decision`, `multi_part_pattern`, `single_agent_default`, `spec_unavailable`.
- `ComplexityResolution` is exported and consumed in Tasks 5 and 6.
- `SpecResult.requiresDecomposition` (Task 4a) is consumed by Tasks 5 and 6 and persisted by Task 5 (Prisma update mirrored on schema in Task 3).
- `ParsedSpec.requiresDecomposition` mirrors `SpecResult` — consistent.
- DB column names `requires_decomposition` / `decomposition_reasoning` mirror Prisma field names `requiresDecomposition` / `decompositionReasoning` via `@map` (Task 3).

**Operational notes:**
- Shipping this plan **does change production behaviour** as soon as the backend is deployed: the spec LLM will start emitting the new field, and any prompt the LLM judges as needing decomposition will route to multi-agent. Unlike the v1 plan (which was gated by a default-off setting), this one is the new default. Risk: cost goes up for prompts the LLM decides to decompose. Mitigation: the spec system prompt says "when in doubt, return false"; the multi-agent pipeline timeout is already separately configured (`workbench.multi_agent_pipeline_timeout_minutes`, default 45 min); validation Task 8 cost guardrail catches over-eagerness; rollback is `git revert` of Task 4c.
- Chat-side rollback is trivially additive — the chat path already uses `specResult.complexity === "complex"` (existing line 1438 in `query.service.ts`); we're only changing what *populates* that field.
- The DB migration is additive (two nullable columns) — safe to deploy, safe to leave on rollback.

**Validation strategy summary:**
- Real-time check (Task 5 logs): every workbench generation logs the routing decision.
- Spot-check (Task 7): unit tests confirm the resolver behaviour.
- Offline check (Task 8): d8ac9bae fake-model columns provide side-by-side comparison without re-running the original baseline.

**Follow-up plans (out of scope here):**
- **Wire trace capture into the chat path.** Discovered during Task 6 execution: `query.service.ts` has no `runWithTrace` wrapper, so `getTraceBuilder()` returns `undefined` on every chat run. Production confirms: **0 of 3,280 `generation_traces` rows have `chat_item_id` set** — only workbench traces exist. Task 6's `setComplexityTriggerReason(...)` call therefore is structurally correct but a *no-op* on chat today. Until this is fixed, the routing decision still applies (chat prompts still route to multi-agent when the spec LLM says so), but the observability — *why* a given chat run was routed — is missing. A separate plan should wrap the chat-side codegen invocation in `runWithTrace(traceBuilder, async () => { ... })` and add the chat-item-id linkage on trace persist. Touches `query.service.ts` + `trace-persistence.service.ts`; small scope but cross-cutting.
- **Tune the spec LLM decomposition prompt** based on Task 8 findings (if too conservative or too eager).
- **Extend eval to chat** so chat-side routing also has score data, not just routing-distribution stats.
- **Per-category cost dashboard** to track multi-agent uptake over time once it's in production.
