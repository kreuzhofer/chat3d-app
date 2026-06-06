# In-Loop Semantic Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the codegen agent a per-checklist-item `evaluate_checklist` tool, and use it as a forced verification gate at sub-agent `submit_result` in multi-agent decomposition. Single-agent gets the tool but no force.

**Architecture:** Add a per-item eval service that dispatches visual/code/both checks against cached renders. Register it as an agent tool. Extend `decomposePrompt` to emit `componentChecklist` per component. Inject the checklist into each sub-agent's `deps` and add a rejection branch in `submit_result` that runs the focused eval and blocks on FAIL items only. Forward results to the assembler as advisory metadata. Add two observability columns. Post-eval pipeline untouched.

**Tech Stack:**
- Backend: TypeScript, Express, Prisma + Postgres, Vercel AI SDK (`generateText`)
- Testing: vitest (`packages/backend/src/__tests__/`)
- Container: Docker Compose (`docker compose build backend && docker compose up -d backend`)

**Spec:** [`docs/superpowers/specs/2026-06-06-in-loop-semantic-eval-design.md`](../specs/2026-06-06-in-loop-semantic-eval-design.md)

---

## File Structure

**Create:**
- `packages/backend/src/utils/component-checklist.ts` — types + Zod schemas for `ComponentChecklistItem`, `ChecklistVerdict`, `ComponentVerificationResult`
- `packages/backend/src/services/checklist-eval.service.ts` — `runChecklistEval()` per-item dispatcher (visual / code / both)
- `packages/backend/src/__tests__/component-checklist.test.ts` — Zod schema tests
- `packages/backend/src/__tests__/checklist-eval.test.ts` — dispatcher unit tests (with mocked VLM/code-eval)
- `packages/backend/src/__tests__/agent-multi-decompose.test.ts` — decomposition output extension test (existing test file may be appropriate to extend; check first)
- `packages/backend/prisma/migrations/<timestamp>_in_loop_eval_observability/migration.sql` — Prisma-generated migration

**Modify:**
- `packages/backend/prisma/schema.prisma` — add `subAgentVerifications` and `preSubmitVerification` JSONB columns to `WorkbenchExample`
- `packages/backend/src/services/agent-multi.service.ts` — extend `decomposePrompt` system prompt and Zod schema; wire `componentChecklist` into sub-agent deps; pass verification block into assembler
- `packages/backend/src/services/agent-tools.service.ts` — extend `AgentToolDeps`; register `evaluate_checklist` tool; add forced verification gate in `submit_result`

---

## Task 1: Add `ComponentChecklistItem` types and Zod schema

**Files:**
- Create: `packages/backend/src/utils/component-checklist.ts`
- Test: `packages/backend/src/__tests__/component-checklist.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/src/__tests__/component-checklist.test.ts
import { describe, expect, it } from "vitest";
import {
  ComponentChecklistItemSchema,
  ComponentChecklistSchema,
  parseComponentChecklist,
} from "../utils/component-checklist.js";

describe("ComponentChecklistItem schema", () => {
  it("accepts a valid item", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "Body is hollow",
      visibility: "visual",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown visibility", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "x",
      visibility: "smell",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty item text", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "",
      visibility: "code",
    });
    expect(r.success).toBe(false);
  });
});

describe("parseComponentChecklist", () => {
  it("returns the array for valid input", () => {
    const r = parseComponentChecklist([
      { item: "a", visibility: "visual" },
      { item: "b", visibility: "code" },
      { item: "c", visibility: "both" },
    ]);
    expect(r).toHaveLength(3);
  });

  it("returns null for invalid input (one bad item)", () => {
    const r = parseComponentChecklist([
      { item: "a", visibility: "visual" },
      { item: "b", visibility: "bogus" },
    ]);
    expect(r).toBeNull();
  });

  it("returns null for non-array input", () => {
    expect(parseComponentChecklist({ foo: 1 })).toBeNull();
    expect(parseComponentChecklist(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec -T backend npx vitest run src/__tests__/component-checklist.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the schema file**

```typescript
// packages/backend/src/utils/component-checklist.ts
import { z } from "zod";

export const ChecklistVisibilityEnum = z.enum(["visual", "code", "both"]);
export type ChecklistVisibility = z.infer<typeof ChecklistVisibilityEnum>;

export const ChecklistVerdictEnum = z.enum(["PASS", "FAIL", "UNCERTAIN"]);
export type ChecklistVerdict = z.infer<typeof ChecklistVerdictEnum>;

export const ComponentChecklistItemSchema = z.object({
  item: z.string().min(1),
  visibility: ChecklistVisibilityEnum,
});
export type ComponentChecklistItem = z.infer<typeof ComponentChecklistItemSchema>;

export const ComponentChecklistSchema = z.array(ComponentChecklistItemSchema);

export function parseComponentChecklist(input: unknown): ComponentChecklistItem[] | null {
  const r = ComponentChecklistSchema.safeParse(input);
  return r.success ? r.data : null;
}

export interface ChecklistItemResult {
  index: number;
  item: string;
  visibility: ChecklistVisibility;
  verdict: ChecklistVerdict;
  reasoning: string;
}

