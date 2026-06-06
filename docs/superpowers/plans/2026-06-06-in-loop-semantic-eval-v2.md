# In-Loop Semantic Eval v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the forced per-component checklist gate from sub-agent submit (structurally inert because sub-agents don't render) to the assembler's submit, where renders exist. Grant the assembler authority to repair sub-component code.

**Architecture:** Per-component checklists from decomposition aggregate into a flat list with `componentName` tagged per item, attached to the assembler's `deps.componentChecklist`. The forced gate moves from the `disableRender:true` branch of `submit_result` to the non-`disableRender` branch (the assembler-accessible branch). On FAIL, the gate returns a component-grouped rejection message; the assembler is told (via system prompt) it may repair sub-component code or composition logic.

**Tech Stack:**
- Backend: TypeScript, Express, Prisma + Postgres, Vercel AI SDK
- Testing: vitest (`packages/backend/src/__tests__/`)
- Container: Docker Compose (`docker compose build backend && docker compose up -d backend`)

**Spec:** [`docs/superpowers/specs/2026-06-06-in-loop-semantic-eval-design-v2.md`](../specs/2026-06-06-in-loop-semantic-eval-design-v2.md)

**Pre-state on `main`:** Tasks 1–9 from the v1 plan are landed (commits 0510ffa through 6b879b8). The v2 plan modifies that landed code: reverts the inert sub-agent wiring, repositions the gate, rewrites the assembler prompt.

---

## File Structure

**Modify:**
- `packages/backend/src/utils/component-checklist.ts` — add `componentName?: string` to `ComponentChecklistItemSchema`
- `packages/backend/src/services/agent-multi.service.ts` — aggregate per-component checklists for the assembler; remove sub-agent componentChecklist wiring; populate `subAgentVerifications` from assembler's gate via `onChecklistEvaluated`
- `packages/backend/src/services/agent-tools.service.ts` — delete Task 5's gate from the `disableRender:true` branch; insert new gate in the non-`disableRender` branch with component-grouped rejection message
- `packages/backend/src/prompts/agent-system-prompt.ts` — remove advisory `verificationParagraph` and "DO NOT try to repair" sentence; add repair-authority block
- `packages/backend/src/__tests__/component-checklist.test.ts` — add `componentName` test cases
- `packages/backend/src/__tests__/submit-result-checklist-gate.test.ts` — rewrite tests against the new gate location + component-grouped format
- `packages/backend/src/__tests__/agent-multi-deps-wiring.test.ts` — replace with assembler-deps aggregation test
- `packages/backend/src/__tests__/assembler-verification-section.test.ts` — update for new prompt block (advisory paragraph removed, repair-authority block added)

**Create:**
- `docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md` — A/B results

---

## Task 1: Add `componentName` to `ComponentChecklistItem`

**Files:**
- Modify: `packages/backend/src/utils/component-checklist.ts`
- Test: `packages/backend/src/__tests__/component-checklist.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/src/__tests__/component-checklist.test.ts`:

```typescript
describe("ComponentChecklistItem with componentName tag", () => {
  it("accepts an item with componentName", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "Body is hollow",
      visibility: "visual",
      componentName: "body",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.componentName).toBe("body");
  });

  it("accepts an item without componentName (still valid)", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "x",
      visibility: "code",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.componentName).toBeUndefined();
  });

  it("rejects a non-string componentName", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "x",
      visibility: "code",
      componentName: 42,
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec -T backend npx vitest run src/__tests__/component-checklist.test.ts
```

Expected: 3 new tests FAIL — `componentName` field is unknown to the schema.

- [ ] **Step 3: Extend the schema**

In `packages/backend/src/utils/component-checklist.ts`, change `ComponentChecklistItemSchema`:

```typescript
export const ComponentChecklistItemSchema = z.object({
  item: z.string().min(1),
  visibility: ChecklistVisibilityEnum,
  /** Source component name (assembler-aggregated checklists only). */
  componentName: z.string().optional(),
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec -T backend npx vitest run src/__tests__/component-checklist.test.ts
```

