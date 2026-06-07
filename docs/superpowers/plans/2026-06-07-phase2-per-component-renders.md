# Phase 2: Per-Component Renders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each sub-agent function as a "mini single-agent" focused on one component — render in isolation, iterate against real visual feedback, submit through a forced gate. Assembler verifies only the merged top-level + assemblyChecklist (not aggregated componentChecklists, which caused the v5 PCB regression).

**Architecture:** Sub-agents get the full toolkit. At `validate_and_render` time, a new `component-render.service.ts` wraps the sub-agent's `def <name>() -> Part` function with a generated `__main__` block, renders it through the existing Build123d pipeline, and stores outputs under `workbench/{categoryId}/{exampleId}/components/{componentName}.*`. The decomposition LLM is taught to put component-local items on `componentChecklist` and assembly-dependent items on a new `assemblyChecklist`. The assembler gates against the merged top-level + assemblyChecklist.

**Tech Stack:**
- Backend: TypeScript, Express, Prisma + Postgres, Vercel AI SDK
- Testing: vitest (`packages/backend/src/__tests__/`)
- Container: Docker Compose (`docker compose build backend && docker compose up -d backend`)
- Rendering: existing Build123d service via REST

**Spec:** [`docs/superpowers/specs/2026-06-07-phase2-per-component-renders-design.md`](../specs/2026-06-07-phase2-per-component-renders-design.md)

**Pre-state on `main`:** Phase 0+1 work landed (commits through `8837095`). The Phase 1 occlusion-routing dispatcher branch (commit `6946368`) exists in `checklist-eval.service.ts:99-119` and gets rolled back by Task 3. Sub-agent componentChecklist wiring was REMOVED in Phase 0+1 Task 3 (commit `acc3524`) — Phase 2 re-adds it but only the sub-agent's own checklist (not aggregated).

---

## File Structure

**Create:**
- `packages/backend/src/services/component-render.service.ts` — auto-wrap logic for sub-agent code at render time
- `packages/backend/src/__tests__/component-render.test.ts` — tests for the wrap helper
- `packages/backend/src/utils/checklist-merge.ts` — merge top-level verificationChecklist with assemblyChecklist (de-dupe by item text)
- `packages/backend/src/__tests__/checklist-merge.test.ts` — merge tests
- `docs/superpowers/specs/2026-06-07-phase2-test-results.md` — A/B results

**Modify:**
- `packages/backend/src/services/agent-multi-parser.ts` — add `assemblyChecklist` field; update `DECOMPOSE_CHECKLIST_ADDENDUM`
- `packages/backend/src/services/agent-multi.service.ts` — sub-agent: enable rendering + pass own componentChecklist; assembler: input from merger instead of aggregator
- `packages/backend/src/services/checklist-eval.service.ts` — remove Phase 1 occlusion routing branch
- `packages/backend/src/prompts/agent-system-prompt.ts` — sub-agent system prompt: instruct LLM to write function-only code
- `packages/backend/src/__tests__/decompose-prompt-checklist.test.ts` — update for assemblyChecklist + prompt wording
- `packages/backend/src/__tests__/checklist-eval.test.ts` — remove 6 occlusion-routing tests
- `packages/backend/src/__tests__/agent-multi-deps-wiring.test.ts` — update assembler-side tests to use the merger

---

## Task 1: Add `assemblyChecklist` to decomposition schema + parser

**Files:**
- Modify: `packages/backend/src/services/agent-multi-parser.ts`
- Test: `packages/backend/src/__tests__/decompose-prompt-checklist.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/src/__tests__/decompose-prompt-checklist.test.ts`:

```typescript
describe("parseDecompositionResponse — assemblyChecklist (Phase 2)", () => {
  it("parses assemblyChecklist when present", () => {
    const json = JSON.stringify({
      components: [{ name: "body", description: "x" }],
      assemblyChecklist: [
        { item: "Lid sits 0.5mm above body edge", visibility: "visual", assemblyVisibility: "visible" },
        { item: "PCB seats flush against standoffs", visibility: "both", assemblyVisibility: "occluded" },
      ],
      assemblyNotes: "n/a",
    });
    const r = parseDecompositionResponse(json);
    expect(r.assemblyChecklist).toHaveLength(2);
    expect(r.assemblyChecklist?.[0].item).toBe("Lid sits 0.5mm above body edge");
    expect(r.assemblyChecklist?.[1].assemblyVisibility).toBe("occluded");
  });

  it("returns undefined assemblyChecklist when absent (backwards compat)", () => {
    const json = JSON.stringify({
      components: [{ name: "body", description: "x" }],
      assemblyNotes: "n/a",
    });
    const r = parseDecompositionResponse(json);
    expect(r.assemblyChecklist).toBeUndefined();
  });

  it("drops invalid assemblyChecklist instead of throwing", () => {
    const json = JSON.stringify({
      components: [{ name: "body", description: "x" }],
      assemblyChecklist: [{ item: "x", visibility: "smell" }],
      assemblyNotes: "n/a",
    });
    const r = parseDecompositionResponse(json);
    expect(r.assemblyChecklist).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
docker compose exec -T backend npx vitest run src/__tests__/decompose-prompt-checklist.test.ts
```

Expected: 3 new tests FAIL — `assemblyChecklist` field doesn't exist.

- [ ] **Step 3: Extend the interface and parser**

In `packages/backend/src/services/agent-multi-parser.ts`, modify `DecompositionResult` (around lines 28-33) to add `assemblyChecklist?: ComponentChecklistItem[]`:

```typescript
export interface DecompositionResult {
  components: DecomposedComponent[];
  assemblyChecklist?: ComponentChecklistItem[];
  assemblyNotes: string;
  promptTokens?: number;
  completionTokens?: number;
}
```

In `parseDecompositionResponse` (around lines 78-117), parse the new field. Find the return block and update:

```typescript
const assemblyChecklistRaw = parseComponentChecklist((parsed as any).assemblyChecklist);

return {
  components,
  ...(assemblyChecklistRaw !== null ? { assemblyChecklist: assemblyChecklistRaw } : {}),
  assemblyNotes: String(parsed.assemblyNotes ?? ""),
};
```