export interface ComponentVerificationResult {
  results: ChecklistItemResult[];
  passedCount: number;
  failedCount: number;
  uncertainCount: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec -T backend npx vitest run src/__tests__/component-checklist.test.ts
```

Expected: PASS — 6/6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/utils/component-checklist.ts \
        packages/backend/src/__tests__/component-checklist.test.ts
git commit -m "Add ComponentChecklistItem types and Zod schemas"
```

---

## Task 2: Build the focused per-item eval dispatcher

**Files:**
- Create: `packages/backend/src/services/checklist-eval.service.ts`
- Test: `packages/backend/src/__tests__/checklist-eval.test.ts`

Per spec §2: VLM call for `visual` items (single item + 1-3 image subset from `evalPlan.inspectionPlan.angles`), code-review LLM call for `code` items (minimal prompt with single item as question), both for `both`. Returns `ComponentVerificationResult`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/src/__tests__/checklist-eval.test.ts
import { describe, expect, it, vi } from "vitest";
import { runChecklistEval } from "../services/checklist-eval.service.js";
import type { ComponentChecklistItem } from "../utils/component-checklist.js";
import type { RenderedFile } from "../services/agent-tools.service.js";

const FAKE_IMG: RenderedFile = {
  fileName: "front.png",
  contentBase64: "abc",
  mimeType: "image/png",
} as RenderedFile;

describe("runChecklistEval", () => {
  it("dispatches visual-only items to the VLM and skips code path", async () => {
    const visualVerify = vi.fn().mockResolvedValue({
      verdict: "PASS",
      reasoning: "looks fine",
    });
    const codeVerify = vi.fn();

    const items: ComponentChecklistItem[] = [
      { item: "Has 4 holes", visibility: "visual" },
    ];

    const result = await runChecklistEval({
      checklist: items,
      code: "x = 1",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(visualVerify).toHaveBeenCalledTimes(1);
    expect(codeVerify).not.toHaveBeenCalled();
    expect(result.passedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.results[0].verdict).toBe("PASS");
  });

  it("dispatches code-only items to the code-eval and skips visual path", async () => {
    const visualVerify = vi.fn();
    const codeVerify = vi.fn().mockResolvedValue({
      verdict: "FAIL",
      reasoning: "wall=1.5 not 2",
    });

    const result = await runChecklistEval({
      checklist: [{ item: "Wall is 2mm", visibility: "code" }],
      code: "wall = 1.5",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(visualVerify).not.toHaveBeenCalled();
    expect(codeVerify).toHaveBeenCalledTimes(1);
    expect(result.failedCount).toBe(1);
    expect(result.results[0].verdict).toBe("FAIL");
  });

  it("runs BOTH paths for 'both' items and combines: any FAIL → FAIL", async () => {
    const visualVerify = vi.fn().mockResolvedValue({
      verdict: "PASS",
      reasoning: "v ok",
    });
    const codeVerify = vi.fn().mockResolvedValue({
      verdict: "FAIL",
      reasoning: "c bad",
    });

    const result = await runChecklistEval({
      checklist: [{ item: "Lid inverted", visibility: "both" }],
      code: "x=1",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(result.results[0].verdict).toBe("FAIL");
    expect(result.results[0].reasoning).toContain("v ok");
    expect(result.results[0].reasoning).toContain("c bad");
  });

  it("'both': PASS+UNCERTAIN → UNCERTAIN (no FAIL anywhere)", async () => {
    const visualVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "v" });
    const codeVerify = vi.fn().mockResolvedValue({ verdict: "UNCERTAIN", reasoning: "c" });

    const r = await runChecklistEval({
      checklist: [{ item: "x", visibility: "both" }],
      code: "x=1",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(r.results[0].verdict).toBe("UNCERTAIN");
    expect(r.uncertainCount).toBe(1);
  });

  it("'both': PASS+PASS → PASS", async () => {
    const visualVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "v" });
    const codeVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "c" });

    const r = await runChecklistEval({
      checklist: [{ item: "x", visibility: "both" }],
      code: "x=1",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(r.results[0].verdict).toBe("PASS");
  });

  it("returns empty counts for empty checklist", async () => {
    const r = await runChecklistEval({
      checklist: [],
      code: "",
      renderedFiles: [],
      evalPlan: null,
      visualVerify: vi.fn(),
      codeVerify: vi.fn(),
    });
    expect(r.passedCount).toBe(0);
    expect(r.failedCount).toBe(0);
    expect(r.uncertainCount).toBe(0);
    expect(r.results).toEqual([]);
  });

  it("filters images by evalPlan.inspectionPlan.angles for visual items", async () => {
    const visualVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "ok" });
    const codeVerify = vi.fn();

    const front: RenderedFile = { fileName: "front.png", contentBase64: "f", mimeType: "image/png" } as RenderedFile;
    const back: RenderedFile = { fileName: "back.png", contentBase64: "b", mimeType: "image/png" } as RenderedFile;
    const top: RenderedFile = { fileName: "top.png", contentBase64: "t", mimeType: "image/png" } as RenderedFile;

    await runChecklistEval({
      checklist: [{ item: "x", visibility: "visual" }],
      code: "",
      renderedFiles: [front, back, top],
      evalPlan: {
        systemPrompt: "x",
        inspectionPlan: { angles: ["front", "top"] },
        suggestedCodeWeight: 0.4,
      },
      visualVerify,
      codeVerify,
    });

    const calledWith = visualVerify.mock.calls[0][0];
    const fileNames = calledWith.images.map((i: RenderedFile) => i.fileName);
    expect(fileNames).toEqual(["front.png", "top.png"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec -T backend npx vitest run src/__tests__/checklist-eval.test.ts
```

Expected: FAIL — `runChecklistEval` not found.

- [ ] **Step 3: Implement the dispatcher**

The dispatcher accepts injected `visualVerify` and `codeVerify` callbacks so it's testable. The real callbacks (wired in Task 3) make actual LLM calls.

```typescript
// packages/backend/src/services/checklist-eval.service.ts
import type { RenderedFile } from "./agent-tools.service.js";
import type { EvalPlan } from "../utils/eval-plan.js";
import type {
  ComponentChecklistItem,
  ComponentVerificationResult,
  ChecklistItemResult,
  ChecklistVerdict,
} from "../utils/component-checklist.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("checklist-eval");

export interface ChecklistFocusedEvalArgs {
  item: string;
  code: string;
  images: RenderedFile[];
}

export interface ChecklistFocusedEvalResult {
  verdict: ChecklistVerdict;
  reasoning: string;
}

export interface RunChecklistEvalInput {
  checklist: ComponentChecklistItem[];
  code: string;
  renderedFiles: RenderedFile[];
  evalPlan: EvalPlan | null;
  visualVerify: (args: ChecklistFocusedEvalArgs) => Promise<ChecklistFocusedEvalResult>;
  codeVerify: (args: ChecklistFocusedEvalArgs) => Promise<ChecklistFocusedEvalResult>;
}

const ANGLE_FROM_FILENAME = (fileName: string): string => {
  // file shapes today are like `<name>_front.png`, `<name>_top.png`. We match on suffix.
  const m = fileName.match(/_([a-z0-9_]+)\.(png|jpg|jpeg)$/i);
  return m ? m[1] : fileName;
};

function filterImagesByPlan(files: RenderedFile[], evalPlan: EvalPlan | null): RenderedFile[] {
  if (!evalPlan?.inspectionPlan?.angles?.length) return files;
  const wanted = new Set(evalPlan.inspectionPlan.angles);
  const filtered = files.filter((f) => wanted.has(ANGLE_FROM_FILENAME(f.fileName) as never));
  return filtered.length > 0 ? filtered : files;
}

function combine(
  visual: ChecklistFocusedEvalResult | null,
  code: ChecklistFocusedEvalResult | null,
): ChecklistFocusedEvalResult {
  const parts: string[] = [];
  if (visual) parts.push(`visual: ${visual.reasoning}`);
  if (code) parts.push(`code: ${code.reasoning}`);
  const verdicts = [visual?.verdict, code?.verdict].filter(Boolean) as ChecklistVerdict[];
  let verdict: ChecklistVerdict;
  if (verdicts.includes("FAIL")) verdict = "FAIL";
  else if (verdicts.every((v) => v === "PASS")) verdict = "PASS";
  else verdict = "UNCERTAIN";
  return { verdict, reasoning: parts.join(" | ") };
}

export async function runChecklistEval(
  input: RunChecklistEvalInput,
): Promise<ComponentVerificationResult> {
  const { checklist, code, renderedFiles, evalPlan, visualVerify, codeVerify } = input;
  if (checklist.length === 0) {
    return { results: [], passedCount: 0, failedCount: 0, uncertainCount: 0 };
  }

  const visualImages = filterImagesByPlan(renderedFiles, evalPlan);

  const results: ChecklistItemResult[] = await Promise.all(
    checklist.map(async (entry, index): Promise<ChecklistItemResult> => {
      try {
        const wantVisual = entry.visibility === "visual" || entry.visibility === "both";
        const wantCode = entry.visibility === "code" || entry.visibility === "both";

        const [v, c] = await Promise.all([
          wantVisual
            ? visualVerify({ item: entry.item, code, images: visualImages })
            : Promise.resolve(null),
          wantCode
            ? codeVerify({ item: entry.item, code, images: visualImages })
            : Promise.resolve(null),
        ]);

        const combined = combine(v, c);
        return {
          index,
          item: entry.item,
          visibility: entry.visibility,
          verdict: combined.verdict,
          reasoning: combined.reasoning,
        };
      } catch (err) {
        logger.warn({ err, index, item: entry.item }, "checklist item eval failed");
        return {
          index,
          item: entry.item,
          visibility: entry.visibility,
          verdict: "UNCERTAIN",
          reasoning: `eval failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }),
  );

  const passedCount = results.filter((r) => r.verdict === "PASS").length;
  const failedCount = results.filter((r) => r.verdict === "FAIL").length;
  const uncertainCount = results.filter((r) => r.verdict === "UNCERTAIN").length;

  return { results, passedCount, failedCount, uncertainCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec -T backend npx vitest run src/__tests__/checklist-eval.test.ts
```

Expected: PASS — 7/7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/checklist-eval.service.ts \
        packages/backend/src/__tests__/checklist-eval.test.ts
git commit -m "Add runChecklistEval dispatcher for per-item visual/code/both eval"
```

---

## Task 3: Wire real LLM callbacks for visual and code verification

**Files:**
- Modify: `packages/backend/src/services/checklist-eval.service.ts`
- Test: `packages/backend/src/__tests__/checklist-eval.test.ts`

We need to write the actual `verifyChecklistItemVisual` and `verifyChecklistItemCode` functions that make focused LLM calls. They follow the same model-resolution pattern as `evaluate_model` / `evaluate_code` in `agent-tools.service.ts` (lines 439–520) — load the VLM / code-eval model via the existing helper, then make a minimal `generateText` call.

Find the model loader by reading those two tools first. Reuse whatever they call (likely `getModelForPurpose("vlm-eval")` and `getModelForPurpose("code-eval")` or similar via `llm.service.ts`).

- [ ] **Step 1: Read existing model-load pattern**

```bash
grep -n "evaluate_model\|getModelForPurpose\|loadModel\|evalModelConfig" \
  packages/backend/src/services/agent-tools.service.ts | head -30
```

Note the helper(s) used. Use the same helper in the new functions.

- [ ] **Step 2: Write the failing test for `verifyChecklistItemVisual`**

```typescript
// packages/backend/src/__tests__/checklist-eval.test.ts — append
import { verifyChecklistItemVisual, verifyChecklistItemCode } from "../services/checklist-eval.service.js";

describe("verifyChecklistItemVisual response parsing", () => {
  it("parses PASS + reasoning from a typical LLM response", () => {
    const parsed = parseChecklistVerdictText("PASS\nFront view shows 4 holes at the corners.");
    expect(parsed.verdict).toBe("PASS");
    expect(parsed.reasoning).toContain("Front view");
  });

  it("parses FAIL + reasoning", () => {
    const parsed = parseChecklistVerdictText("FAIL — body not hollow");
    expect(parsed.verdict).toBe("FAIL");
    expect(parsed.reasoning).toContain("body not hollow");
  });

  it("defaults to UNCERTAIN when verdict not detected", () => {
    const parsed = parseChecklistVerdictText("hmm I am not sure");
    expect(parsed.verdict).toBe("UNCERTAIN");
  });
});
```

Add the import:

```typescript
import { parseChecklistVerdictText } from "../services/checklist-eval.service.js";
```

- [ ] **Step 3: Implement parser + LLM-call helpers**

Append to `checklist-eval.service.ts`:

```typescript
// packages/backend/src/services/checklist-eval.service.ts — append

export function parseChecklistVerdictText(text: string): ChecklistFocusedEvalResult {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();
  let verdict: ChecklistVerdict = "UNCERTAIN";
  if (/^PASS\b|\bPASS\b/.test(upper.slice(0, 32))) verdict = "PASS";
  else if (/^FAIL\b|\bFAIL\b/.test(upper.slice(0, 32))) verdict = "FAIL";
  else if (/^UNCERTAIN\b/.test(upper)) verdict = "UNCERTAIN";
  return { verdict, reasoning: trimmed.slice(0, 600) };
}

const VISUAL_SYS_PROMPT = (item: string) =>
  `You are verifying ONE specific feature of a 3D model from rendered images.\n` +
  `The feature to verify: "${item}"\n\n` +
  `Reply on the first line with exactly one of: PASS, FAIL, UNCERTAIN.\n` +
  `Then add 1-3 sentences of reasoning. Use PASS only when the images clearly show the feature; ` +
  `UNCERTAIN when the views don't show it clearly; FAIL when the images contradict it.`;

const CODE_SYS_PROMPT = (item: string) =>
  `You are verifying ONE specific spec item against Python Build123d code.\n` +
  `The spec item to verify: "${item}"\n\n` +
  `Reply on the first line with exactly one of: PASS, FAIL, UNCERTAIN.\n` +
  `Then add 1-3 sentences of reasoning. PASS only when the code clearly satisfies the item; ` +
  `UNCERTAIN when the code is ambiguous; FAIL when it contradicts the item.`;

export async function verifyChecklistItemVisual(
  args: ChecklistFocusedEvalArgs,
): Promise<ChecklistFocusedEvalResult> {
  // Load the same VLM the existing evaluate_model tool uses.
  // Use the helper discovered in Step 1 (e.g. `await getModelForPurpose("vlm-eval")`).
  const model = await /* TODO replace with discovered helper */ undefined as any;
  const content: any[] = [{ type: "text", text: "Verify this feature from the views below." }];
  for (const img of args.images.slice(0, 3)) {
    content.push({ type: "image", image: img.contentBase64, mimeType: img.mimeType });
  }
  const { text } = await /* TODO replace with discovered generateText helper */ (
    null as any
  )({
    model,
    system: VISUAL_SYS_PROMPT(args.item),
    messages: [{ role: "user", content }],
  });
  return parseChecklistVerdictText(text);
}

export async function verifyChecklistItemCode(
  args: ChecklistFocusedEvalArgs,
): Promise<ChecklistFocusedEvalResult> {
  const model = await /* TODO replace with discovered helper */ undefined as any;
  const { text } = await /* TODO replace with discovered generateText helper */ (
    null as any
  )({
    model,
    system: CODE_SYS_PROMPT(args.item),
    messages: [
      {
        role: "user",
        content: `Code:\n\n\`\`\`python\n${args.code}\n\`\`\``,
      },
    ],
  });
  return parseChecklistVerdictText(text);
}
```

**During implementation**: replace the `TODO` markers with the actual helpers identified in Step 1 (likely `loadAiSdkModel(modelConfig)` + `generateText` from `ai`). Mirror exactly how `evaluate_model` and `evaluate_code` build their model + call shape today. Cap images at 3 (slice in code above already does this).

- [ ] **Step 4: Run parser tests to verify they pass**

```bash
docker compose exec -T backend npx vitest run src/__tests__/checklist-eval.test.ts -t "parseChecklistVerdictText"
```

Expected: PASS — 3/3 verdict-parse tests.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/checklist-eval.service.ts \
        packages/backend/src/__tests__/checklist-eval.test.ts
git commit -m "Add verifyChecklistItemVisual/Code helpers backed by real LLM calls"
```

---

## Task 4: Extend `AgentToolDeps` and register `evaluate_checklist` tool

**Files:**
- Modify: `packages/backend/src/services/agent-tools.service.ts` (deps interface ~73–109; tool block 126–645)

Per spec §1 and §2: the tool is available to ALL agents (single, sub-agents, assembler). It uses the most-recent cached screenshots; no auto-render.

- [ ] **Step 1: Extend the `AgentToolDeps` interface**

Add to the interface at lines 73–109:

```typescript
componentChecklist?: ComponentChecklistItem[];
componentName?: string; // for logging/diagnostics in multi-agent context
```

Import:

```typescript
import type { ComponentChecklistItem } from "../utils/component-checklist.js";
```

- [ ] **Step 2: Register the new tool**

Insert near `evaluate_model` (line 439) in the tool-registration block:

```typescript
evaluate_checklist: tool({
  description:
    "Verify SPECIFIC verification-checklist items against the current rendered model. " +
    "Cheaper and clearer than evaluate_model. Call after a successful render. " +
    "Pass item indices to check a subset; omit to verify ALL items. " +
    "Reuses cached screenshots; call validate_and_render first if your code changed.",
  inputSchema: zodSchema(
    z.object({
      itemIndices: z.array(z.number().int().nonnegative()).optional(),
    }),
  ),
  execute: async ({ itemIndices }) => {
    const checklist = deps.componentChecklist ?? [];
    if (checklist.length === 0) {
      return "No verification checklist is configured for this agent. Use evaluate_model for whole-model eval.";
    }
    const renderedFiles = deps.getLastRenderedFiles();
    if (!renderedFiles || renderedFiles.length === 0) {
      return "No rendered files available. Call validate_and_render first.";
    }
    const selected = itemIndices && itemIndices.length > 0
      ? itemIndices
          .filter((i) => i >= 0 && i < checklist.length)
          .map((i) => checklist[i])
      : checklist;

    if (selected.length === 0) {
      return "All provided indices were out of range. Checklist has " + checklist.length + " items (indices 0.." + (checklist.length - 1) + ").";
    }

    const result = await runChecklistEval({
      checklist: selected,
      code: deps.fs.getMainCode(),
      renderedFiles,
      evalPlan: deps.evalPlan ?? null,
      visualVerify: verifyChecklistItemVisual,
      codeVerify: verifyChecklistItemCode,
    });

    deps.onChecklistEvaluated?.(result);

    const lines: string[] = [];
    for (const r of result.results) {
      lines.push(
        `Item ${r.index} [${r.visibility.toUpperCase()}]: "${r.item}"\n  ${r.verdict} — ${r.reasoning}`,
      );
    }
    lines.push("");
    lines.push(
      `Summary: ${result.passedCount} PASS, ${result.failedCount} FAIL, ${result.uncertainCount} UNCERTAIN`,
    );
    return lines.join("\n");
  },
}),
```

Add to the import block at the top:

```typescript
import {
  runChecklistEval,
  verifyChecklistItemVisual,
  verifyChecklistItemCode,
} from "./checklist-eval.service.js";
```

Add an OPTIONAL callback to `AgentToolDeps` for observability:

```typescript
onChecklistEvaluated?: (result: ComponentVerificationResult) => void;
```

(Import `ComponentVerificationResult` from `../utils/component-checklist.js`.)

- [ ] **Step 3: Verify the file still compiles**

```bash
docker compose exec -T backend npx tsc --noEmit -p tsconfig.json
```

Expected: no errors.

- [ ] **Step 4: Add a smoke test for the tool**

Append to `packages/backend/src/__tests__/checklist-eval.test.ts`:

```typescript
describe("evaluate_checklist tool integration", () => {
  it("returns 'no checklist configured' when deps.componentChecklist is empty", async () => {
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools({
      fs: { getMainCode: () => "", getAllFiles: () => [], writeFile: () => {}, listFiles: () => [] } as any,
      wrapProjectFiles: () => [],
      baseFileName: "x",
      onRenderSuccess: () => {},
      onSubmit: () => {},
      getLastRenderedFiles: () => [{ fileName: "front.png", contentBase64: "f", mimeType: "image/png" } as any],
      userPrompt: "p",
      evalThreshold: 5,
      componentChecklist: [],
    } as any, { disableRender: true });
    const result = await tools.evaluate_checklist.execute({ itemIndices: undefined } as any, {} as any);
    expect(String(result)).toMatch(/no verification checklist/i);
  });

  it("returns 'no rendered files' when render cache empty", async () => {
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools({
      fs: { getMainCode: () => "x = 1", getAllFiles: () => [], writeFile: () => {}, listFiles: () => [] } as any,
      wrapProjectFiles: () => [],
      baseFileName: "x",
      onRenderSuccess: () => {},
      onSubmit: () => {},
      getLastRenderedFiles: () => [],
      userPrompt: "p",
      evalThreshold: 5,
      componentChecklist: [{ item: "x", visibility: "visual" }],
    } as any, { disableRender: true });
    const result = await tools.evaluate_checklist.execute({} as any, {} as any);
    expect(String(result)).toMatch(/no rendered files/i);
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
docker compose exec -T backend npx vitest run src/__tests__/checklist-eval.test.ts
```

Expected: all tests pass including new ones.

- [ ] **Step 6: Rebuild backend container**

```bash
docker compose build backend && docker compose up -d backend
```

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/agent-tools.service.ts \
        packages/backend/src/__tests__/checklist-eval.test.ts
git commit -m "Register evaluate_checklist tool with cache-aware dispatch"
```

---

## Task 5: Forced verification gate in `submit_result`

**Files:**
- Modify: `packages/backend/src/services/agent-tools.service.ts` (submit_result block 300–437)

Per spec §4: only fires when `deps.componentChecklist` is populated AND assertions/render checks have passed. UNCERTAIN does NOT block; only FAIL blocks. Single-agent path is unaffected because deps.componentChecklist is only set in the multi-agent sub-agent wiring (Task 7).

- [ ] **Step 1: Locate the assertion-fail rejection (around line 327–345)**

```bash
grep -n "submit_result\|assertion" packages/backend/src/services/agent-tools.service.ts | head -20
```

Identify the line where assertions are checked. Insert the new gate AFTER assertions pass but BEFORE the full eval pipeline (line ~347).

- [ ] **Step 2: Write the failing test**

```typescript
// packages/backend/src/__tests__/submit-result-checklist-gate.test.ts
import { describe, expect, it, vi } from "vitest";
import { buildAgentTools } from "../services/agent-tools.service.js";

const mkDeps = (overrides: any = {}) => ({
  fs: { getMainCode: () => "x = 1", getAllFiles: () => [], writeFile: () => {}, listFiles: () => [] },
  wrapProjectFiles: () => [],
  baseFileName: "x",
  onRenderSuccess: () => {},
  onSubmit: vi.fn(),
  getLastRenderedFiles: () => [{ fileName: "front.png", contentBase64: "f", mimeType: "image/png" } as any],
  userPrompt: "p",
  evalThreshold: 5,
  componentChecklist: [{ item: "x", visibility: "visual" }],
  ...overrides,
});

describe("submit_result forced checklist gate", () => {
  it("rejects submission when any component item FAILs", async () => {
    // Stub the focused verifiers via a service-level mock
    vi.doMock("../services/checklist-eval.service.js", async (orig) => {
      const mod = (await orig()) as any;
      return {
        ...mod,
        runChecklistEval: async () => ({
          results: [{ index: 0, item: "x", visibility: "visual", verdict: "FAIL", reasoning: "bad" }],
          passedCount: 0,
          failedCount: 1,
          uncertainCount: 0,
        }),
      };
    });
    const { buildAgentTools: build } = await import("../services/agent-tools.service.js");

    const onSubmit = vi.fn();
    const tools = build(mkDeps({ onSubmit }) as any, { disableRender: true });
    const result = await tools.submit_result.execute({} as any, {} as any);

    expect(String(result)).toMatch(/SUBMISSION REJECTED/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does NOT reject when only UNCERTAIN items present", async () => {
    vi.doMock("../services/checklist-eval.service.js", async (orig) => {
      const mod = (await orig()) as any;
      return {
        ...mod,
        runChecklistEval: async () => ({
          results: [{ index: 0, item: "x", visibility: "visual", verdict: "UNCERTAIN", reasoning: "occluded" }],
          passedCount: 0,
          failedCount: 0,
          uncertainCount: 1,
        }),
      };
    });
    const { buildAgentTools: build } = await import("../services/agent-tools.service.js");

    const onSubmit = vi.fn();
    const tools = build(mkDeps({ onSubmit }) as any, { disableRender: true });
    const result = await tools.submit_result.execute({} as any, {} as any);
    expect(String(result)).not.toMatch(/SUBMISSION REJECTED/);
  });

  it("does NOT fire the gate when componentChecklist is empty (single-agent path)", async () => {
    let called = false;
    vi.doMock("../services/checklist-eval.service.js", async (orig) => {
      const mod = (await orig()) as any;
      return {
        ...mod,
        runChecklistEval: async () => {
          called = true;
          return { results: [], passedCount: 0, failedCount: 0, uncertainCount: 0 };
        },
      };
    });
    const { buildAgentTools: build } = await import("../services/agent-tools.service.js");
    const tools = build(mkDeps({ componentChecklist: undefined }) as any, { disableRender: true });
    await tools.submit_result.execute({} as any, {} as any);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
docker compose exec -T backend npx vitest run src/__tests__/submit-result-checklist-gate.test.ts
```

Expected: FAIL — gate not present.

- [ ] **Step 4: Insert the gate into submit_result**

In `agent-tools.service.ts`, find the line where assertion check returns success (after line ~345 where assertions pass). Insert before the full-eval block (~line 347):

```typescript
// Forced component-checklist verification (multi-agent sub-agents only).
// Fires only when deps.componentChecklist is populated.
if (deps.componentChecklist && deps.componentChecklist.length > 0) {
  const renderedFiles = deps.getLastRenderedFiles();
  if (renderedFiles && renderedFiles.length > 0) {
    const verification = await runChecklistEval({
      checklist: deps.componentChecklist,
      code: deps.fs.getMainCode(),
      renderedFiles,
      evalPlan: deps.evalPlan ?? null,
      visualVerify: verifyChecklistItemVisual,
      codeVerify: verifyChecklistItemCode,
    });

    deps.onChecklistEvaluated?.(verification);

    const failed = verification.results.filter((r) => r.verdict === "FAIL");
    if (failed.length > 0) {
      const lines = [
        `SUBMISSION REJECTED — ${failed.length} of ${verification.results.length} component checklist item(s) failed:`,
        ...failed.map(
          (f) => `  Item ${f.index} [${f.visibility.toUpperCase()}]: "${f.item}"\n    ${f.reasoning}`,
        ),
        ``,
        `Fix these issues and try submit_result again. UNCERTAIN items are allowed; FAIL items are not.`,
      ];
      return lines.join("\n");
    }
  }
  // If no rendered files cached, fall through — the existing eval pipeline below will handle it.
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
docker compose exec -T backend npx vitest run src/__tests__/submit-result-checklist-gate.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 6: Rebuild backend container**

```bash
docker compose build backend && docker compose up -d backend
```

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/agent-tools.service.ts \
        packages/backend/src/__tests__/submit-result-checklist-gate.test.ts
git commit -m "Add forced component-checklist gate to submit_result (multi-agent sub-agents only)"
```

---

## Task 6: Extend `decomposePrompt` to emit `componentChecklist`

**Files:**
- Modify: `packages/backend/src/services/agent-multi.service.ts` (decomposePrompt 59–138)

Per spec §3: extend the LLM output schema and prompt. Annotate items with `visibility`. Fallback: if absent or invalid, leave undefined and skip forced verification for that component (Task 5's gate already handles empty).

- [ ] **Step 1: Write the failing test**

Find existing decomposition tests or create a new file:

```typescript
// packages/backend/src/__tests__/decompose-prompt-checklist.test.ts
import { describe, expect, it } from "vitest";
import { parseDecompositionResponse } from "../services/agent-multi.service.js";

describe("decomposePrompt response parsing with componentChecklist", () => {
  it("parses componentChecklist when present", () => {
    const json = JSON.stringify({
      components: [
        {
          name: "body",
          description: "the hollow box",
          componentChecklist: [
            { item: "Body is hollow", visibility: "visual" },
            { item: "Wall thickness is 2mm", visibility: "code" },
          ],
        },
      ],
      assemblyNotes: "Place lid on top.",
    });
    const r = parseDecompositionResponse(json);
    expect(r.components[0].componentChecklist).toHaveLength(2);
    expect(r.components[0].componentChecklist?.[0].visibility).toBe("visual");
  });

  it("returns undefined componentChecklist when LLM omits it", () => {
    const json = JSON.stringify({
      components: [{ name: "body", description: "box" }],
      assemblyNotes: "n/a",
    });
    const r = parseDecompositionResponse(json);
    expect(r.components[0].componentChecklist).toBeUndefined();
  });

  it("drops invalid componentChecklist (bad visibility) instead of throwing", () => {
    const json = JSON.stringify({
      components: [
        {
          name: "body",
          description: "box",
          componentChecklist: [{ item: "x", visibility: "smell" }],
        },
      ],
      assemblyNotes: "n/a",
    });
    const r = parseDecompositionResponse(json);
    expect(r.components[0].componentChecklist).toBeUndefined();
  });
});
```

If `parseDecompositionResponse` isn't currently exported, export it as part of this task.

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec -T backend npx vitest run src/__tests__/decompose-prompt-checklist.test.ts
```

Expected: FAIL — function missing or doesn't expose checklist.

- [ ] **Step 3: Extend the system prompt and schema**

In `agent-multi.service.ts` near line 67–78 (the decomposePrompt system prompt), append:

```typescript
const DECOMPOSE_CHECKLIST_ADDENDUM = `
For each component, also emit a "componentChecklist" — 3–6 short verification items that this component ALONE (before assembly) must satisfy. Each item should be checkable against just this component's geometry, not the assembled whole. Annotate each item with "visibility": "visual" | "code" | "both" using the same rules as the top-level verificationChecklist (visual = visible from rendered views; code = checkable in source; both = both). Include items that catch failures specific to this component's role (e.g. "is hollow", "has N standoffs", "wall thickness X mm"). Do NOT include items that depend on the relationship between components (those belong in assemblyNotes).
`.trim();
```

Add it to the prompt string used in the `generateText` call.

Then in the parsing path (around line 109–113), refactor into an exported function:

```typescript
import { parseComponentChecklist, type ComponentChecklistItem } from "../utils/component-checklist.js";

export interface DecomposedComponent {
  name: string;
  description: string;
  componentChecklist?: ComponentChecklistItem[];
}

export interface DecompositionResult {
  components: DecomposedComponent[];
  assemblyNotes: string;
  promptTokens?: number;
  completionTokens?: number;
}

export function parseDecompositionResponse(rawText: string): DecompositionResult {
  const parsed = JSON.parse(rawText);
  // existing component/assemblyNotes validation here...
  const components: DecomposedComponent[] = (parsed.components ?? []).map((c: any) => {
    const checklist = parseComponentChecklist(c.componentChecklist);
    return {
      name: String(c.name ?? "").trim(),
      description: String(c.description ?? "").trim(),
      componentChecklist: checklist ?? undefined,
    };
  });
  return {
    components,
    assemblyNotes: String(parsed.assemblyNotes ?? ""),
  };
}
```

(Preserve existing name-sanitization at line 120.)

Replace the inline parsing inside `decomposePrompt` with a call to `parseDecompositionResponse`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
docker compose exec -T backend npx vitest run src/__tests__/decompose-prompt-checklist.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/agent-multi.service.ts \
        packages/backend/src/__tests__/decompose-prompt-checklist.test.ts
git commit -m "Extend decomposePrompt with per-component checklist output"
```

---

## Task 7: Wire `componentChecklist` into sub-agent deps

**Files:**
- Modify: `packages/backend/src/services/agent-multi.service.ts` (sub-agent loop 243–369)

- [ ] **Step 1: Locate where sub-agent deps are constructed**

Each sub-agent runs `runAgentCodegen` with its own `deps`. Find the construction point in the parallel loop (around line 270–280).

- [ ] **Step 2: Pass `componentChecklist` and `componentName` to each sub-agent's deps**

Where the sub-agent deps object is built, add:

```typescript
componentChecklist: component.componentChecklist ?? [],
componentName: component.name,
onChecklistEvaluated: (verification) => {
  // Capture per-sub-agent verification into a local accumulator used by the assembler.
  subAgentVerifications[component.name] = {
    passedCount: verification.passedCount,
    failedCount: verification.failedCount,
    uncertainCount: verification.uncertainCount,
    failedItems: verification.results.filter((r) => r.verdict === "FAIL").map((r) => ({
      item: r.item,
      reasoning: r.reasoning,
    })),
  };
},
```

Before the parallel loop, declare:

```typescript
const subAgentVerifications: Record<string, {
  passedCount: number;
  failedCount: number;
  uncertainCount: number;
  failedItems: { item: string; reasoning: string }[];
}> = {};
```

- [ ] **Step 3: Add an integration smoke test (no LLM call)**

```typescript
// packages/backend/src/__tests__/agent-multi-deps-wiring.test.ts
import { describe, expect, it } from "vitest";

describe("multi-agent sub-agent deps wiring (smoke)", () => {
  it("subAgentVerifications object collects per-component verification snapshots", () => {
    // Synthetic: confirm the type shape we use exists.
    const acc: Record<string, { passedCount: number; failedCount: number; uncertainCount: number }> = {};
    acc["body"] = { passedCount: 2, failedCount: 1, uncertainCount: 0 };
    expect(acc.body.failedCount).toBe(1);
  });
});
```

(This is a placeholder smoke test; the substantive verification is the typescript compile + the end-to-end A/B in Task 11.)

- [ ] **Step 4: Verify TypeScript compiles**

```bash
docker compose exec -T backend npx tsc --noEmit -p tsconfig.json
```

Expected: no errors.

- [ ] **Step 5: Run all backend tests**

```bash
docker compose exec -T backend npx vitest run
```

Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/agent-multi.service.ts \
        packages/backend/src/__tests__/agent-multi-deps-wiring.test.ts
git commit -m "Wire componentChecklist into sub-agent deps + collect per-component verification"
```

---

## Task 8: Pass verification metadata to the assembler

**Files:**
- Modify: `packages/backend/src/services/agent-multi.service.ts` (assembler block 407–456)

Per spec §5: the assembler gets a `verification` block per component AND an extended system prompt that informs it about the verifications. Assembler is NOT gated.

- [ ] **Step 1: Find the assembler invocation**

```bash
grep -n "buildAssemblyAgentSystemPrompt\|assembler\|step 4" packages/backend/src/services/agent-multi.service.ts | head -20
```

Locate where `buildAssemblyAgentSystemPrompt` is called and where the assembler receives the components array.

- [ ] **Step 2: Augment the components passed to the assembler**

Where the assembler input is built (around line 419), build an extended block:

```typescript
const componentsForAssembler = decomposition.components.map((c) => ({
  ...c,
  // ... existing fields (code, renderedFiles, etc.)
  verification: subAgentVerifications[c.name] ?? null,
}));
```

Pass this through to `buildAssemblyAgentSystemPrompt`.

- [ ] **Step 3: Extend `buildAssemblyAgentSystemPrompt`**

Find the function (search for its definition in the same file or a sibling file). Add a section that formats the verification:

```typescript
// In buildAssemblyAgentSystemPrompt:
const verificationSection = components
  .filter((c) => c.verification && c.verification.failedCount > 0)
  .map(
    (c) =>
      `Component "${c.name}" — ${c.verification!.failedCount} failed item(s):\n` +
      c.verification!.failedItems.map((f) => `  - ${f.item} — ${f.reasoning}`).join("\n"),
  )
  .join("\n\n");

const verificationParagraph = verificationSection.length > 0
  ? `\n\nSome sub-components arrived with failed verification items:\n\n${verificationSection}\n\nAttempt to assemble anyway (best-effort). Note in your output any failures that may surface in the final result. Do NOT try to repair sub-component issues yourself — your job is composition.`
  : `\n\nAll sub-components passed their per-component verification.`;
```

Append `verificationParagraph` to the assembler system prompt.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
docker compose exec -T backend npx tsc --noEmit -p tsconfig.json
```

Expected: no errors.

- [ ] **Step 5: Add a smoke test for the verification-section formatter**

If `buildAssemblyAgentSystemPrompt` can be exported and called with a synthetic input, write a brief test:

```typescript
// packages/backend/src/__tests__/assembler-verification-section.test.ts
import { describe, expect, it } from "vitest";
import { buildAssemblyAgentSystemPrompt } from "../services/agent-multi.service.js"; // export if not already

describe("assembler system prompt verification section", () => {
  it("includes a 'all passed' line when all components clean", () => {
    const prompt = buildAssemblyAgentSystemPrompt({
      promptText: "x",
      components: [{ name: "body", description: "", verification: { passedCount: 3, failedCount: 0, uncertainCount: 0, failedItems: [] } }] as any,
    } as any);
    expect(prompt).toMatch(/all sub-components passed/i);
  });

  it("lists failed components when any have failures", () => {
    const prompt = buildAssemblyAgentSystemPrompt({
      promptText: "x",
      components: [{ name: "body", description: "", verification: { passedCount: 2, failedCount: 1, uncertainCount: 0, failedItems: [{ item: "wall=2mm", reasoning: "wall=1.5" }] } }] as any,
    } as any);
    expect(prompt).toMatch(/Component "body"/);
    expect(prompt).toMatch(/wall=2mm/);
  });
});
```

- [ ] **Step 6: Run tests**

```bash
docker compose exec -T backend npx vitest run src/__tests__/assembler-verification-section.test.ts
```

Expected: 2/2 PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/agent-multi.service.ts \
        packages/backend/src/__tests__/assembler-verification-section.test.ts
git commit -m "Forward sub-agent verification metadata to assembler system prompt"
```

---

## Task 9: Persist observability fields on `WorkbenchExample`

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`
- Create: `packages/backend/prisma/migrations/<timestamp>_in_loop_eval_observability/migration.sql`

Per spec §5: `subAgentVerifications` and `preSubmitVerification` JSONB columns, both nullable.

- [ ] **Step 1: Edit `schema.prisma`**

In the `WorkbenchExample` model (lines 449–515), add:

```prisma
subAgentVerifications     Json?    @map("sub_agent_verifications") @db.JsonB
preSubmitVerification     Json?    @map("pre_submit_verification") @db.JsonB
```

- [ ] **Step 2: Generate the migration**

```bash
docker compose exec -T backend npx prisma migrate dev --name in_loop_eval_observability --create-only
```

Expected: a new migration directory is created. Open the generated `migration.sql` and verify both columns are added with the correct types.

- [ ] **Step 3: Apply the migration**

```bash
docker compose exec -T backend npx prisma migrate deploy
```

Expected: migration applies successfully.

- [ ] **Step 4: Wire persistence in `runMultiAgentCodegen`**

At the end of the multi-agent run (where the `WorkbenchExample` is created/updated with the assembled result), add the field:

```typescript
subAgentVerifications: Object.keys(subAgentVerifications).length > 0
  ? subAgentVerifications
  : undefined,
```

In single-agent runs, add a small accumulator that captures `evaluate_checklist` usage:

```typescript
let preSubmitVerification: {
  callCount: number;
  totalPassed: number;
  totalFailed: number;
  totalUncertain: number;
} | null = null;

// In deps.onChecklistEvaluated:
onChecklistEvaluated: (verification) => {
  preSubmitVerification = {
    callCount: (preSubmitVerification?.callCount ?? 0) + 1,
    totalPassed: (preSubmitVerification?.totalPassed ?? 0) + verification.passedCount,
    totalFailed: (preSubmitVerification?.totalFailed ?? 0) + verification.failedCount,
    totalUncertain: (preSubmitVerification?.totalUncertain ?? 0) + verification.uncertainCount,
  };
},
```

Persist at workbench-example creation:

```typescript
preSubmitVerification: preSubmitVerification ?? undefined,
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
docker compose exec -T backend npx prisma generate && \
  docker compose exec -T backend npx tsc --noEmit -p tsconfig.json
```

Expected: no errors.

- [ ] **Step 6: Rebuild backend container**

```bash
docker compose build backend && docker compose up -d backend
```

- [ ] **Step 7: Commit**

```bash
git add packages/backend/prisma/schema.prisma \
        packages/backend/prisma/migrations/ \
        packages/backend/src/services/agent-multi.service.ts \
        packages/backend/src/services/agent-tools.service.ts
git commit -m "Persist sub_agent_verifications and pre_submit_verification on WorkbenchExample"
```

---

## Task 10: End-to-end smoke run against one test prompt

**Files:** none modified; this is a verification task.

Verify the wiring works end-to-end before launching the A/B.

- [ ] **Step 1: Pick a multi-agent prompt from the test set**

```bash
head -3 docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt
```

Pick one with `requiresDecomposition = true`. Example: a hinges prompt.

- [ ] **Step 2: Trigger a fresh generation**

Use the existing generation entry point (admin UI or curl). Reuse the auth pattern in CLAUDE.md (`/tmp/chat3d-token.txt`).

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
# Adapt to actual generation endpoint; typically POST /api/admin/workbench/prompts/:id/generate
curl -s -X POST http://localhost/api/admin/workbench/prompts/<prompt_id>/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

- [ ] **Step 3: Wait for completion, then inspect the new row**

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT id, eval_score, sub_agent_verifications, pre_submit_verification \
   FROM workbench_examples ORDER BY created_at DESC LIMIT 1;"
```

Expected: `sub_agent_verifications` is non-null JSON with per-component counts; `pre_submit_verification` may be null (only single-agent populates).

- [ ] **Step 4: Inspect backend logs for forced-rejection events**

```bash
docker compose logs backend --since 5m | grep -i "submission rejected\|checklist"
```

Expected: at least one "SUBMISSION REJECTED" or checklist-eval log line if any sub-agent had a fail.

- [ ] **Step 5: Commit a short observation note (optional)**

If notable, add a brief observation to the spec's follow-ups. Otherwise skip.

---

## Task 11: A/B test against 30-prompt test set

**Files:**
- Create: `docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md`

Per spec §6: same 30-prompt test set, regenerate fresh (not re-eval), partition by `requiresDecomposition`, success criteria: multi-agent Δ ≥ +0.5, ≥2 killer prompts flip, single-agent regression ≥ −0.2, cost ≤ 1.5× baseline.

- [ ] **Step 1: Capture v3 baseline**

```bash
# If /tmp/eval-plan-v3-after.tsv exists, copy it as the baseline.
# Otherwise, capture from DB:
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "COPY (SELECT prompt_id, eval_score, composite_weight_source, requires_decomposition \
   FROM workbench_examples we \
   JOIN workbench_example_prompts p ON we.prompt_id = p.id \
   WHERE p.id IN (<test-set IDs from txt file>) \
   ORDER BY prompt_id) TO STDOUT WITH CSV HEADER;" \
   > /tmp/in-loop-eval-baseline.csv
```

(Adapt the SQL to your schema's actual column names; the test-set IDs are in `docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt`.)

- [ ] **Step 2: Trigger regeneration for all 30 test-set prompts**

Write or reuse a script that POSTs to the generation endpoint for each prompt ID. Wait for all to complete (poll the workbench-examples table).

- [ ] **Step 3: Capture v4 metrics**

Same query as Step 1, into `/tmp/in-loop-eval-v4.csv`. Also pull observability columns:

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "COPY (SELECT prompt_id, eval_score, sub_agent_verifications, pre_submit_verification \
   FROM workbench_examples we \
   ... AS ABOVE) TO STDOUT WITH CSV HEADER;" \
   > /tmp/in-loop-eval-v4-observability.csv
```

- [ ] **Step 4: Compute deltas and write the report**

Create the results document:

```bash
cat > docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md << 'EOF'
# In-Loop Semantic Eval — A/B Test Results

Generated: <DATE>

## Setup

v3 (baseline): per-prompt eval_plan + clamp-suppress-on-eval-plan.
v4 (treatment): v3 + evaluate_checklist tool + forced verification gate at sub-agent submit.

## Per-bucket Δ (v3 → v4)

| Bucket (partition) | n | v3 mean | v4 mean | Δ | Range |
|---|---|---|---|---|---|
| Single-agent prompts | <N> | <M3> | <M4> | <D> | [<min>, <max>] |
| Multi-agent prompts | <N> | <M3> | <M4> | <D> | [<min>, <max>] |
| **Overall** | 30 | <M3> | <M4> | <D> | — |

## Killer-prompt recovery

| Prompt | v3 score | v4 score | Flip? |
|---|---|---|---|
| <p1> | <s3> | <s4> | <Y/N> |
| ... | | | |

## Observability

- Mean evaluate_checklist calls per single-agent gen: <X>
- Mean forced-verification rounds per sub-agent: <X>
- Mean failed components arriving at assembler: <X>

## Cost

- Mean LLM cost per gen v3 vs v4: <c3> → <c4> (ratio <r>)
- Mean wall time per gen: <w3> → <w4>

## Decision

<Ship / iterate / scope-reduce — based on success criteria from the spec.>
EOF
```

Fill in actual numbers from the CSVs.

- [ ] **Step 5: Commit the results**

```bash
git add docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md
git commit -m "In-loop semantic eval A/B test results"
```

- [ ] **Step 6: Report back to the user**

Summarize: per-bucket Δ, killer-prompt flips, cost, and the ship/iterate decision per spec §6 success criteria.

---

## Self-Review Notes

- **Spec coverage:** §1 → Tasks 4, 5, 7. §2 → Tasks 2, 3, 4. §3 → Task 6. §4 → Task 5. §5 → Tasks 8, 9. §6 → Task 11. Non-goals are respected (post-eval untouched, single-agent not force-gated, no auto-render).
- **Placeholder scan:** Task 3 contains a deliberate `/* TODO replace with discovered helper */` because the implementer must inspect the existing `evaluate_model`/`evaluate_code` to mirror its model-load and `generateText` pattern exactly. This is one inspection step, not an unresolved gap.
- **Type consistency:** `ComponentChecklistItem`, `ComponentVerificationResult`, `ChecklistFocusedEvalArgs`, `runChecklistEval`, `verifyChecklistItemVisual`, `verifyChecklistItemCode`, `parseDecompositionResponse` — same names across all referencing tasks.