Expected: 9/9 PASS (6 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/utils/component-checklist.ts \
        packages/backend/src/__tests__/component-checklist.test.ts
git commit -m "Add componentName field to ComponentChecklistItem schema"
```

---

## Task 2: Aggregate per-component checklists for the assembler

**Files:**
- Modify: `packages/backend/src/services/agent-multi.service.ts` (aggregation around the assembler invocation)
- Test: `packages/backend/src/__tests__/agent-multi-deps-wiring.test.ts` (replace placeholder smoke with real aggregation test)

The orchestrator builds a flat list with `componentName` tagged on each item, attaches it to the assembler's `runAgentCodegen` input. This is the new producer of `deps.componentChecklist` for the assembler.

- [ ] **Step 1: Locate the assembler invocation**

Read `packages/backend/src/services/agent-multi.service.ts`. Find where the assembler agent's `runAgentCodegen` is called inside `runMultiAgentCodegen` (around Step 4 of the orchestrator, where `AgentCodegenInput` for the assembler is constructed).

- [ ] **Step 2: Add an exported aggregator helper for testability**

Add near the top of `agent-multi.service.ts` (or in `agent-multi-parser.ts` if you prefer co-location with `decomposePrompt`):

```typescript
/**
 * Flattens per-component checklists into a single list, tagging each item
 * with its source componentName. Used to feed the assembler's evaluate_checklist
 * tool + forced gate (which see the aggregated list as a single checklist).
 */
export function aggregateChecklistForAssembler(
  components: DecomposedComponent[],
): ComponentChecklistItem[] {
  return components.flatMap((c) =>
    (c.componentChecklist ?? []).map((item) => ({
      ...item,
      componentName: c.name,
    })),
  );
}
```

Add the import to wherever you place this:

```typescript
import type { ComponentChecklistItem } from "../utils/component-checklist.js";
```

(If you placed it in `agent-multi-parser.ts`, also `import type { DecomposedComponent } from "./agent-multi-parser.js";` is unnecessary — it's already local; if you placed it in `agent-multi.service.ts`, import `DecomposedComponent` from `./agent-multi-parser.js`.)

- [ ] **Step 3: Replace the placeholder smoke test with a real aggregation test**

Replace contents of `packages/backend/src/__tests__/agent-multi-deps-wiring.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { aggregateChecklistForAssembler } from "../services/agent-multi.service.js";
// If you placed the helper in agent-multi-parser.ts instead, adjust the import.

describe("aggregateChecklistForAssembler", () => {
  it("flattens per-component checklists and tags items with componentName", () => {
    const result = aggregateChecklistForAssembler([
      {
        name: "body",
        description: "the box",
        componentChecklist: [
          { item: "Body is hollow", visibility: "visual" },
          { item: "Wall thickness is 2mm", visibility: "code" },
        ],
      },
      {
        name: "pin",
        description: "the pin",
        componentChecklist: [{ item: "Pin diameter is 3mm", visibility: "code" }],
      },
    ]);

    expect(result).toEqual([
      { item: "Body is hollow", visibility: "visual", componentName: "body" },
      { item: "Wall thickness is 2mm", visibility: "code", componentName: "body" },
      { item: "Pin diameter is 3mm", visibility: "code", componentName: "pin" },
    ]);
  });

  it("returns empty array when no components have checklists", () => {
    const result = aggregateChecklistForAssembler([
      { name: "body", description: "x" },
      { name: "pin", description: "y" },
    ]);
    expect(result).toEqual([]);
  });

  it("skips components with undefined componentChecklist", () => {
    const result = aggregateChecklistForAssembler([
      { name: "body", description: "x" },
      {
        name: "pin",
        description: "y",
        componentChecklist: [{ item: "x", visibility: "code" }],
      },
    ]);
    expect(result).toEqual([
      { item: "x", visibility: "code", componentName: "pin" },
    ]);
  });
});
```

- [ ] **Step 4: Run tests to confirm fail before, then pass after implementation**

```bash
docker compose exec -T backend npx vitest run src/__tests__/agent-multi-deps-wiring.test.ts
```

Expected: 3/3 PASS (the helper was added in Step 2 already).

- [ ] **Step 5: Wire the aggregator into the assembler invocation**

In `runMultiAgentCodegen`, find the spot where the assembler's `AgentCodegenInput` is constructed (Step 4 of the orchestrator). Before that input is built, compute:

```typescript
const assemblerChecklist = aggregateChecklistForAssembler(decomposition.components);
```

Attach to the assembler's `AgentCodegenInput`:

```typescript
// in the assembler's input object
componentChecklist: assemblerChecklist,
componentName: "assembler",
onChecklistEvaluated: (verification) => {
  // Group flat results by componentName, populate subAgentVerifications.
  for (const r of verification.results) {
    const key = r.item /* placeholder */; // see Step 6 — derive componentName
  }
},
```

The full callback is finalized in Step 6 once we know how to map results → component groups.

- [ ] **Step 6: Replace the sub-agent-keyed accumulator population with assembler-callback-driven grouping**

Recall `subAgentVerifications` is `Record<string, SubAgentVerificationSnapshot>`. We need to rebuild it from a flat `ComponentVerificationResult` whose item results may have lost the `componentName` (the dispatcher's per-item result type doesn't carry it).

**Two options:** (a) extend `ChecklistItemResult` to carry `componentName`; (b) zip the flat input checklist (which DOES have `componentName`) back against the result by index.

Use option (b) — no type change:

```typescript
const assemblerChecklist = aggregateChecklistForAssembler(decomposition.components);

const assemblerOnChecklistEvaluated = (verification: ComponentVerificationResult) => {
  // Reset the accumulator on each call — the assembler's gate is the canonical source now.
  for (const key of Object.keys(subAgentVerifications)) {
    delete subAgentVerifications[key];
  }
  // Group by componentName via index zip.
  const grouped: Record<string, ChecklistItemResult[]> = {};
  for (const r of verification.results) {
    // r.index is the dispatcher's index in the flat checklist (the same order
    // as assemblerChecklist[r.index]). originalIndices isn't passed here, so the
    // mapping is direct.
    const sourceItem = assemblerChecklist[r.index];
    const componentName = sourceItem?.componentName ?? "unknown";
    (grouped[componentName] ??= []).push(r);
  }
  for (const [componentName, results] of Object.entries(grouped)) {
    subAgentVerifications[componentName] = {
      passedCount: results.filter((x) => x.verdict === "PASS").length,
      failedCount: results.filter((x) => x.verdict === "FAIL").length,
      uncertainCount: results.filter((x) => x.verdict === "UNCERTAIN").length,
      failedItems: results
        .filter((x) => x.verdict === "FAIL")
        .map((x) => ({ item: x.item, reasoning: x.reasoning })),
    };
  }
};
```

Add the imports:

```typescript
import type { ChecklistItemResult, ComponentVerificationResult } from "../utils/component-checklist.js";
```

Wire `assemblerOnChecklistEvaluated` into the assembler's `AgentCodegenInput.onChecklistEvaluated` field, replacing the placeholder from Step 5.

- [ ] **Step 7: Verify TypeScript compiles**

```bash
docker compose exec -T backend npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | wc -l
```

Expected: 63 (no new errors beyond the pre-existing baseline).

- [ ] **Step 8: Rebuild backend container**

```bash
docker compose build backend && docker compose up -d backend
```

- [ ] **Step 9: Commit**

```bash
git add packages/backend/src/services/agent-multi.service.ts \
        packages/backend/src/services/agent-multi-parser.ts \
        packages/backend/src/__tests__/agent-multi-deps-wiring.test.ts
git commit -m "Aggregate per-component checklists for the assembler"
```

(Drop `agent-multi-parser.ts` from the file list if you placed the helper inside `agent-multi.service.ts`.)

---

## Task 3: Remove sub-agent componentChecklist wiring

**Files:**
- Modify: `packages/backend/src/services/agent-multi.service.ts` (sub-agent loop)

The v1 wiring sets `componentChecklist`, `componentName`, and `onChecklistEvaluated` on each sub-agent's `runAgentCodegen` input (Task 7's work, lines around 287–298 of the file). Sub-agents can't render → these never fire → unused. Remove.

- [ ] **Step 1: Locate the sub-agent invocation in `runSubAgent`**

Read `agent-multi.service.ts`. Find `runSubAgent` (around line 252) and the `runAgentCodegen(...)` call inside it. Look for the three fields:

```typescript
componentChecklist: component.componentChecklist ?? [],
componentName: component.name,
onChecklistEvaluated: (verification) => { /* writes to subAgentVerifications */ },
```

- [ ] **Step 2: Delete those three lines**

Remove ONLY those three lines from the sub-agent's `runAgentCodegen` input construction. Leave everything else in `runSubAgent` untouched.

- [ ] **Step 3: Verify the `subAgentVerifications` accumulator is still declared at function scope of `runMultiAgentCodegen`**

The accumulator stays in `runMultiAgentCodegen`. Task 2 already changed its populator to the assembler's `onChecklistEvaluated` callback. This task just stops sub-agents from also writing to it.

Update the accumulator's preceding comment block (from Task 7) to reflect the v2 source-of-truth:

```typescript
// Per-component verification snapshots captured via the ASSEMBLER's onChecklistEvaluated.
// - Read by buildAssemblyAgentSystemPrompt (debug log) and Task 9's workbench_examples persistence.
// - Populated when the assembler's forced gate runs at submit. Reset on each gate call so
//   the most recent attempt is the persisted state.
// - Absence of a key means the assembler never ran a gate for that component
//   (e.g., decomposition emitted no checklist for it).
const subAgentVerifications: Record<string, SubAgentVerificationSnapshot> = {};
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
docker compose exec -T backend npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | wc -l
```

Expected: 63.

- [ ] **Step 5: Re-run prior tests to confirm no regressions**

```bash
docker compose exec -T backend npx vitest run \
  src/__tests__/agent-multi-deps-wiring.test.ts \
  src/__tests__/decompose-prompt-checklist.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/agent-multi.service.ts
git commit -m "Remove sub-agent componentChecklist wiring (inert per v1 smoke)"
```

---

## Task 4: Move the forced gate to the non-`disableRender` branch + component-grouped output

**Files:**
- Modify: `packages/backend/src/services/agent-tools.service.ts`
- Test: `packages/backend/src/__tests__/submit-result-checklist-gate.test.ts` (rewrite)

The v1 gate (Task 5) lives in the `disableRender:true` branch. Delete that. Add the same gate, repositioned, in the non-`disableRender` branch with a new component-grouped rejection message.

- [ ] **Step 1: Locate the v1 gate**

```bash
grep -n "componentChecklist\|SUBMISSION REJECTED" packages/backend/src/services/agent-tools.service.ts | head -20
```

Identify:
- The block in the `disableRender:true` branch that begins with the comment "Forced component-checklist verification (multi-agent sub-agents only)"
- The non-`disableRender` branch where the existing full eval pipeline runs (around line 480+ where `runFullEvaluation` is called)

- [ ] **Step 2: Delete the v1 gate from the `disableRender:true` branch**

Remove the entire gate block (the try/catch wrapping `runChecklistEval` etc.) from the `disableRender:true` branch. Leave the surrounding logic (empty-code check, `onSubmit()` call) intact.

- [ ] **Step 3: Rewrite the gate test for the new location**

Replace contents of `packages/backend/src/__tests__/submit-result-checklist-gate.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRunChecklistEval = vi.hoisted(() => vi.fn());

vi.mock("../services/checklist-eval.service.js", async (orig) => {
  const mod = (await orig()) as any;
  return {
    ...mod,
    runChecklistEval: mockRunChecklistEval,
    verifyChecklistItemVisual: vi.fn(),
    verifyChecklistItemCode: vi.fn(),
  };
});

const mkDeps = (overrides: any = {}) => ({
  fs: { getMainCode: () => "x = 1", getAllFiles: () => [], writeFile: () => {}, listFiles: () => [] },
  wrapProjectFiles: () => [],
  baseFileName: "x",
  onRenderSuccess: () => {},
  onSubmit: vi.fn(),
  getLastRenderedFiles: () => [{ filename: "iso.png", contentBase64: "f" }],
  userPrompt: "p",
  evalThreshold: 5,
  componentChecklist: [
    { item: "Body is hollow", visibility: "visual" as const, componentName: "body" },
  ],
  evalPlan: null,
  ...overrides,
});

describe("submit_result forced checklist gate — assembler path (non-disableRender)", () => {
  beforeEach(() => {
    mockRunChecklistEval.mockReset();
  });

  it("rejects submission when any item FAILs and uses component-grouped output", async () => {
    mockRunChecklistEval.mockResolvedValue({
      results: [
        {
          index: 0,
          item: "Body is hollow",
          visibility: "visual",
          verdict: "FAIL",
          reasoning: "top view shows solid block",
        },
      ],
      passedCount: 0,
      failedCount: 1,
      uncertainCount: 0,
    });
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const onSubmit = vi.fn();
    // Note: { disableRender: undefined } — the assembler path, NOT sub-agent
    const tools = buildAgentTools(mkDeps({ onSubmit }) as any, {});
    const result = String(await tools.submit_result.execute({} as any, {} as any));

    expect(result).toMatch(/SUBMISSION REJECTED/);
    expect(result).toMatch(/Component "body"/);
    expect(result).toMatch(/Body is hollow/);
    expect(result).toMatch(/top view shows solid block/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("groups multiple failed components separately", async () => {
    mockRunChecklistEval.mockResolvedValue({
      results: [
        { index: 0, item: "a", visibility: "visual", verdict: "FAIL", reasoning: "bad a" },
        { index: 1, item: "b", visibility: "code", verdict: "FAIL", reasoning: "bad b" },
      ],
      passedCount: 0,
      failedCount: 2,
      uncertainCount: 0,
    });
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools(
      mkDeps({
        componentChecklist: [
          { item: "a", visibility: "visual" as const, componentName: "body" },
          { item: "b", visibility: "code" as const, componentName: "pin" },
        ],
      }) as any,
      {},
    );
    const result = String(await tools.submit_result.execute({} as any, {} as any));
    expect(result).toMatch(/Component "body"/);
    expect(result).toMatch(/Component "pin"/);
    expect(result).toMatch(/2 of 2/);
  });

  it("does NOT reject when only UNCERTAIN items present", async () => {
    mockRunChecklistEval.mockResolvedValue({
      results: [
        {
          index: 0,
          item: "x",
          visibility: "visual",
          verdict: "UNCERTAIN",
          reasoning: "occluded",
        },
      ],
      passedCount: 0,
      failedCount: 0,
      uncertainCount: 1,
    });
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools(mkDeps() as any, {});
    const result = String(await tools.submit_result.execute({} as any, {} as any));
    expect(result).not.toMatch(/SUBMISSION REJECTED/);
  });

  it("does NOT fire the gate when componentChecklist is empty (single-agent)", async () => {
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools(
      mkDeps({ componentChecklist: undefined }) as any,
      {},
    );
    await tools.submit_result.execute({} as any, {} as any);
    expect(mockRunChecklistEval).not.toHaveBeenCalled();
  });

  it("does NOT fire the gate on the sub-agent path (disableRender:true)", async () => {
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools(mkDeps() as any, { disableRender: true });
    await tools.submit_result.execute({} as any, {} as any);
    expect(mockRunChecklistEval).not.toHaveBeenCalled();
  });

  it("fires onChecklistEvaluated even when verdict is FAIL", async () => {
    mockRunChecklistEval.mockResolvedValue({
      results: [{ index: 0, item: "x", visibility: "visual", verdict: "FAIL", reasoning: "bad" }],
      passedCount: 0,
      failedCount: 1,
      uncertainCount: 0,
    });
    const onChecklistEvaluated = vi.fn();
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools(mkDeps({ onChecklistEvaluated }) as any, {});
    await tools.submit_result.execute({} as any, {} as any);
    expect(onChecklistEvaluated).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
docker compose exec -T backend npx vitest run src/__tests__/submit-result-checklist-gate.test.ts
```

Expected: tests FAIL — the gate is currently in the wrong branch.

- [ ] **Step 5: Insert the new gate in the non-`disableRender` branch**

In `agent-tools.service.ts`, find the non-`disableRender` branch of `submit_result.execute`. This branch starts where the existing full eval pipeline runs (after assertions pass + render success). Locate the line that begins the full-eval block (search for `runFullEvaluation` or similar).

Insert the gate BEFORE the full-eval block. It must run after assertions and renders are confirmed, but before the canonical eval:

```typescript
// Forced component-checklist gate (assembler path only — fires when componentChecklist populated).
if (deps.componentChecklist && deps.componentChecklist.length > 0) {
  const renderedFiles = deps.getLastRenderedFiles();
  if (renderedFiles && renderedFiles.length > 0) {
    try {
      const verification = await runChecklistEval({
        checklist: deps.componentChecklist,
        originalIndices: deps.componentChecklist.map((_, i) => i),
        code: deps.fs.getMainCode(),
        renderedFiles,
        evalPlan: deps.evalPlan ?? null,
        visualVerify: verifyChecklistItemVisual,
        codeVerify: verifyChecklistItemCode,
      });

      deps.onChecklistEvaluated?.(verification);

      const failed = verification.results.filter((r) => r.verdict === "FAIL");
      if (failed.length > 0) {
        logger.info(
          {
            failed: failed.length,
            total: verification.results.length,
            componentName: deps.componentName,
          },
          "submission rejected — component checklist failures",
        );

        // Group failed items by their source component (via index lookup back into deps.componentChecklist).
        const byComponent: Record<string, typeof failed> = {};
        for (const f of failed) {
          const sourceItem = deps.componentChecklist[f.index];
          const cname = sourceItem?.componentName ?? "unknown";
          (byComponent[cname] ??= []).push(f);
        }

        const sections: string[] = [];
        for (const [cname, items] of Object.entries(byComponent)) {
          sections.push(`  Component "${cname}":`);
          for (const f of items) {
            sections.push(
              `    Item ${f.index} [${f.visibility.toUpperCase()}]: "${f.item}"\n      ${f.reasoning}`,
            );
          }
        }

        const lines = [
          `SUBMISSION REJECTED — ${failed.length} of ${verification.results.length} component-checklist item(s) failed:`,
          ``,
          ...sections,
          ``,
          `Fix these and try submit_result again. UNCERTAIN items are allowed; FAIL items are not.`,
        ];
        return lines.join("\n");
      }
      logger.debug(
        {
          passedCount: verification.passedCount,
          uncertainCount: verification.uncertainCount,
          componentName: deps.componentName,
        },
        "assembler checklist gate passed",
      );
    } catch (err) {
      logger.warn(
        { err, componentName: deps.componentName },
        "assembler checklist gate threw; proceeding to submit",
      );
      // Fall through to the canonical eval — gate failure should not permanently block.
    }
  }
  // If no cached renders, fall through. The assembler is expected to have rendered before submit;
  // in practice this branch is rare and the canonical eval below will catch issues.
}

// Existing full eval pipeline (unchanged) begins here.
```

`runChecklistEval`, `verifyChecklistItemVisual`, `verifyChecklistItemCode`, and `logger` are already imported (from the v1 work that is now being repositioned).

- [ ] **Step 6: Run the test to verify it passes**

```bash
docker compose exec -T backend npx vitest run src/__tests__/submit-result-checklist-gate.test.ts
```

Expected: 6/6 PASS.

- [ ] **Step 7: Rebuild backend container**

```bash
docker compose build backend && docker compose up -d backend
```

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/services/agent-tools.service.ts \
        packages/backend/src/__tests__/submit-result-checklist-gate.test.ts
git commit -m "Move forced checklist gate to assembler path with component-grouped output"
```

---

## Task 5: Rewrite assembler system prompt — repair authority

**Files:**
- Modify: `packages/backend/src/prompts/agent-system-prompt.ts` (`buildAssemblyAgentSystemPrompt` + `buildVerificationParagraph`)
- Modify: `packages/backend/src/services/agent-multi.service.ts` (drop the no-longer-used `componentsForAssembler` array from the assembler call site)
- Test: `packages/backend/src/__tests__/assembler-verification-section.test.ts` (rewrite)

The advisory `verificationParagraph` (Task 8) is replaced by a forced-gate-aware repair-authority block. The `componentsForAssembler` array passed to the prompt builder is no longer used (gate provides live feedback instead).

- [ ] **Step 1: Write the failing test**

Replace contents of `packages/backend/src/__tests__/assembler-verification-section.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildAssemblyAgentSystemPrompt } from "../prompts/agent-system-prompt.js";

describe("assembler system prompt — v2 repair-authority block", () => {
  it("contains the explicit repair-authority instruction", () => {
    const prompt = buildAssemblyAgentSystemPrompt("user prompt", "asm notes", "comp summary");
    expect(prompt).toMatch(/final author of the result/i);
    expect(prompt).toMatch(/you may modify any sub-component's code/i);
  });

  it("mentions evaluate_checklist tool usage proactively", () => {
    const prompt = buildAssemblyAgentSystemPrompt("p", "a", "c");
    expect(prompt).toMatch(/evaluate_checklist/);
    expect(prompt).toMatch(/proactively/i);
  });

  it("describes the forced verification on submit", () => {
    const prompt = buildAssemblyAgentSystemPrompt("p", "a", "c");
    expect(prompt).toMatch(/forced verification will run/i);
    expect(prompt).toMatch(/UNCERTAIN items pass through/i);
  });

  it("does NOT contain the v1 'do not try to repair' instruction", () => {
    const prompt = buildAssemblyAgentSystemPrompt("p", "a", "c");
    expect(prompt).not.toMatch(/do not try to repair/i);
  });

  it("does NOT contain the v1 advisory 'all sub-components passed' line", () => {
    const prompt = buildAssemblyAgentSystemPrompt("p", "a", "c");
    expect(prompt).not.toMatch(/all sub-components passed/i);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
docker compose exec -T backend npx vitest run src/__tests__/assembler-verification-section.test.ts
```

Expected: tests FAIL — current prompt has v1 wording.

- [ ] **Step 3: Rewrite `buildAssemblyAgentSystemPrompt`**

In `packages/backend/src/prompts/agent-system-prompt.ts`:

- DELETE the `AssemblerComponentVerification` interface (no longer used by the prompt builder)
- DELETE the `buildVerificationParagraph` private helper
- DELETE the `components?: AssemblerComponentVerification[]` parameter from `buildAssemblyAgentSystemPrompt`
- DELETE the `verificationParagraph` append at the end of the prompt

Replace the prompt-construction logic to APPEND this block immediately after the existing prompt body (before returning):

```typescript
const repairAuthorityBlock = `

You are the assembly agent. You have RENDER access and the evaluate_checklist tool.
Your job is not just composition — you are the final author of the result.

Per-component verification checklists are attached via your evaluate_checklist tool.
Each item has a componentName indicating which sub-component it targets. You may
modify any sub-component's code to satisfy these items — the original sub-agent
code is a starting point, not sacred. Composition fixes are also fair game.

Workflow:
1. Compose the assembly from the sub-component code.
2. validate_and_render.
3. Call evaluate_checklist proactively to verify items against the rendered view.
4. Fix failures by editing sub-component code or composition logic.
5. Re-render and re-verify.
6. submit_result when confident.

On submit, a forced verification will run on the full checklist. Any FAIL item
blocks submission with feedback on which component and what failed. UNCERTAIN
items pass through. Use the feedback to target your next fix.`;

return basePrompt + repairAuthorityBlock;
```

(Replace `basePrompt` with whatever variable name holds the current prompt body in the existing function.)

- [ ] **Step 4: Remove `componentsForAssembler` construction at the assembler call site**

In `packages/backend/src/services/agent-multi.service.ts`, find the assembler invocation (around the same area touched in Task 2). Delete the `componentsForAssembler` construction (the `.map(c => ({ name, verification }))` from Task 8). Delete the `components: componentsForAssembler` argument from the `buildAssemblyAgentSystemPrompt` call. Delete the now-unused observability log block (the `failedComponentNames` filter + `logger.info(...)`).

The assembler's system prompt now does NOT need component-verification advisory data — the gate provides feedback live during the agent loop.

- [ ] **Step 5: Run test to verify it passes**

```bash
docker compose exec -T backend npx vitest run src/__tests__/assembler-verification-section.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
docker compose exec -T backend npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | wc -l
```

Expected: 63.

- [ ] **Step 7: Rebuild backend container**

```bash
docker compose build backend && docker compose up -d backend
```

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/prompts/agent-system-prompt.ts \
        packages/backend/src/services/agent-multi.service.ts \
        packages/backend/src/__tests__/assembler-verification-section.test.ts
git commit -m "Rewrite assembler system prompt with repair authority (replaces v1 advisory)"
```

---

## Task 6: End-to-end smoke run

**Files:** none modified.

Verify the v2 wiring works end-to-end before launching the A/B.

- [ ] **Step 1: Pick a multi-agent prompt from the test set**

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT id, LEFT(prompt_text, 80) as prompt_preview \
   FROM workbench_example_prompts \
   WHERE requires_decomposition = true \
   ORDER BY created_at DESC LIMIT 5;"
```

Pick the first one. Record the id.

- [ ] **Step 2: Authenticate**

```bash
TOKEN=$(cat /tmp/chat3d-token.txt 2>/dev/null)
curl -s http://localhost/api/auth/me -H "Authorization: Bearer $TOKEN" >/dev/null && echo "token valid" || (
  TOKEN=$(curl -s http://localhost/api/auth/login -H "Content-Type: application/json" \
    -d '{"email":"admin@chat3d.local","password":"change-admin-password"}' | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['token'])")
  echo "$TOKEN" > /tmp/chat3d-token.txt
)
```

- [ ] **Step 3: Trigger a fresh generation**

Adapt to the actual workbench generation endpoint. Verify the endpoint via:

```bash
grep -rn "/api/admin/workbench\|generate" packages/backend/src/routes/admin/ | grep -i "post\|generate" | head -10
```

Then POST. Wait for completion by polling `workbench_examples` for the new row.

- [ ] **Step 4: Inspect the new row**

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT id, eval_score, jsonb_pretty(sub_agent_verifications) \
   FROM workbench_examples \
   WHERE prompt_id = '<PROMPT_ID>' \
   ORDER BY created_at DESC LIMIT 1;"
```

Expected:
- `sub_agent_verifications` is a NON-NULL JSON object with component names as keys (e.g. `body`, `pin`)
- Each entry has `passedCount`, `failedCount`, `uncertainCount`, `failedItems`

If `sub_agent_verifications` is NULL, the wiring is still broken — STOP and report instead of proceeding to Task 7.

- [ ] **Step 5: Inspect backend logs for gate activity**

```bash
docker compose logs backend --since 10m 2>&1 | grep -iE "assembler checklist gate|submission rejected" | head -20
```

Expected:
- Either "assembler checklist gate passed" (if the assembler got it right) OR "submission rejected — component checklist failures" (if it iterated)

- [ ] **Step 6: Optional commit**

If notable, append a short observation to the spec's follow-ups section. Otherwise skip.

---

## Task 7: A/B test against 30-prompt test set

**Files:**
- Create: `docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md`

- [ ] **Step 1: Capture v3 baseline**

If `/tmp/eval-plan-v3-after.tsv` exists from prior work, copy it. Otherwise re-capture:

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT prompt_id, eval_score, composite_weight_source, requires_decomposition \
   FROM workbench_examples we \
   JOIN workbench_example_prompts p ON we.prompt_id = p.id \
   WHERE p.id IN ( $(cat docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt | tr '\n' ',' | sed 's/,$//') ) \
   ORDER BY prompt_id;" > /tmp/in-loop-eval-baseline.csv
```

(Adjust the SQL to extract IDs from the test-set file format.)

- [ ] **Step 2: Trigger regeneration for all 30 test-set prompts**

Reuse the script pattern from prior A/B runs. Loop through prompt IDs, POST to the workbench generation endpoint, then poll for completion. Wait for all to land.

- [ ] **Step 3: Capture v4 metrics**

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT prompt_id, eval_score, composite_weight_source, \
          jsonb_pretty(sub_agent_verifications) as sub_agent_verifications \
   FROM workbench_examples we \
   JOIN workbench_example_prompts p ON we.prompt_id = p.id \
   WHERE p.id IN ( $(cat docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt | tr '\n' ',' | sed 's/,$//') ) \
   AND we.created_at > NOW() - INTERVAL '2 hours' \
   ORDER BY prompt_id;" > /tmp/in-loop-eval-v4.csv
```

- [ ] **Step 4: Compute deltas and write the report**

Create `docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md`:

```markdown
# In-Loop Semantic Eval v2 — A/B Test Results

Generated: 2026-06-06

## Setup

v3 (baseline): per-prompt eval_plan + clamp-suppress-on-eval-plan, no in-loop gate.
v4 (treatment): v3 + assembler-path forced gate + repair authority (Option 2).

## Per-bucket Δ (v3 → v4)

| Bucket | n | v3 mean | v4 mean | Δ | Range |
|---|---|---|---|---|---|
| Multi-agent prompts | <N> | <M3> | <M4> | <D> | [<min>, <max>] |
| Single-agent prompts | <N> | <M3> | <M4> | <D> | [<min>, <max>] |
| **Overall** | 30 | <M3> | <M4> | <D> | — |

## Killer-prompt recovery

| Prompt | v3 score | v4 score | Flip? |
|---|---|---|---|
| <id> | <s3> | <s4> | <Y/N> |

## Observability

- Multi-agent generations with non-null sub_agent_verifications: <X> of <N>
- Mean failed-component count per multi-agent generation: <X>
- Mean assembler step count: v3 <X> → v4 <X>

## Cost

- Mean LLM cost per generation v3 vs v4: <c3> → <c4> (ratio <r>)
- Mean wall time per generation: <w3> → <w4>

## Decision

<Ship / iterate / scope-reduce — based on success criteria from spec §6.>
```

Fill in actual numbers from the CSVs.

- [ ] **Step 5: Commit the results**

```bash
git add docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md
git commit -m "In-loop semantic eval v2 A/B test results"
```

- [ ] **Step 6: Report back to the user**

Summarize per-bucket Δ, killer-prompt flips, `sub_agent_verifications` population rate (criterion #4 from spec), cost, and the ship/iterate decision.

---

## Self-Review Notes

- **Spec coverage:** §1 architecture → Tasks 2, 3, 4. §2 aggregation → Task 2. §3 gate → Task 4. §4 system prompt → Task 5. §5 revert/keep/extend → Tasks 1–5 carry the changes. §6 A/B → Task 7. Non-goals respected (no sub-agent gate, no single-agent gate, no render-pipeline change).
- **Placeholder scan:** All steps have concrete code or commands. Task 6 references "the workbench generation endpoint" rather than a hard-coded URL because the endpoint is discovered at run time — that's a one-step grounding instruction, not a missing requirement.
- **Type consistency:** `ComponentChecklistItem.componentName?: string` (Task 1) is referenced in Tasks 2, 4. `aggregateChecklistForAssembler` (Task 2) signature stable. `runChecklistEval` (existing) signature unchanged.
- **Non-obvious risk:** Task 4's gate uses `deps.componentChecklist[f.index]` to map results back to source components. This works as long as `originalIndices` are identity (which Task 4 explicitly passes). If a future change passes a subset, the lookup must use the original indices — the gate already passes identity indices to keep this simple.