`parseComponentChecklist` already returns `null` on invalid input (existing behavior). Reuse it.

- [ ] **Step 4: Run tests to confirm pass**

```bash
docker compose exec -T backend npx vitest run src/__tests__/decompose-prompt-checklist.test.ts
```

Expected: all tests PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/agent-multi-parser.ts \
        packages/backend/src/__tests__/decompose-prompt-checklist.test.ts
git commit -m "Add assemblyChecklist field to DecompositionResult"
```

---

## Task 2: Update `DECOMPOSE_CHECKLIST_ADDENDUM`

**Files:**
- Modify: `packages/backend/src/services/agent-multi-parser.ts`
- Test: `packages/backend/src/__tests__/decompose-prompt-checklist.test.ts`

The prompt currently tells the LLM occluded items will go to code-only verification. That's a lie in Phase 2. Also need to add component-local item discipline + the assemblyChecklist guidance.

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/src/__tests__/decompose-prompt-checklist.test.ts`:

```typescript
describe("DECOMPOSE_CHECKLIST_ADDENDUM — Phase 2 wording", () => {
  it("instructs the LLM to put assembly-dependent items in assemblyChecklist", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/assemblyChecklist/);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/relationship BETWEEN components/i);
  });

  it("instructs that component items must be checkable in isolation", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/verifiable.*component.*alone|own geometry/i);
  });

  it("describes assemblyVisibility as telemetry, not routing", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/training-data labels|analytics|telemetry/i);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).not.toMatch(/code-only verification|skip VLM/i);
  });

  it("provides concrete GOOD and BAD examples", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/GOOD component items/i);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/BAD component items/i);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
docker compose exec -T backend npx vitest run src/__tests__/decompose-prompt-checklist.test.ts
```

Expected: 4 new tests FAIL — current wording doesn't match.

- [ ] **Step 3: Replace the assemblyVisibility section and add new sections**

In `packages/backend/src/services/agent-multi-parser.ts`, find `DECOMPOSE_CHECKLIST_ADDENDUM` (lines 37-70). Replace the Phase 1 occlusion paragraph (currently mentions "code-only verification") with this new structure. The existing top-level componentChecklist instructions stay; add these AT THE END:

```
Each componentChecklist item MUST be verifiable against this component's own
geometry ALONE — i.e., when the component is rendered in isolation, without
any other components.

GOOD component items (verifiable alone):
  - "Body is a hollow box 50×75×2 mm with 2mm walls"     (geometry of the body)
  - "Three countersunk holes spaced 25mm apart"          (features on the body)
  - "Pin diameter is 4mm, length 75mm"                   (geometry of the pin)
  - "Knuckle is a cylindrical lobe at +Z=20mm"           (one lobe's position)

BAD component items (require assembly context — put these in assemblyChecklist):
  - "Knuckles alternate with the other leaf"             ← belongs in assemblyChecklist
  - "Pin slides through all 5 aligned knuckles"          ← belongs in assemblyChecklist
  - "Lid sits 0.5mm above body top edge"                 ← belongs in assemblyChecklist
  - "PCB rests flush against the standoffs"              ← belongs in assemblyChecklist

If a verification item depends on the relationship BETWEEN components, put it
in `assemblyChecklist` instead. Those items are verified at the assembler stage
against the assembled render.

For each item (in either componentChecklist or assemblyChecklist), ALSO emit
`assemblyVisibility`: `visible` (feature visible from outside the assembled
object) or `occluded` (feature hidden inside / covered by other components).
This is used for training-data labels and analytics. The actual verification
happens per-component in isolation — your sub-agent will see this component's
own rendered views, so occlusion in the assembled context doesn't affect
verification.
```

Output schema example in the decomposition system prompt (the JSON example) — if it shows the desired output shape, update it to include `assemblyChecklist`. Find by searching for `componentChecklist` in the system prompt string. Add:

```json
"assemblyChecklist": [
  { "item": "knuckles interlock without overlap", "visibility": "visual", "assemblyVisibility": "visible" }
]
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
docker compose exec -T backend npx vitest run src/__tests__/decompose-prompt-checklist.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/agent-multi-parser.ts \
        packages/backend/src/__tests__/decompose-prompt-checklist.test.ts
git commit -m "Rewrite decomposition addendum: component-local discipline + assemblyChecklist + telemetry"
```

---

## Task 3: Roll back Phase 1 occlusion routing in checklist-eval

**Files:**
- Modify: `packages/backend/src/services/checklist-eval.service.ts`
- Test: `packages/backend/src/__tests__/checklist-eval.test.ts`

- [ ] **Step 1: Delete the occlusion-routing tests**

In `packages/backend/src/__tests__/checklist-eval.test.ts`, find the describe block `describe("runChecklistEval — assemblyVisibility occlusion routing", ...)` (around lines 286-419). Delete the entire describe block (all 6 tests):
- "routes occluded visual-only items to code-only verification"
- "routes occluded both-visibility items to code-only"
- "keeps visible visual items on VLM (unchanged behavior)"
- "annotates reasoning with [occluded] marker for downgraded items"
- "does NOT annotate code-visibility items"
- "backwards compat: items without assemblyVisibility treated as visible"

- [ ] **Step 2: Revert the dispatcher logic**

In `packages/backend/src/services/checklist-eval.service.ts`, find the `runChecklistEval` function (around lines 85-146). Find the occlusion branch (lines 99-119) and revert to pre-Phase-1 form.

Replace:
```typescript
const isOccluded = entry.assemblyVisibility === "occluded";
const wantVisual = (entry.visibility === "visual" || entry.visibility === "both") && !isOccluded;
const wantCode = entry.visibility === "code"
              || entry.visibility === "both"
              || (isOccluded && entry.visibility === "visual");
```

With:
```typescript
const wantVisual = entry.visibility === "visual" || entry.visibility === "both";
const wantCode = entry.visibility === "code" || entry.visibility === "both";
```

Also find and delete the reasoning annotation block:
```typescript
const occludedDowngrade = isOccluded && entry.visibility !== "code";
const annotatedReasoning = occludedDowngrade
  ? `[occluded — code-only verification] ${combined.reasoning}`
  : combined.reasoning;
```

Replace the `reasoning: annotatedReasoning` usage in the returned `ChecklistItemResult` with `reasoning: combined.reasoning` (or whatever the local variable was before Phase 1).

- [ ] **Step 3: Run tests to confirm remaining tests pass**

```bash
docker compose exec -T backend npx vitest run src/__tests__/checklist-eval.test.ts
```

Expected: all REMAINING tests PASS (the 17 pre-Phase-1 + Phase 0+1 tests that didn't depend on occlusion routing).

- [ ] **Step 4: Verify TypeScript compiles**

```bash
docker compose exec -T backend npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | wc -l
```

Expected: 64 (or the current baseline, unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/checklist-eval.service.ts \
        packages/backend/src/__tests__/checklist-eval.test.ts
git commit -m "Soft rollback Phase 1: remove dispatcher routing (keep schema + prompt as telemetry)"
```

---

## Task 4: Component storage path helpers + checklist-merge utility

**Files:**
- Create: `packages/backend/src/utils/checklist-merge.ts`
- Create: `packages/backend/src/__tests__/checklist-merge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/src/__tests__/checklist-merge.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mergeAssemblyChecklist, componentStoragePrefix } from "../utils/checklist-merge.js";

describe("mergeAssemblyChecklist", () => {
  it("returns top-level when assemblyChecklist is undefined", () => {
    const r = mergeAssemblyChecklist(
      [{ item: "outer dim 50mm", visibility: "code" }],
      undefined,
    );
    expect(r).toHaveLength(1);
    expect(r[0].item).toBe("outer dim 50mm");
  });

  it("returns assemblyChecklist when top-level is empty", () => {
    const r = mergeAssemblyChecklist(
      [],
      [{ item: "knuckles interlock", visibility: "visual" }],
    );
    expect(r).toHaveLength(1);
    expect(r[0].item).toBe("knuckles interlock");
  });

  it("concatenates and de-dupes by item text (case-insensitive)", () => {
    const r = mergeAssemblyChecklist(
      [
        { item: "Outer dim is 50mm", visibility: "code" },
        { item: "Has 4 mounting holes", visibility: "visual" },
      ],
      [
        { item: "outer dim is 50mm", visibility: "both" },  // duplicate by text, top-level wins
        { item: "Knuckles interlock", visibility: "visual" },
      ],
    );
    expect(r).toHaveLength(3);
    expect(r.map(x => x.item)).toEqual([
      "Outer dim is 50mm",            // from top-level (kept)
      "Has 4 mounting holes",         // from top-level
      "Knuckles interlock",           // from assembly
    ]);
  });
});

describe("componentStoragePrefix", () => {
  it("builds the per-component storage prefix", () => {
    expect(componentStoragePrefix("cat-1", "ex-2", "body"))
      .toBe("workbench/cat-1/ex-2/components/body");
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
docker compose exec -T backend npx vitest run src/__tests__/checklist-merge.test.ts
```

Expected: tests FAIL — module not found.

- [ ] **Step 3: Implement the utility**

Create `packages/backend/src/utils/checklist-merge.ts`:

```typescript
import type { ComponentChecklistItem } from "./component-checklist.js";

/**
 * Merge a top-level verificationChecklist (from the parent prompt) with the
 * decomposition's assemblyChecklist. De-dupe by item text (case-insensitive,
 * trimmed). Top-level items win on duplicates.
 *
 * Used by the assembler in Phase 2: deps.componentChecklist = this merged list.
 */
export function mergeAssemblyChecklist(
  topLevel: ComponentChecklistItem[],
  assemblyChecklist: ComponentChecklistItem[] | undefined,
): ComponentChecklistItem[] {
  if (!assemblyChecklist || assemblyChecklist.length === 0) return [...topLevel];

  const seen = new Set<string>();
  const result: ComponentChecklistItem[] = [];

  for (const item of topLevel) {
    const key = item.item.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  for (const item of assemblyChecklist) {
    const key = item.item.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/**
 * Storage prefix for per-component artifacts.
 * `workbench/{categoryId}/{exampleId}/components/{componentName}` (without extension).
 *
 * Files appended at runtime: .py, .stl, .3mf, .front.png, .back.png, ...
 */
export function componentStoragePrefix(
  categoryId: string,
  exampleId: string,
  componentName: string,
): string {
  return `workbench/${categoryId}/${exampleId}/components/${componentName}`;
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
docker compose exec -T backend npx vitest run src/__tests__/checklist-merge.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/utils/checklist-merge.ts \
        packages/backend/src/__tests__/checklist-merge.test.ts
git commit -m "Add mergeAssemblyChecklist + componentStoragePrefix helpers"
```

---

## Task 5: Component render service (auto-wrap)

**Files:**
- Create: `packages/backend/src/services/component-render.service.ts`
- Create: `packages/backend/src/__tests__/component-render.test.ts`

This is the substantive new infrastructure. The service strips any existing `__main__` block from the sub-agent's source, validates the expected function exists (string-match), and appends a generated `__main__` block that exports the component's geometry.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/backend/src/__tests__/component-render.test.ts
import { describe, expect, it } from "vitest";
import { wrapSubAgentCode, hasComponentFunction, stripMainBlock } from "../services/component-render.service.js";

describe("hasComponentFunction", () => {
  it("detects `def <name>() -> Part:` at the start of a line", () => {
    expect(hasComponentFunction("def body() -> Part:\n    return Box(1,1,1)", "body")).toBe(true);
  });
  it("detects without -> Part annotation", () => {
    expect(hasComponentFunction("def body():\n    return Box(1,1,1)", "body")).toBe(true);
  });
  it("returns false when the function name differs", () => {
    expect(hasComponentFunction("def lid() -> Part:\n    return Box(1,1,1)", "body")).toBe(false);
  });
  it("returns false when no function is defined", () => {
    expect(hasComponentFunction("x = 1", "body")).toBe(false);
  });
});

describe("stripMainBlock", () => {
  it("removes a trailing __main__ block", () => {
    const code = `def body():\n    return 1\n\nif __name__ == "__main__":\n    print("x")`;
    expect(stripMainBlock(code)).toBe(`def body():\n    return 1`);
  });
  it("removes a __main__ block with single quotes", () => {
    const code = `def body():\n    return 1\n\nif __name__ == '__main__':\n    print("x")`;
    expect(stripMainBlock(code)).toBe(`def body():\n    return 1`);
  });
  it("leaves code unchanged when no __main__ block", () => {
    const code = `def body():\n    return 1`;
    expect(stripMainBlock(code)).toBe(code);
  });
});

describe("wrapSubAgentCode", () => {
  it("strips existing __main__ then appends generated wrapper", () => {
    const original = `from build123d import *\n\ndef body() -> Part:\n    return Box(10, 20, 5)\n\nif __name__ == "__main__":\n    body().export_stl("wrong.stl")`;
    const wrapped = wrapSubAgentCode({
      code: original,
      componentName: "body",
      outputStlPath: "/tmp/component.stl",
      output3mfPath: "/tmp/component.3mf",
    });

    expect(wrapped).not.toContain('export_stl("wrong.stl")');
    expect(wrapped).toContain('if __name__ == "__main__"');
    expect(wrapped).toContain('body()');
    expect(wrapped).toContain('export_stl("/tmp/component.stl")');
    expect(wrapped).toContain('export_3mf("/tmp/component.3mf")');
  });

  it("throws when the expected function is not defined", () => {
    expect(() => wrapSubAgentCode({
      code: "x = 1",
      componentName: "body",
      outputStlPath: "/tmp/c.stl",
      output3mfPath: "/tmp/c.3mf",
    })).toThrow(/function `body`/);
  });

  it("appends the wrapper when source has no existing __main__", () => {
    const original = `def pin() -> Part:\n    return Cylinder(1, 5)`;
    const wrapped = wrapSubAgentCode({
      code: original,
      componentName: "pin",
      outputStlPath: "/tmp/pin.stl",
      output3mfPath: "/tmp/pin.3mf",
    });
    expect(wrapped).toContain(original);
    expect(wrapped).toContain('pin()');
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
docker compose exec -T backend npx vitest run src/__tests__/component-render.test.ts
```

Expected: tests FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `packages/backend/src/services/component-render.service.ts`:

```typescript
import { createLogger } from "../utils/logger.js";

const logger = createLogger("component-render");

/**
 * Returns true if the source contains a `def <componentName>(` definition
 * at the start of a line. Tolerates `-> Part:` annotation or no annotation.
 */
export function hasComponentFunction(code: string, componentName: string): boolean {
  const re = new RegExp(`^def\\s+${componentName}\\s*\\(`, "m");
  return re.test(code);
}

/**
 * Strips a trailing `if __name__ == "__main__":` block (with everything after it).
 * Handles single OR double quotes. Idempotent.
 */
export function stripMainBlock(code: string): string {
  // Match the start of an __main__ guard to end of file
  const re = /\n*if\s+__name__\s*==\s*["']__main__["']\s*:[\s\S]*$/;
  return code.replace(re, "").trimEnd();
}

export interface WrapInput {
  code: string;
  componentName: string;
  outputStlPath: string;
  output3mfPath: string;
}

/**
 * Wrap the sub-agent's component code for standalone rendering.
 * 1. Strip any existing __main__ block (defensive — sub-agent shouldn't write one).
 * 2. Verify the expected `def <componentName>(` function exists; throw if not.
 * 3. Append a generated __main__ block that calls the function and exports STL/3MF.
 *
 * The wrapped output is sent to the Build123d service. The on-disk source file
 * (stored at component-storage prefix) keeps the UNWRAPPED version — the assembler
 * imports the function directly without the wrapper.
 */
export function wrapSubAgentCode(input: WrapInput): string {
  const stripped = stripMainBlock(input.code);

  if (!hasComponentFunction(stripped, input.componentName)) {
    throw new Error(
      `Sub-agent code does not define function \`${input.componentName}\`. ` +
      `Expected \`def ${input.componentName}() -> Part:\` at the start of a line.`,
    );
  }

  const wrapper = `

if __name__ == "__main__":
    _result = ${input.componentName}()
    _result.export_stl("${input.outputStlPath}")
    _result.export_3mf("${input.output3mfPath}")
`;

  return stripped + wrapper;
}

/**
 * Audit-log a wrap operation. Useful telemetry for A/B observability.
 */
export function logWrap(componentName: string, codeLen: number, wrappedLen: number): void {
  logger.debug(
    { componentName, codeLen, wrappedLen },
    "wrapped sub-agent code for standalone render",
  );
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
docker compose exec -T backend npx vitest run src/__tests__/component-render.test.ts
```

Expected: 10/10 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/component-render.service.ts \
        packages/backend/src/__tests__/component-render.test.ts
git commit -m "Add component-render service: auto-wrap sub-agent code for standalone rendering"
```

---

## Task 6: Enable rendering for sub-agents + wire component render

**Files:**
- Modify: `packages/backend/src/services/agent-multi.service.ts`

The Phase 0+1 work confirmed: sub-agents are spawned via `runSubAgent()` in `agent-multi.service.ts:198-234` with `disableRender: true` (line 212) and `enableSearch: false` (line 213). Phase 2 flips both for sub-agents and routes their `validate_and_render` through the wrap helper.

The mechanism: at sub-agent spawn time, we set per-component `baseFileName` so the existing rendering path writes outputs under the component storage prefix. The wrap helper modifies the code in-flight just before invoking the Build123d service.

**Critical:** sub-agents need their own componentChecklist on deps (so the existing forced gate in submit_result fires against the right items). This was removed in Phase 0+1 Task 3; we re-add it (per-component, NOT aggregated).

- [ ] **Step 1: Read the current runSubAgent invocation**

```bash
grep -n "runSubAgent\|runAgentCodegen\|disableRender" packages/backend/src/services/agent-multi.service.ts | head -30
```

Identify:
- `runSubAgent` function start
- The `runAgentCodegen` call inside it
- Lines that set `disableRender: true` and `enableSearch: false`
- The `baseFileName` field
- Whether `componentChecklist` is currently passed to sub-agent (should be NOT — was removed in Phase 0+1 Task 3)

- [ ] **Step 2: Enable rendering + add per-component checklist for sub-agents**

In `agent-multi.service.ts`, inside `runSubAgent`'s `runAgentCodegen` call (around lines 198-234), change these fields:

```typescript
// Was: disableRender: true
disableRender: false,
// Was: enableSearch: false
enableSearch: false,  // KEEP false — sub-agents use pre-loaded research
// Was: (componentChecklist field missing)
componentChecklist: component.componentChecklist ?? [],
componentName: component.name,
onChecklistEvaluated: (verification) => {
  // Capture per-sub-agent verification into the existing accumulator
  subAgentVerifications[component.name] = {
    passedCount: verification.passedCount,
    failedCount: verification.failedCount,
    uncertainCount: verification.uncertainCount,
    failedItems: verification.results
      .filter(r => r.verdict === "FAIL")
      .map(r => ({ item: r.item, reasoning: r.reasoning })),
  };
},
```

For the storage prefix, modify the `baseFileName` argument to point at the per-component subdirectory. The existing pattern uses `{exampleId}` — change to `{exampleId}/components/{componentName}`:

```typescript
// Was: baseFileName: input.baseFileName (or similar)
baseFileName: `${input.baseFileName}/components/${component.name}`,
```

The exact identifier depends on the current code — verify by reading.

- [ ] **Step 3: Wire the wrap helper into validate_and_render for sub-agents**

The cleanest split: `agent-tools.service.ts:781-818` (the `validate_and_render` tool) calls `doRender` from `agent-render-helpers.service.ts`. For sub-agents, we want to wrap the code before the render call.

Approach: in the `validate_and_render` tool, detect sub-agent mode via `deps.componentName !== undefined && deps.componentName !== "assembler"`. When in sub-agent mode, apply `wrapSubAgentCode` before sending to `doRender`.

Open `packages/backend/src/services/agent-tools.service.ts:781`. Find the `validate_and_render` tool. Inside the `execute` handler, BEFORE calling `doRender`:

```typescript
// Sub-agent path: wrap the main code with __main__ block for standalone rendering
const isSubAgent = deps.componentName !== undefined && deps.componentName !== "assembler";
let projectFiles = deps.wrapProjectFiles();

if (isSubAgent && deps.componentName) {
  const { wrapSubAgentCode } = await import("./component-render.service.js");
  // Find the main code file (the one matching baseFileName)
  const mainFileName = deps.baseFileName.split("/").pop()! + ".py"; // e.g. "body.py"
  projectFiles = projectFiles.map(f => {
    if (f.path.endsWith(mainFileName) || f.path === mainFileName) {
      return {
        ...f,
        content: wrapSubAgentCode({
          code: f.content,
          componentName: deps.componentName!,
          // outputs sit alongside the source file in the render service tempdir
          outputStlPath: "/tmp/component.stl",
          output3mfPath: "/tmp/component.3mf",
        }),
      };
    }
    return f;
  });
}

// Then proceed with the existing doRender call, passing projectFiles
```

The exact wiring depends on the current `validate_and_render` shape — adapt to whatever `doRender` accepts. The key idea: replace the sub-agent's main code file with the wrapped version before the render call.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
docker compose exec -T backend npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | wc -l
```

Expected: 64 (baseline unchanged).

- [ ] **Step 5: Rebuild backend**

```bash
docker compose build backend && docker compose up -d backend
```

- [ ] **Step 6: Run existing tests to verify no regressions**

```bash
docker compose exec -T backend npx vitest run \
  src/__tests__/checklist-eval.test.ts \
  src/__tests__/agent-multi-deps-wiring.test.ts \
  src/__tests__/component-checklist.test.ts \
  src/__tests__/decompose-prompt-checklist.test.ts \
  src/__tests__/submit-result-checklist-gate.test.ts
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/agent-multi.service.ts \
        packages/backend/src/services/agent-tools.service.ts
git commit -m "Enable rendering for sub-agents; route validate_and_render through wrap helper"
```

---

## Task 7: Sub-agent system prompt — function-only code

**Files:**
- Modify: `packages/backend/src/prompts/agent-system-prompt.ts` (buildSubAgentSystemPrompt)
- Test: `packages/backend/src/__tests__/sub-agent-system-prompt.test.ts` (new or extend existing)

Sub-agent prompts currently tell the LLM to produce a function. Phase 2 adds explicit guidance about the wrapping and the per-component renders.

- [ ] **Step 1: Locate buildSubAgentSystemPrompt**

```bash
grep -n "buildSubAgentSystemPrompt\|sub-agent.*system.*prompt" packages/backend/src/prompts/agent-system-prompt.ts | head -5
```

- [ ] **Step 2: Write the failing test**

If a test file already exists for sub-agent prompts, append to it. Otherwise create:

```typescript
// packages/backend/src/__tests__/sub-agent-system-prompt.test.ts
import { describe, expect, it } from "vitest";
import { buildSubAgentSystemPrompt } from "../prompts/agent-system-prompt.js";

describe("buildSubAgentSystemPrompt — Phase 2 component function discipline", () => {
  it("instructs the LLM to write a function, not a __main__ block", () => {
    const prompt = buildSubAgentSystemPrompt({
      componentName: "body",
      componentDescription: "the hollow box",
      overallContext: "a small enclosure",
    });
    expect(prompt).toMatch(/function `body`|def body/i);
    expect(prompt).toMatch(/NOT write a `__main__` block|do not write.*__main__/i);
  });

  it("explains the standalone-render verification step", () => {
    const prompt = buildSubAgentSystemPrompt({
      componentName: "body",
      componentDescription: "the hollow box",
      overallContext: "a small enclosure",
    });
    expect(prompt).toMatch(/rendered.*isolation|standalone.*verification/i);
  });
});
```

Adapt the call signature to whatever `buildSubAgentSystemPrompt` actually accepts. Read its current signature first.

- [ ] **Step 3: Run tests to confirm failure**

```bash
docker compose exec -T backend npx vitest run src/__tests__/sub-agent-system-prompt.test.ts
```

Expected: tests FAIL.

- [ ] **Step 4: Update the prompt**

In `packages/backend/src/prompts/agent-system-prompt.ts`, find `buildSubAgentSystemPrompt`. Add a new section at the end of the prompt body (before returning):

```typescript
const componentFunctionDiscipline = `

You are responsible for ONE component of a multi-part assembly: \`${componentName}\`.

Write your code as a function \`${componentName}() -> Part\` that returns the component's
geometry. The function will be:
  1. Rendered in isolation (the orchestrator wraps your code with a generated
     \`__main__\` block at render time; you don't write one).
  2. Called by the assembler later to compose the final object.

DO NOT write a \`__main__\` block, \`if __name__ == "__main__":\`, or any code outside
the function body — focus on the geometry. Imports at module top-level are fine
(\`from build123d import *\`, etc.).

Before you submit, your component will be rendered standalone and verified
against its component-specific checklist. Iterate based on the rendered views
and the checklist verdicts you see in tool results.
`;

return basePrompt + componentFunctionDiscipline;
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
docker compose exec -T backend npx vitest run src/__tests__/sub-agent-system-prompt.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/prompts/agent-system-prompt.ts \
        packages/backend/src/__tests__/sub-agent-system-prompt.test.ts
git commit -m "Sub-agent prompt: write function-only code; standalone render before submit"
```

---

## Task 8: Assembler input — merged top-level + assemblyChecklist

**Files:**
- Modify: `packages/backend/src/services/agent-multi.service.ts`
- Test: `packages/backend/src/__tests__/agent-multi-deps-wiring.test.ts`

The assembler currently receives the AGGREGATED componentChecklists (via `aggregateChecklistForAssembler`). Phase 2 replaces this with the MERGED top-level verificationChecklist + decomposition's assemblyChecklist.

- [ ] **Step 1: Write the failing test**

In `packages/backend/src/__tests__/agent-multi-deps-wiring.test.ts`, append a new describe block:

```typescript
import { mergeAssemblyChecklist } from "../utils/checklist-merge.js";

describe("assembler input — merged top-level + assemblyChecklist (Phase 2)", () => {
  it("uses mergeAssemblyChecklist for assembler's componentChecklist", () => {
    // Smoke: the merged checklist combines top-level + assembly items
    const merged = mergeAssemblyChecklist(
      [{ item: "Outer dim 50mm", visibility: "code" }],
      [{ item: "Knuckles interlock", visibility: "visual" }],
    );
    expect(merged).toHaveLength(2);
    expect(merged.map(i => i.item)).toContain("Outer dim 50mm");
    expect(merged.map(i => i.item)).toContain("Knuckles interlock");
  });
});
```

The substantive verification of the wiring is end-to-end (Tasks 9/10).

- [ ] **Step 2: Find the assembler invocation**

```bash
grep -n "aggregateChecklistForAssembler\|assembler\|runAgentCodegen" packages/backend/src/services/agent-multi.service.ts | head -20
```

Identify:
- Where `aggregateChecklistForAssembler` is called (around line 401 per Phase 0+1 work)
- Where `componentChecklist: aggregatedChecklist` is passed to the assembler's `runAgentCodegen`

- [ ] **Step 3: Replace the aggregator call with the merger**

In `agent-multi.service.ts`, near the assembler invocation, replace:

```typescript
const assemblerChecklist = aggregateChecklistForAssembler(decomposition.components);
```

With:

```typescript
import { mergeAssemblyChecklist } from "../utils/checklist-merge.js";

// Phase 2: assembler verifies the parent prompt's top-level checklist merged
// with the decomposition's assemblyChecklist. Component-local items were
// already verified at each sub-agent's submit_result.
const topLevelChecklist = input.verificationChecklist ?? [];  // adapt to actual field
const assemblerChecklist = mergeAssemblyChecklist(
  topLevelChecklist,
  decomposition.assemblyChecklist,
);
```

The `input.verificationChecklist` field name is approximate — find the actual field on `AgentCodegenInput` that carries the parent prompt's annotated criteria. Adapt.

Leave `aggregateChecklistForAssembler` defined for now (no callers, but other tests may import it). Mark its JSDoc as `@deprecated Phase 2 replaces this with mergeAssemblyChecklist`.

- [ ] **Step 4: Update the existing assembler-deps-wiring tests**

The existing `assembleeOnChecklistEvaluated callback (twin)` test (around lines 85-161) groups results by componentName. In Phase 2, the assembler doesn't have per-component grouping — it verifies one merged list. The groupings now flow from per-component sub-agent runs, not from assembler verification.

Decide: KEEP the existing test (it tests the callback logic that's still used for sub-agent verifications) but note via comment that the assembler's callback no longer fires with mixed-component results (only top-level + assembly items, neither with componentName).

If the tests break because the assembler callback expects a `componentName` on each item, adapt by either:
- Stripping `componentName` from the merged items before passing to the assembler (mergeAssemblyChecklist doesn't add componentName)
- Or accepting that the assembler's accumulator may bucket all items under "unknown" — also fine, since no sub-agent path runs through assembler's callback in Phase 2

Confirm by running the existing tests after the change.

- [ ] **Step 5: Run tests**

```bash
docker compose exec -T backend npx vitest run \
  src/__tests__/agent-multi-deps-wiring.test.ts \
  src/__tests__/checklist-merge.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
docker compose exec -T backend npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | wc -l
```

Expected: 64 (baseline).

- [ ] **Step 7: Rebuild backend**

```bash
docker compose build backend && docker compose up -d backend
```

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/services/agent-multi.service.ts \
        packages/backend/src/__tests__/agent-multi-deps-wiring.test.ts
git commit -m "Assembler input: merged top-level + assemblyChecklist (replaces aggregator)"
```

---

## Task 9: Smoke test (Pi PCB + hinge)

**Files:** none modified (verification only).

Verify Phase 2 wiring works on TWO multi-agent prompts before launching the full A/B. The PCB prompt was the v5 regression killer; the hinge prompt is the canonical decomposable mechanism.

- [ ] **Step 1: Authenticate**

```bash
TOKEN=$(cat /tmp/chat3d-token.txt 2>/dev/null)
curl -s http://localhost/api/auth/me -H "Authorization: Bearer $TOKEN" >/dev/null && echo "token valid" || (
  TOKEN=$(curl -s http://localhost/api/auth/login -H "Content-Type: application/json" \
    -d '{"email":"admin@chat3d.local","password":"change-admin-password"}' | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['token'])")
  echo "$TOKEN" > /tmp/chat3d-token.txt
)
```

- [ ] **Step 2: Discover the regeneration endpoint**

```bash
grep -rn "router.post\|.post(" /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend/src/routes/admin/ 2>/dev/null | grep -iE "workbench.*generat|regenerat" | head -10
```

Use the discovered endpoint via curl.

- [ ] **Step 3: Trigger regeneration for both smoke prompts**

```bash
# Pi Zero 2 W case
PI=05066df7-7d80-411c-b9e6-2196d49ba80c
# Concealed barrel hinge
HINGE=352c4a35-8dc1-4932-9862-8f3aa55de774

curl -X POST "http://localhost/api/admin/workbench/prompts/$PI/regenerate" \
  -H "Authorization: Bearer $TOKEN" -o /dev/null -w "%{http_code}\n"
curl -X POST "http://localhost/api/admin/workbench/prompts/$HINGE/regenerate" \
  -H "Authorization: Bearer $TOKEN" -o /dev/null -w "%{http_code}\n"
```

(Adjust the endpoint path/shape to whatever Step 2 discovered.)

- [ ] **Step 4: Wait for completion**

```bash
for PROMPT_ID in $PI $HINGE; do
  echo "Waiting for $PROMPT_ID..."
  while true; do
    NEW=$(docker compose exec -T postgres psql -U chat3d -d chat3d -t -c \
      "SELECT id FROM workbench_examples \
       WHERE prompt_id = '$PROMPT_ID' \
       AND created_at > NOW() - INTERVAL '20 minutes' \
       AND eval_score IS NOT NULL \
       ORDER BY created_at DESC LIMIT 1;" | xargs)
    if [ -n "$NEW" ]; then echo "  Done: $NEW"; break; fi
    echo "  Still generating..."
    sleep 30
  done
done
```

- [ ] **Step 5: Verify per-component files in storage**

```bash
# For each new example, check that per-component files exist
for PROMPT_ID in $PI $HINGE; do
  EX=$(docker compose exec -T postgres psql -U chat3d -d chat3d -t -c \
    "SELECT id FROM workbench_examples WHERE prompt_id = '$PROMPT_ID' ORDER BY created_at DESC LIMIT 1;" | xargs)
  CAT=$(docker compose exec -T postgres psql -U chat3d -d chat3d -t -c \
    "SELECT category_id FROM workbench_example_prompts WHERE id = '$PROMPT_ID';" | xargs)
  echo "Example $EX (category $CAT) — looking for per-component files:"
  docker compose exec -T backend ls -la "/data/storage/workbench/$CAT/$EX/components/" 2>/dev/null || echo "  NOT FOUND"
done
```

Expected: each example has a `components/` directory with `{componentName}.stl`, `.3mf`, `.py`, and several `.png` files.

If `components/` is empty or missing: STOP. The render wiring is broken. Debug before proceeding.

- [ ] **Step 6: Verify sub-agent gates fired**

```bash
docker compose logs backend --since 30m 2>&1 | grep -E "submission rejected|sub-agent.*gate|component-checklist" | head -30
```

Expected: sub-agent FAIL/PASS log lines per component. The forced gate is firing.

- [ ] **Step 7: Check the eval scores**

```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -c \
  "SELECT we.prompt_id, we.eval_score, jsonb_pretty(we.sub_agent_verifications) \
   FROM workbench_examples we \
   WHERE we.prompt_id IN ('$PI', '$HINGE') \
   ORDER BY we.created_at DESC LIMIT 2;"
```

Targets:
- Pi `05066df7`: score ≥ 6.0 (was 7.5 in v4, 1.0 in v5 — Phase 2 must recover)
- Hinge `352c4a35`: score ≥ 7.0 (v4 had ~8.0)

If Pi score < 6.0: investigation needed; don't proceed to full A/B.

- [ ] **Step 8: No commit; report outcomes**

Smoke is verification. Report to the controller:
- Per-component files present (Y/N per prompt)
- Eval scores per prompt
- Gate log evidence (Y/N)
- Verdict: proceed to A/B (✅) or pause and debug (❌)

---

## Task 10: A/B test against 30-prompt set

**Files:**
- Create: `docs/superpowers/specs/2026-06-07-phase2-test-results.md`

Same shape as the v4 → v5 A/B but with Phase 2 success criteria.

- [ ] **Step 1: Read the test set**

```bash
cat /Users/daniel/src/github/kreuzhofer/chat3d-app/docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt
```

Parse the 30 prompt IDs.

- [ ] **Step 2: Capture v4 baseline scores**

The v4 results live in `docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md`. Reference those. If you need to re-query for the per-prompt v4 scores:

```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -c \
  "SELECT DISTINCT ON (we.prompt_id) we.prompt_id, we.eval_score, p.requires_decomposition \
   FROM workbench_examples we \
   JOIN workbench_example_prompts p ON we.prompt_id = p.id \
   WHERE we.prompt_id::text IN ($(cat /Users/daniel/src/github/kreuzhofer/chat3d-app/docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt | python3 -c "import sys; print(','.join(\"'\" + l.strip() + \"'\" for l in sys.stdin if l.strip() and not l.startswith('#')))")) \
   AND we.created_at < '2026-06-07'::timestamptz \
   ORDER BY we.prompt_id, we.created_at DESC;" > /tmp/phase2-v4-baseline.csv
```

- [ ] **Step 3: Trigger regeneration for all 30 prompts**

Use the same shape as Task 9 Step 3, looping over all 30 IDs. Stagger 2s between fires to avoid hammering at t=0.

- [ ] **Step 4: Wait for all to complete**

Poll pattern from prior A/Bs. ETA 60-90 min wall.

- [ ] **Step 5: Capture v6 (Phase 2) metrics**

```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -c \
  "SELECT DISTINCT ON (we.prompt_id) we.prompt_id, we.eval_score, \
          we.composite_weight_source, p.requires_decomposition, \
          jsonb_pretty(we.sub_agent_verifications) as sub_agent_verifications \
   FROM workbench_examples we \
   JOIN workbench_example_prompts p ON we.prompt_id = p.id \
   WHERE we.prompt_id::text IN (<the 30 IDs>) \
   AND we.created_at > NOW() - INTERVAL '3 hours' \
   ORDER BY we.prompt_id, we.created_at DESC;" > /tmp/phase2-v6.csv
```

- [ ] **Step 6: Compute deltas + observability**

For each prompt, v4 baseline vs v6 score. Aggregate by `requires_decomposition` partition. Compute:
- Multi-agent mean Δ
- Single-agent mean Δ
- PCB recovery (Pi `05066df7`, Jetson `09c2b5de` — were 7.5 in v4)
- M3 screw (`2d902495` — was 2.0 in v4)
- % multi-agent runs with per-component files present (target ≥ 95%)
- Mean sub-agent step count
- Cost ratio (compare total tokens v4 vs v6)

- [ ] **Step 7: Write the results report**

Create `docs/superpowers/specs/2026-06-07-phase2-test-results.md`:

```markdown
# Phase 2 — A/B Test Results

Generated: 2026-06-07

## Setup

v4 baseline: in-loop semantic eval v2 + Phase 0 hygiene. Multi-agent: 5.95,
single-agent: 8.04, overall: 7.28.

v6 (Phase 2): v4 + sub-agent self-rendering + 2-tier verification + decomposition
discipline + soft Phase 1 rollback.

## Per-bucket Δ (v4 → v6)

| Bucket | n | v4 mean | v6 mean | Δ | Target |
|---|---|---|---|---|---|
| Multi-agent | <N> | 5.95 | <M6> | <Δ> | ≥ +1.0 |
| Single-agent | <N> | 8.04 | <M6> | <Δ> | ≥ −0.2 |
| Overall | 30 | 7.28 | <M6> | <Δ> | — |

## PCB recovery (criterion 3)

| Prompt | v4 | v5 (broken) | v6 (Phase 2) | Verdict |
|---|---|---|---|---|
| Pi Zero (`05066df7`) | 7.5 | 1.0 | <X> | ≥6 → PASS |
| Jetson (`09c2b5de`) | 7.5 | 3.4 | <X> | ≥6 → PASS |

## M3 screw

| Prompt | v4 | v6 |
|---|---|---|
| M3 screw (`2d902495`) | 2.0 | <X> |

## Wiring observability

- % multi-agent runs with per-component files present: <X%> (target ≥ 95%)
- Mean sub-agent step count: <X>
- % sub-agent runs hitting step cap: <X%>
- Sub-agent forced-gate FAIL rate (mean rejections per sub-agent): <X>

## Cost

- Mean LLM cost per multi-agent gen v4 vs v6: <c4> → <c6> (ratio <r>)
- Total A/B cost: $<X>

## Decision

<Ship / iterate / escalate to cross-section renders>

Reasoning vs success criteria:
- Multi-agent Δ ≥ +1.0: <result>
- Multi-agent ≥ 7.0 absolute: <result>
- PCB recovery ≥ 6.0 each: <result>
- M3 screw ≥ 5.0: <result>
- Single-agent Δ ≥ −0.2: <result>
- Wiring ≥ 95%: <result>
- Cost ratio ≤ 3×: <result>
```

Fill in actual numbers.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-06-07-phase2-test-results.md
git commit -m "Phase 2 A/B test results"
```

- [ ] **Step 9: Report back**

Summarize the decision with the criterion table for the user.

---

## Self-Review Notes

- **Spec coverage:** §Architecture → Tasks 5, 6, 8. §Sub-agent self-rendering → Tasks 5, 6, 7. §Verification topology → Tasks 6, 8. §Phase 1 rollback → Task 3. §Decomposition discipline → Tasks 1, 2. §Cost (step budget) → Task 6 implicit (reuse existing workbench.agent_max_steps). §A/B → Tasks 9, 10. Non-goals: no single-agent path change, no rendering pipeline change, no spec-LLM change.
- **Placeholder scan:** Tasks 6, 7, 8 have "verify by reading" instructions for the exact identifiers (sub-agent invocation site, prompt builder signature, assembler's verificationChecklist field name). These are grounding steps, not unresolved requirements.
- **Type consistency:** `assemblyChecklist?: ComponentChecklistItem[]` on `DecompositionResult` (Task 1) referenced consistently in Tasks 2, 8. `mergeAssemblyChecklist` signature stable across Tasks 4, 8. `componentStoragePrefix` defined in Task 4 referenced in Task 6's `baseFileName` shape.
- **Risk:** Task 6 is the highest-risk single task — flipping `disableRender` for sub-agents touches a lot of the rendering pipeline indirectly. The smoke test (Task 9) is the safety net before $36 A/B (Task 10). If Task 9's "per-component files present" check fails, STOP before A/B.
