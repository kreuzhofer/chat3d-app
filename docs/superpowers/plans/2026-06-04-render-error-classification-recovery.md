# Render-Error Classification Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the existing build123d render-error classification on every workbench example, backfill historical UNKNOWN rows from `agentConversation`, and expose a per-category render-error histogram in the admin UI.

**Architecture:** A single helper `extractAndClassifyLastRenderError(agentConversation)` runs both at write time (in `workbench-codegen.service.ts` around line 800) and during a one-shot backfill script. The helper reads the last `validate_and_render` tool-result message, parses the raw error after `"Error: "`, and runs the existing `classifyRenderError()` over it. The result lands in two new columns on `workbench_examples`: an enum-constrained `render_error_category` plus a free-text `render_error_detail` (the regex-captured value, e.g. the undefined name from `NameError`).

**Tech Stack:** TypeScript, Prisma (Postgres), Express, vitest. Frontend: React + Vite + semantic-ui-react.

**Source spec:** `docs/superpowers/specs/2026-06-04-render-error-classification-recovery-design.md`

---

## File Structure

**Backend — new:**
- `packages/backend/prisma/migrations/<timestamp>_render_error_classification/migration.sql` — schema migration
- `packages/backend/src/utils/render-error-extraction.ts` — pure helper: extract raw error from agent conversation, classify it
- `packages/backend/src/__tests__/render-error-extraction.test.ts` — vitest tests for the helper
- `packages/backend/scripts/backfill-render-errors.ts` — one-shot backfill CLI
- `packages/backend/src/__tests__/backfill-render-errors.test.ts` — vitest tests for the backfill
- `packages/backend/src/services/render-error-analytics.service.ts` — histogram + drill-down queries
- `packages/backend/src/__tests__/render-error-analytics.test.ts` — vitest tests
- `packages/backend/src/routes/admin/render-errors.routes.ts` — new sub-router for `/api/admin/render-errors/examples`
- `packages/backend/src/__tests__/render-errors.routes.test.ts` — integration tests via supertest

**Backend — modified:**
- `packages/backend/prisma/schema.prisma` — add `renderErrorCategory` + `renderErrorDetail` fields to `WorkbenchExample`
- `packages/backend/src/services/workbench-persist.service.ts` — extend `insertExample` payload + upsert
- `packages/backend/src/services/workbench-codegen.service.ts` — around line 800, call the helper, derive category/detail
- `packages/backend/src/services/data-quality.service.ts` — add `renderErrorCategoryHistogram` per category
- `packages/backend/src/routes/admin.routes.ts` — mount the new sub-router

**Shared — modified:**
- `packages/shared/src/types.ts` — add the two new fields to `WorkbenchExample` shape; re-export `RenderErrorCategory` literal-union from shared

**Frontend — new:**
- `packages/frontend/src/components/admin/RenderErrorsTab.tsx` — histogram table + drill-down drawer
- `packages/frontend/src/api/renderErrors.ts` — typed fetch wrapper for the two endpoints

**Frontend — modified:**
- Wherever admin tabs are registered (likely `packages/frontend/src/pages/Admin.tsx` or similar) — add the new tab to the navigation

Each file has one responsibility. The helper, the persistence change, the backfill, the analytics service, the route, and the tab are independent enough to land in separate commits without cross-cutting churn.

---

## Task 1: Schema migration

**Files:**
- Create: `packages/backend/prisma/migrations/20260605000000_render_error_classification/migration.sql`
- Modify: `packages/backend/prisma/schema.prisma`

- [ ] **Step 1: Write the migration SQL**

Create `packages/backend/prisma/migrations/20260605000000_render_error_classification/migration.sql`:

```sql
ALTER TABLE "workbench_examples"
  ADD COLUMN "render_error_category" TEXT NULL,
  ADD COLUMN "render_error_detail" TEXT NULL;

ALTER TABLE "workbench_examples"
  ADD CONSTRAINT "workbench_examples_render_error_category_check"
  CHECK (
    "render_error_category" IS NULL OR
    "render_error_category" IN (
      'infrastructure', 'api_misuse', 'geometry',
      'type_error', 'kernel_error', 'syntax', 'unknown'
    )
  );

CREATE INDEX "idx_workbench_examples_render_error_category"
  ON "workbench_examples" ("render_error_category")
  WHERE "render_error_category" IS NOT NULL;

COMMENT ON COLUMN "workbench_examples"."render_error_category" IS
  'Classified render-error category from utils/render-errors.ts. Null on successful renders.';
COMMENT ON COLUMN "workbench_examples"."render_error_detail" IS
  'Regex-captured detail from the error message (e.g., the undefined name for NameError). Null when no capture group matched.';
```

- [ ] **Step 2: Update schema.prisma**

Edit `packages/backend/prisma/schema.prisma`, locate the `WorkbenchExample` model, and add these two fields just after `renderError`:

```prisma
  renderErrorCategory   String?  @map("render_error_category") @db.Text
  renderErrorDetail     String?  @map("render_error_detail") @db.Text
```

- [ ] **Step 3: Apply migration locally**

Run:
```bash
cd packages/backend
npm run db:migrate
```

Expected output: `Applied migration: 20260605000000_render_error_classification`

- [ ] **Step 4: Verify columns exist**

Run:
```bash
docker compose exec postgres psql -U postgres -d chat3d -c "\d workbench_examples" | grep render_error
```

Expected: three rows — `render_error`, `render_error_category`, `render_error_detail`.

- [ ] **Step 5: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/prisma/migrations/20260605000000_render_error_classification \
        packages/backend/prisma/schema.prisma
git commit -m "Add render_error_category and render_error_detail to workbench_examples"
```

---

## Task 2: Extraction helper — write failing test

**Files:**
- Create: `packages/backend/src/__tests__/render-error-extraction.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/render-error-extraction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractAndClassifyLastRenderError } from "../utils/render-error-extraction.js";
import { RenderErrorCategory } from "../utils/render-errors.js";

describe("extractAndClassifyLastRenderError", () => {
  it("returns null for empty/missing conversation", () => {
    expect(extractAndClassifyLastRenderError(null)).toBeNull();
    expect(extractAndClassifyLastRenderError(undefined)).toBeNull();
    expect(extractAndClassifyLastRenderError([])).toBeNull();
  });

  it("returns null when no render tool result is present", () => {
    const convo = [
      { role: "user", content: "build a box" },
      { role: "assistant", content: "ok" },
    ];
    expect(extractAndClassifyLastRenderError(convo)).toBeNull();
  });

  it("extracts and classifies an API_MISUSE failure from validate_and_render result", () => {
    const convo = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: "validate_and_render",
            output: "Validation PASSED but Render FAILED.\n\nError: NameError: name 'BadName' is not defined\n\nPlease fix the code and validate again before re-rendering.",
          },
        ],
      },
    ];
    const result = extractAndClassifyLastRenderError(convo);
    expect(result?.category).toBe(RenderErrorCategory.API_MISUSE);
    expect(result?.capturedDetail).toBe("BadName");
    expect(result?.rawMessage).toContain("NameError: name 'BadName' is not defined");
  });

  it("extracts the LAST render failure when multiple are present", () => {
    const convo = [
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolName: "validate_and_render",
          output: "Render FAILED.\n\nError: TypeError: argument expected int\n\nPlease fix",
        }],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolName: "validate_and_render",
          output: "Render FAILED.\n\nError: BRep_API: command not done\n\nPlease fix",
        }],
      },
    ];
    const result = extractAndClassifyLastRenderError(convo);
    expect(result?.category).toBe(RenderErrorCategory.KERNEL_ERROR);
  });

  it("handles render_project tool name in addition to validate_and_render", () => {
    const convo = [{
      role: "tool",
      content: [{
        type: "tool-result",
        toolName: "render_project",
        output: "Render FAILED.\n\nError: ValueError: No objects to create\n\nPlease fix",
      }],
    }];
    const result = extractAndClassifyLastRenderError(convo);
    expect(result?.category).toBe(RenderErrorCategory.GEOMETRY);
  });

  it("returns null when last render tool result is a success", () => {
    const convo = [{
      role: "tool",
      content: [{
        type: "tool-result",
        toolName: "validate_and_render",
        output: "Validation PASSED.\nRender SUCCEEDED. Generated 3 file(s): out.stl, out.step, out.3mf",
      }],
    }];
    expect(extractAndClassifyLastRenderError(convo)).toBeNull();
  });

  it("returns UNKNOWN classification when raw message format is unexpected", () => {
    const convo = [{
      role: "tool",
      content: [{
        type: "tool-result",
        toolName: "validate_and_render",
        output: "Render FAILED.\n\nError: some completely unrecognized backend hiccup\n\nPlease fix",
      }],
    }];
    const result = extractAndClassifyLastRenderError(convo);
    expect(result?.category).toBe(RenderErrorCategory.UNKNOWN);
  });

  it("survives malformed conversation input (non-array, non-object)", () => {
    expect(extractAndClassifyLastRenderError("garbage")).toBeNull();
    expect(extractAndClassifyLastRenderError(42)).toBeNull();
    expect(extractAndClassifyLastRenderError({ role: "user" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/render-error-extraction.test.ts
```

Expected: FAIL — `Cannot find module '../utils/render-error-extraction.js'`.

---

## Task 3: Extraction helper — minimal implementation

**Files:**
- Create: `packages/backend/src/utils/render-error-extraction.ts`

- [ ] **Step 1: Write the minimal implementation**

Create `packages/backend/src/utils/render-error-extraction.ts`:

```ts
/**
 * Extracts the last render-tool failure from an agent conversation history
 * and classifies it via render-errors.ts.
 *
 * The agent's `validate_and_render` and `render_project` tools return strings
 * like:
 *   "Render FAILED.\n\nError: <raw build123d error>\n\nPlease fix the code..."
 * This helper finds the most recent such message, parses the raw error, and
 * runs classifyRenderError() over it.
 *
 * Used at:
 * 1. workbench persistence time (workbench-codegen.service.ts:~800)
 * 2. the backfill script (scripts/backfill-render-errors.ts)
 *
 * Returns null when:
 *   - the conversation has no tool messages
 *   - the last render-tool message indicates success
 *   - the conversation shape is unrecognized
 */
import {
  classifyRenderError,
  type ClassifiedRenderError,
} from "./render-errors.js";

const RENDER_TOOL_NAMES = new Set(["validate_and_render", "render_project"]);
const FAIL_MARKER = "Render FAILED";
const ERROR_PREFIX_RE = /Error:\s*([\s\S]*?)(?:\n\nPlease fix|\n\nThis means|\n\nThis is a service|$)/;

interface ToolResultContent {
  type: string;
  toolName?: string;
  output?: unknown;
}

interface ConvoMessage {
  role?: string;
  content?: unknown;
}

function isToolResultContent(x: unknown): x is ToolResultContent {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as { type?: unknown }).type === "tool-result"
  );
}

function extractToolOutputString(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const text = output
      .map(part => (typeof part === "object" && part !== null && "text" in part ? (part as { text?: unknown }).text : null))
      .filter((t): t is string => typeof t === "string")
      .join("\n");
    return text || null;
  }
  if (typeof output === "object" && output !== null && "text" in output) {
    const text = (output as { text?: unknown }).text;
    return typeof text === "string" ? text : null;
  }
  return null;
}

export function extractAndClassifyLastRenderError(
  agentConversation: unknown,
): ClassifiedRenderError | null {
  if (!Array.isArray(agentConversation)) return null;

  // Walk newest-first; the last render-tool result is the one we want.
  for (let i = agentConversation.length - 1; i >= 0; i--) {
    const msg = agentConversation[i] as ConvoMessage;
    if (!msg || typeof msg !== "object") continue;
    if (msg.role !== "tool") continue;

    const contents = Array.isArray(msg.content) ? msg.content : [msg.content];
    for (const part of contents) {
      if (!isToolResultContent(part)) continue;
      if (!part.toolName || !RENDER_TOOL_NAMES.has(part.toolName)) continue;

      const outputText = extractToolOutputString(part.output);
      if (!outputText) continue;

      // Success case → no error to classify
      if (!outputText.includes(FAIL_MARKER)) return null;

      // Extract raw error message between "Error: " and the next blank line.
      const match = outputText.match(ERROR_PREFIX_RE);
      const rawMessage = match ? match[1].trim() : outputText;
      return classifyRenderError(rawMessage);
    }
  }

  return null;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/render-error-extraction.test.ts
```

Expected: 8 passing tests.

- [ ] **Step 3: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/utils/render-error-extraction.ts \
        packages/backend/src/__tests__/render-error-extraction.test.ts
git commit -m "Add extractAndClassifyLastRenderError helper for agent conversations"
```

---

## Task 4: Extend `insertExample` to persist the new fields

**Files:**
- Modify: `packages/backend/src/services/workbench-persist.service.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/workbench-persist-render-error.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../db/prisma.js";
import { insertExample } from "../services/workbench-persist.service.js";

describe("insertExample render error classification", () => {
  let categoryId: string;
  let promptId: string;
  let id: string;

  beforeEach(async () => {
    const cat = await prisma.workbenchCategory.create({ data: { name: `render-err-test-${Date.now()}`, description: "", complexity: 1 } });
    categoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({
      data: { categoryId, index: 1, prompt: "test" },
    });
    promptId = prompt.id;
    id = crypto.randomUUID();
  });

  it("persists renderErrorCategory and renderErrorDetail when provided", async () => {
    await insertExample({
      id, promptId, iteration: 1, code: "fail",
      renderStatus: "error",
      renderError: "NameError: name 'BadName' is not defined",
      renderErrorCategory: "api_misuse",
      renderErrorDetail: "BadName",
      stlPath: null, stepPath: null, threemfPath: null,
      screenshotFront: null, screenshotBack: null, screenshotLeft: null, screenshotRight: null,
      screenshotTop: null, screenshotBottom: null, screenshotOrtho45: null,
      screenshotOrtho45Bottom: null, screenshotIso: null, screenshotIsoBack: null,
      evalScore: null, evalIssues: null, evalSuggestions: null, evalChecklistResults: null,
      approvalStatus: "pending",
      llmModel: "test-model", vlmModel: null,
      promptTokens: 0, completionTokens: 0,
    });

    const row = await prisma.workbenchExample.findUnique({ where: { id } });
    expect(row?.renderErrorCategory).toBe("api_misuse");
    expect(row?.renderErrorDetail).toBe("BadName");
    expect(row?.renderError).toBe("NameError: name 'BadName' is not defined");
  });

  it("leaves both fields null on successful renders", async () => {
    await insertExample({
      id, promptId, iteration: 1, code: "ok",
      renderStatus: "success",
      renderError: null,
      // renderErrorCategory + renderErrorDetail omitted on purpose
      stlPath: null, stepPath: null, threemfPath: null,
      screenshotFront: null, screenshotBack: null, screenshotLeft: null, screenshotRight: null,
      screenshotTop: null, screenshotBottom: null, screenshotOrtho45: null,
      screenshotOrtho45Bottom: null, screenshotIso: null, screenshotIsoBack: null,
      evalScore: 8, evalIssues: null, evalSuggestions: null, evalChecklistResults: null,
      approvalStatus: "auto_approved",
      llmModel: "test-model", vlmModel: null,
      promptTokens: 0, completionTokens: 0,
    });

    const row = await prisma.workbenchExample.findUnique({ where: { id } });
    expect(row?.renderErrorCategory).toBeNull();
    expect(row?.renderErrorDetail).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/workbench-persist-render-error.test.ts
```

Expected: FAIL — Prisma rejects unknown fields `renderErrorCategory` / `renderErrorDetail` (the `insertExample` signature has not been extended yet).

- [ ] **Step 3: Extend the insertExample signature + upsert payload**

Edit `packages/backend/src/services/workbench-persist.service.ts`:

In the `data` parameter type, add the two optional fields (anywhere before the closing `}`):
```ts
  renderErrorCategory?: string | null;
  renderErrorDetail?: string | null;
```

In the `create` block of the upsert (immediately after `renderError: data.renderError,`):
```ts
      renderErrorCategory: data.renderErrorCategory ?? null,
      renderErrorDetail: data.renderErrorDetail ?? null,
```

Find the `update` block of the same upsert and add the same two lines (immediately after `renderError: data.renderError,`):
```ts
      renderErrorCategory: data.renderErrorCategory ?? null,
      renderErrorDetail: data.renderErrorDetail ?? null,
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/workbench-persist-render-error.test.ts
```

Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/services/workbench-persist.service.ts \
        packages/backend/src/__tests__/workbench-persist-render-error.test.ts
git commit -m "Persist renderErrorCategory and renderErrorDetail in insertExample"
```

---

## Task 5: Wire classification into the workbench codegen write path

**Files:**
- Modify: `packages/backend/src/services/workbench-codegen.service.ts` (the line-800 region and the matching call to `insertExample`)

- [ ] **Step 1: Locate the persistence block**

Open `packages/backend/src/services/workbench-codegen.service.ts`. Find the block around line 799–846 — it computes `renderStatus`, `renderError`, then calls `await insertExample({...})`.

- [ ] **Step 2: Add the import**

Near the other `./` imports at the top of the file, add:
```ts
import { extractAndClassifyLastRenderError } from "../utils/render-error-extraction.js";
```

- [ ] **Step 3: Replace the lossy literal**

Replace the existing line:
```ts
  const renderError = currentResult.renderSuccess ? null : "Agent codegen failed to render";
```
with:
```ts
  const classified = currentResult.renderSuccess
    ? null
    : extractAndClassifyLastRenderError(currentResult.conversationHistory ?? agResult?.conversationHistory ?? null);
  const renderError = currentResult.renderSuccess
    ? null
    : (classified?.rawMessage ?? "Agent codegen failed to render");
  const renderErrorCategory = classified?.category ?? null;
  const renderErrorDetail = classified?.capturedDetail ?? null;
```

- [ ] **Step 4: Pass the new fields to `insertExample`**

In the same file, locate the `await insertExample({...})` call. Immediately after the existing line `renderStatus, renderError,` add:
```ts
    renderErrorCategory, renderErrorDetail,
```

- [ ] **Step 5: Run the full backend test suite**

Run:
```bash
cd packages/backend
npm test -- --run --reporter=verbose 2>&1 | tail -40
```

Expected: every previously-passing test still passes; the new persistence tests added in Task 4 still pass. No new failures introduced.

- [ ] **Step 6: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/services/workbench-codegen.service.ts
git commit -m "Persist classified render error at workbench codegen write time"
```

---

## Task 6: Backfill script — write failing test

**Files:**
- Create: `packages/backend/src/__tests__/backfill-render-errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/backfill-render-errors.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../db/prisma.js";
import { runBackfill, type BackfillReport } from "../../scripts/backfill-render-errors.js";

describe("backfill-render-errors", () => {
  let categoryId: string;
  let promptId: string;

  beforeEach(async () => {
    const cat = await prisma.workbenchCategory.create({ data: { name: `backfill-test-${Date.now()}`, description: "", complexity: 1 } });
    categoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({
      data: { categoryId, index: 1, prompt: "x" },
    });
    promptId = prompt.id;
  });

  function makeConvoWithRenderFailure(rawError: string): unknown {
    return [{
      role: "tool",
      content: [{
        type: "tool-result",
        toolName: "validate_and_render",
        output: `Render FAILED.\n\nError: ${rawError}\n\nPlease fix the code`,
      }],
    }];
  }

  it("dry-run reports what would change but does not write", async () => {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "error",
        renderError: "Agent codegen failed to render",
        agentConversation: makeConvoWithRenderFailure("NameError: name 'Foo' is not defined") as object,
        approvalStatus: "pending",
      },
    });

    const report = await runBackfill({ dryRun: true, categoryId });
    expect(report.recovered_from_conversation).toBe(1);
    expect(report.still_unknown).toBe(0);

    const after = await prisma.workbenchExample.findUnique({ where: { id: ex.id } });
    expect(after?.renderErrorCategory).toBeNull();
  });

  it("commit mode writes the classification and replaces the lossy raw message", async () => {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "error",
        renderError: "Agent codegen failed to render",
        agentConversation: makeConvoWithRenderFailure("NameError: name 'Foo' is not defined") as object,
        approvalStatus: "pending",
      },
    });

    await runBackfill({ dryRun: false, categoryId });

    const after = await prisma.workbenchExample.findUnique({ where: { id: ex.id } });
    expect(after?.renderErrorCategory).toBe("api_misuse");
    expect(after?.renderErrorDetail).toBe("Foo");
    expect(after?.renderError).toContain("NameError: name 'Foo' is not defined");
  });

  it("falls back to the row's own renderError when conversation has nothing useful", async () => {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "error",
        renderError: "ValueError: No objects to create",
        agentConversation: null,
        approvalStatus: "pending",
      },
    });

    await runBackfill({ dryRun: false, categoryId });

    const after = await prisma.workbenchExample.findUnique({ where: { id: ex.id } });
    expect(after?.renderErrorCategory).toBe("geometry");
  });

  it("marks rows as unknown when neither source yields a usable error", async () => {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "error",
        renderError: "Agent codegen failed to render",
        agentConversation: null,
        approvalStatus: "pending",
      },
    });

    const report = await runBackfill({ dryRun: false, categoryId });
    expect(report.still_unknown).toBe(1);

    const after = await prisma.workbenchExample.findUnique({ where: { id: ex.id } });
    expect(after?.renderErrorCategory).toBe("unknown");
  });

  it("skips rows that already have a category", async () => {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "error",
        renderError: "ValueError: bad",
        renderErrorCategory: "geometry",
        agentConversation: null,
        approvalStatus: "pending",
      },
    });

    const report = await runBackfill({ dryRun: false, categoryId });
    expect(report.recovered_from_conversation + report.recovered_from_render_error + report.still_unknown).toBe(0);

    const after = await prisma.workbenchExample.findUnique({ where: { id: ex.id } });
    expect(after?.renderErrorCategory).toBe("geometry"); // unchanged
  });

  it("ignores successful renders", async () => {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "success",
        renderError: null,
        approvalStatus: "auto_approved",
      },
    });

    const report = await runBackfill({ dryRun: false, categoryId });
    expect(report.recovered_from_conversation + report.recovered_from_render_error + report.still_unknown).toBe(0);

    const after = await prisma.workbenchExample.findUnique({ where: { id: ex.id } });
    expect(after?.renderErrorCategory).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/backfill-render-errors.test.ts
```

Expected: FAIL — `Cannot find module '../../scripts/backfill-render-errors.js'`.

---

## Task 7: Backfill script — minimal implementation

**Files:**
- Create: `packages/backend/scripts/backfill-render-errors.ts`

- [ ] **Step 1: Write the script**

Create `packages/backend/scripts/backfill-render-errors.ts`:

```ts
/**
 * One-shot backfill: re-classify historical render errors that were persisted
 * as the lossy literal "Agent codegen failed to render".
 *
 * Sources, in priority order:
 *   1. agentConversation — parse the last validate_and_render/render_project failure
 *   2. The row's own render_error — if it's NOT the lossy literal
 *
 * Outputs counts per workbench category. Idempotent: skips rows where
 * render_error_category is already set.
 *
 * CLI:
 *   npx tsx scripts/backfill-render-errors.ts --dry-run
 *   npx tsx scripts/backfill-render-errors.ts --commit
 *   npx tsx scripts/backfill-render-errors.ts --commit --category <uuid>
 *   npx tsx scripts/backfill-render-errors.ts --dry-run --limit 50
 */
import { prisma } from "../src/db/prisma.js";
import { createLogger } from "../src/utils/logger.js";
import { extractAndClassifyLastRenderError } from "../src/utils/render-error-extraction.js";
import { classifyRenderError, RenderErrorCategory } from "../src/utils/render-errors.js";

const logger = createLogger("backfill-render-errors");
const LOSSY_LITERAL = "Agent codegen failed to render";

export interface BackfillOptions {
  dryRun: boolean;
  categoryId?: string;
  limit?: number;
}

export interface BackfillReport {
  recovered_from_conversation: number;
  recovered_from_render_error: number;
  still_unknown: number;
  parse_errors: number;
  per_category: Record<string, number>; // category id → updated count
  by_classification: Record<string, number>; // RenderErrorCategory → count
}

export async function runBackfill(opts: BackfillOptions): Promise<BackfillReport> {
  const report: BackfillReport = {
    recovered_from_conversation: 0,
    recovered_from_render_error: 0,
    still_unknown: 0,
    parse_errors: 0,
    per_category: {},
    by_classification: {},
  };

  const where = {
    renderStatus: "error",
    renderErrorCategory: null as null,
    ...(opts.categoryId
      ? { prompt: { categoryId: opts.categoryId } }
      : {}),
  };

  const rows = await prisma.workbenchExample.findMany({
    where,
    select: {
      id: true,
      renderError: true,
      agentConversation: true,
      prompt: { select: { categoryId: true } },
    },
    take: opts.limit,
  });

  logger.info({ candidates: rows.length, opts }, "backfill candidates loaded");

  for (const row of rows) {
    let classified;
    let source: "conversation" | "render_error" | "none" = "none";

    try {
      classified = extractAndClassifyLastRenderError(row.agentConversation);
      if (classified) source = "conversation";
    } catch (err) {
      logger.warn({ rowId: row.id, err: err instanceof Error ? err.message : String(err) }, "agentConversation parse error");
      report.parse_errors++;
    }

    if (!classified && row.renderError && row.renderError !== LOSSY_LITERAL) {
      classified = classifyRenderError(row.renderError);
      source = "render_error";
    }

    if (!classified) {
      report.still_unknown++;
      if (!opts.dryRun) {
        await prisma.workbenchExample.update({
          where: { id: row.id },
          data: { renderErrorCategory: RenderErrorCategory.UNKNOWN },
        });
      }
      const catKey = row.prompt.categoryId;
      report.per_category[catKey] = (report.per_category[catKey] ?? 0) + 1;
      report.by_classification[RenderErrorCategory.UNKNOWN] =
        (report.by_classification[RenderErrorCategory.UNKNOWN] ?? 0) + 1;
      continue;
    }

    if (source === "conversation") report.recovered_from_conversation++;
    else if (source === "render_error") report.recovered_from_render_error++;

    const catKey = row.prompt.categoryId;
    report.per_category[catKey] = (report.per_category[catKey] ?? 0) + 1;
    report.by_classification[classified.category] =
      (report.by_classification[classified.category] ?? 0) + 1;

    if (!opts.dryRun) {
      await prisma.workbenchExample.update({
        where: { id: row.id },
        data: {
          renderErrorCategory: classified.category,
          renderErrorDetail: classified.capturedDetail,
          // Replace lossy literal with the recovered raw message; otherwise leave existing renderError alone.
          renderError: row.renderError === LOSSY_LITERAL ? classified.rawMessage : row.renderError,
        },
      });
    }
  }

  logger.info({ report }, "backfill complete");
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--commit");
  const categoryArgIdx = args.indexOf("--category");
  const categoryId = categoryArgIdx >= 0 ? args[categoryArgIdx + 1] : undefined;
  const limitArgIdx = args.indexOf("--limit");
  const limit = limitArgIdx >= 0 ? parseInt(args[limitArgIdx + 1], 10) : undefined;

  const report = await runBackfill({ dryRun, categoryId, limit });
  console.log("\n=== Backfill report ===");
  console.log(JSON.stringify(report, null, 2));
  if (dryRun) {
    console.log("\n(dry-run — re-run with --commit to apply)");
  }
  await prisma.$disconnect();
}

// Run main only when executed directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/backfill-render-errors.test.ts
```

Expected: 6 passing tests.

- [ ] **Step 3: Smoke-test the CLI in dry-run on PCB Cases**

PCB Cases category id: `7f274d66-f415-4d1f-8db2-aff361ebd2a2` (verify with `psql` if unsure).

Run:
```bash
cd packages/backend
npx tsx scripts/backfill-render-errors.ts --dry-run --category 7f274d66-f415-4d1f-8db2-aff361ebd2a2 --limit 20
```

Expected: prints a `BackfillReport` JSON with `recovered_from_conversation > 0` (most likely), `still_unknown` typically small. No DB writes happen.

- [ ] **Step 4: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/scripts/backfill-render-errors.ts \
        packages/backend/src/__tests__/backfill-render-errors.test.ts
git commit -m "Add render-error backfill script with dry-run + per-category modes"
```

---

## Task 8: Render-error analytics service — write failing test

**Files:**
- Create: `packages/backend/src/__tests__/render-error-analytics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/render-error-analytics.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../db/prisma.js";
import {
  getRenderErrorHistogramForCategory,
  listExamplesByRenderErrorCategory,
  type RenderErrorHistogram,
} from "../services/render-error-analytics.service.js";

describe("render-error analytics", () => {
  let categoryId: string;
  let promptId: string;

  async function makeExample(opts: { renderErrorCategory?: string | null; renderStatus?: string }): Promise<string> {
    const ex = await prisma.workbenchExample.create({
      data: {
        promptId,
        iteration: 1,
        code: "x",
        renderStatus: opts.renderStatus ?? "error",
        renderError: "x",
        renderErrorCategory: opts.renderErrorCategory ?? null,
        approvalStatus: "pending",
      },
    });
    return ex.id;
  }

  beforeEach(async () => {
    const cat = await prisma.workbenchCategory.create({ data: { name: `analytics-test-${Date.now()}`, description: "", complexity: 1 } });
    categoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({
      data: { categoryId, index: 1, prompt: "y" },
    });
    promptId = prompt.id;
  });

  it("histogram returns zero counts when no failed examples exist", async () => {
    await makeExample({ renderStatus: "success", renderErrorCategory: null });
    const histogram = await getRenderErrorHistogramForCategory(categoryId);
    expect(histogram.kernel_error).toBe(0);
    expect(histogram.geometry).toBe(0);
    expect(histogram.unknown).toBe(0);
  });

  it("histogram groups by render_error_category and ignores successes", async () => {
    await makeExample({ renderErrorCategory: "kernel_error" });
    await makeExample({ renderErrorCategory: "kernel_error" });
    await makeExample({ renderErrorCategory: "geometry" });
    await makeExample({ renderStatus: "success", renderErrorCategory: null });
    await makeExample({ renderStatus: "error", renderErrorCategory: null }); // unclassified — should be excluded

    const histogram = await getRenderErrorHistogramForCategory(categoryId);
    expect(histogram.kernel_error).toBe(2);
    expect(histogram.geometry).toBe(1);
    expect(histogram.unknown).toBe(0);
  });

  it("drill-down lists examples filtered by error category", async () => {
    const id1 = await makeExample({ renderErrorCategory: "kernel_error" });
    await makeExample({ renderErrorCategory: "geometry" });

    const result = await listExamplesByRenderErrorCategory({
      categoryId,
      errorCategory: "kernel_error",
      limit: 10,
    });
    expect(result.total).toBe(1);
    expect(result.examples[0].id).toBe(id1);
    expect(result.examples[0].renderErrorCategory).toBe("kernel_error");
  });

  it("drill-down paginates", async () => {
    for (let i = 0; i < 5; i++) {
      await makeExample({ renderErrorCategory: "geometry" });
    }
    const page = await listExamplesByRenderErrorCategory({
      categoryId,
      errorCategory: "geometry",
      limit: 3,
    });
    expect(page.examples.length).toBe(3);
    expect(page.total).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/render-error-analytics.test.ts
```

Expected: FAIL — `Cannot find module '../services/render-error-analytics.service.js'`.

---

## Task 9: Render-error analytics service — minimal implementation

**Files:**
- Create: `packages/backend/src/services/render-error-analytics.service.ts`

- [ ] **Step 1: Write the service**

Create `packages/backend/src/services/render-error-analytics.service.ts`:

```ts
/**
 * Per-category render-error analytics. Powers the Render Errors admin tab
 * and the /api/admin/data-quality histogram extension.
 */
import { prisma } from "../db/prisma.js";
import { RenderErrorCategory } from "../utils/render-errors.js";

export type RenderErrorHistogram = Record<
  | "infrastructure" | "api_misuse" | "geometry" | "type_error"
  | "kernel_error" | "syntax" | "unknown",
  number
>;

const EMPTY_HISTOGRAM = (): RenderErrorHistogram => ({
  infrastructure: 0,
  api_misuse: 0,
  geometry: 0,
  type_error: 0,
  kernel_error: 0,
  syntax: 0,
  unknown: 0,
});

export async function getRenderErrorHistogramForCategory(
  categoryId: string,
): Promise<RenderErrorHistogram> {
  const rows = await prisma.$queryRaw<Array<{ category: string | null; count: bigint }>>`
    SELECT we.render_error_category AS category, COUNT(*)::bigint AS count
    FROM workbench_examples we
    JOIN workbench_example_prompts wep ON wep.id = we.prompt_id
    WHERE wep.category_id = ${categoryId}::uuid
      AND we.render_status = 'error'
      AND we.render_error_category IS NOT NULL
    GROUP BY we.render_error_category
  `;

  const result = EMPTY_HISTOGRAM();
  for (const r of rows) {
    if (r.category && r.category in result) {
      (result as Record<string, number>)[r.category] = Number(r.count);
    }
  }
  return result;
}

export interface RenderErrorExample {
  id: string;
  promptId: string;
  promptText: string;
  renderError: string | null;
  renderErrorDetail: string | null;
  renderErrorCategory: string;
  createdAt: Date;
}

export interface ListExamplesParams {
  categoryId: string;
  errorCategory: string;
  limit: number;
  offset?: number;
}

export async function listExamplesByRenderErrorCategory(
  params: ListExamplesParams,
): Promise<{ examples: RenderErrorExample[]; total: number }> {
  const { categoryId, errorCategory, limit, offset = 0 } = params;

  const validCategories = Object.values(RenderErrorCategory) as string[];
  if (!validCategories.includes(errorCategory)) {
    throw new Error(`Invalid errorCategory: ${errorCategory}`);
  }

  const [examples, total] = await Promise.all([
    prisma.workbenchExample.findMany({
      where: {
        renderStatus: "error",
        renderErrorCategory: errorCategory,
        prompt: { categoryId },
      },
      select: {
        id: true,
        promptId: true,
        renderError: true,
        renderErrorDetail: true,
        renderErrorCategory: true,
        createdAt: true,
        prompt: { select: { prompt: true } },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
      skip: offset,
    }),
    prisma.workbenchExample.count({
      where: {
        renderStatus: "error",
        renderErrorCategory: errorCategory,
        prompt: { categoryId },
      },
    }),
  ]);

  return {
    examples: examples.map((e) => ({
      id: e.id,
      promptId: e.promptId,
      promptText: e.prompt.prompt,
      renderError: e.renderError,
      renderErrorDetail: e.renderErrorDetail,
      renderErrorCategory: e.renderErrorCategory ?? "unknown",
      createdAt: e.createdAt,
    })),
    total,
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/render-error-analytics.test.ts
```

Expected: 4 passing tests.

- [ ] **Step 3: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/services/render-error-analytics.service.ts \
        packages/backend/src/__tests__/render-error-analytics.test.ts
git commit -m "Add render-error analytics service (histogram + drill-down)"
```

---

## Task 10: Extend `/api/admin/data-quality` with the histogram

**Files:**
- Modify: `packages/backend/src/services/data-quality.service.ts`

- [ ] **Step 1: Locate the per-category stats assembly**

Open `packages/backend/src/services/data-quality.service.ts`. Find where each category's `stats` object is assembled (it's the object returned in the array element with keys like `promptsWithExamples`, `evalSourceComposite`, etc.).

- [ ] **Step 2: Import the histogram helper**

Add to the top imports:
```ts
import { getRenderErrorHistogramForCategory, type RenderErrorHistogram } from "./render-error-analytics.service.js";
```

- [ ] **Step 3: Fetch and merge the histogram per category**

Inside the loop/map over categories, await the histogram call and include it in the stats payload:
```ts
const renderErrorCategoryHistogram = await getRenderErrorHistogramForCategory(category.id);
// ... in the returned stats object:
stats: {
  // ... existing fields unchanged ...
  renderErrorCategoryHistogram,
},
```

- [ ] **Step 4: Add an integration test**

Create `packages/backend/src/__tests__/data-quality-render-error.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../db/prisma.js";
import { computeDataQuality } from "../services/data-quality.service.js";

describe("data-quality includes renderErrorCategoryHistogram", () => {
  let categoryId: string;
  let promptId: string;

  beforeEach(async () => {
    const cat = await prisma.workbenchCategory.create({ data: { name: `dq-test-${Date.now()}`, description: "", complexity: 1 } });
    categoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({
      data: { categoryId, index: 1, prompt: "z" },
    });
    promptId = prompt.id;
    await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "error", renderError: "x",
        renderErrorCategory: "kernel_error",
        approvalStatus: "pending",
      },
    });
  });

  it("returns per-category histogram with the kernel_error count", async () => {
    const result = await computeDataQuality();
    const ours = (result.categories ?? result).find?.((c: { categoryId?: string; id?: string }) => (c.categoryId ?? c.id) === categoryId);
    expect(ours).toBeDefined();
    expect(ours.stats.renderErrorCategoryHistogram.kernel_error).toBe(1);
    expect(ours.stats.renderErrorCategoryHistogram.geometry).toBe(0);
  });
});
```

The exact shape (`result.categories` vs flat array, `categoryId` vs `id`) depends on the existing `computeDataQuality()` API — the test is written defensively. If the actual API shape diverges from both attempts, adjust the destructuring to match.

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/data-quality-render-error.test.ts
```

Expected: 1 passing test.

- [ ] **Step 6: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/services/data-quality.service.ts \
        packages/backend/src/__tests__/data-quality-render-error.test.ts
git commit -m "Include render-error category histogram in data-quality response"
```

---

## Task 11: New `/api/admin/render-errors/examples` endpoint

**Files:**
- Create: `packages/backend/src/routes/admin/render-errors.routes.ts`
- Modify: `packages/backend/src/routes/admin.routes.ts` (mount the sub-router)
- Create: `packages/backend/src/__tests__/render-errors.routes.test.ts`

- [ ] **Step 1: Write the failing route test**

Create `packages/backend/src/__tests__/render-errors.routes.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js"; // or wherever the express app factory lives
import { prisma } from "../db/prisma.js";
import { getAdminTestToken } from "./helpers/auth.js"; // existing helper used by other admin tests

describe("GET /api/admin/render-errors/examples", () => {
  let categoryId: string;
  let promptId: string;
  let token: string;

  beforeEach(async () => {
    token = await getAdminTestToken();
    const cat = await prisma.workbenchCategory.create({ data: { name: `route-test-${Date.now()}`, description: "", complexity: 1 } });
    categoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({
      data: { categoryId, index: 1, prompt: "p" },
    });
    promptId = prompt.id;
    await prisma.workbenchExample.create({
      data: {
        promptId, iteration: 1, code: "x",
        renderStatus: "error",
        renderError: "BRep_API: command not done",
        renderErrorCategory: "kernel_error",
        approvalStatus: "pending",
      },
    });
  });

  it("returns examples filtered by error category", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/admin/render-errors/examples")
      .query({ categoryId, errorCategory: "kernel_error", limit: 10 })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.examples[0].renderErrorCategory).toBe("kernel_error");
  });

  it("rejects invalid error category", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/admin/render-errors/examples")
      .query({ categoryId, errorCategory: "not_a_real_category" })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("requires auth", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/admin/render-errors/examples")
      .query({ categoryId, errorCategory: "kernel_error" });
    expect(res.status).toBe(401);
  });
});
```

If `createApp` is not the actual factory name, replace it with whatever `packages/backend/src/index.ts` exports for tests (search for `request(` in `packages/backend/src/__tests__/` to find the convention).

If a `getAdminTestToken` helper doesn't already exist, create it at `packages/backend/src/__tests__/helpers/auth.ts` mirroring the existing admin-token pattern (`POST /api/auth/login` with the seeded admin user, return the bearer token).

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/render-errors.routes.test.ts
```

Expected: FAIL — 404 (route not mounted) or compile error (import path doesn't exist yet).

- [ ] **Step 3: Implement the sub-router**

Create `packages/backend/src/routes/admin/render-errors.routes.ts`:

```ts
import { Router } from "express";
import { listExamplesByRenderErrorCategory } from "../../services/render-error-analytics.service.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("admin-render-errors-routes");
export const renderErrorsRouter = Router();

renderErrorsRouter.get("/examples", async (req, res) => {
  const categoryId = String(req.query.categoryId ?? "");
  const errorCategory = String(req.query.errorCategory ?? "");
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);

  if (!categoryId || !errorCategory) {
    return res.status(400).json({ error: "categoryId and errorCategory query params are required" });
  }

  try {
    const result = await listExamplesByRenderErrorCategory({ categoryId, errorCategory, limit, offset });
    return res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("Invalid errorCategory")) {
      return res.status(400).json({ error: msg });
    }
    logger.error({ err: msg }, "render-errors listing failed");
    return res.status(500).json({ error: "Failed to list render-error examples" });
  }
});
```

- [ ] **Step 4: Mount the sub-router**

Open `packages/backend/src/routes/admin.routes.ts`. Near the other route mounts (look for existing `adminRouter.use(...)` calls or sub-router imports), add:

```ts
import { renderErrorsRouter } from "./admin/render-errors.routes.js";
// ...
adminRouter.use("/render-errors", renderErrorsRouter);
```

If `admin.routes.ts` doesn't currently use sub-routers (it might inline every handler), mount the routes directly:

```ts
import { renderErrorsRouter } from "./admin/render-errors.routes.js";
// ...
adminRouter.use("/render-errors", renderErrorsRouter);
```

The mount point matters: the existing admin router is mounted at `/api/admin` (verified earlier in the conversation — every existing admin endpoint follows that pattern), so the full URL becomes `/api/admin/render-errors/examples`.

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/render-errors.routes.test.ts
```

Expected: 3 passing tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/routes/admin/render-errors.routes.ts \
        packages/backend/src/routes/admin.routes.ts \
        packages/backend/src/__tests__/render-errors.routes.test.ts
git commit -m "Add GET /api/admin/render-errors/examples drill-down endpoint"
```

---

## Task 12: Shared types — expose `RenderErrorCategory` to the frontend

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add the union type and example shape**

Append to `packages/shared/src/types.ts`:

```ts
export type RenderErrorCategoryName =
  | "infrastructure"
  | "api_misuse"
  | "geometry"
  | "type_error"
  | "kernel_error"
  | "syntax"
  | "unknown";

export interface RenderErrorHistogram {
  infrastructure: number;
  api_misuse: number;
  geometry: number;
  type_error: number;
  kernel_error: number;
  syntax: number;
  unknown: number;
}

export interface RenderErrorExample {
  id: string;
  promptId: string;
  promptText: string;
  renderError: string | null;
  renderErrorDetail: string | null;
  renderErrorCategory: RenderErrorCategoryName;
  createdAt: string; // ISO datetime
}
```

If the existing `WorkbenchExample` type in this file omits render-related fields, add to it:

```ts
  renderErrorCategory?: RenderErrorCategoryName | null;
  renderErrorDetail?: string | null;
```

- [ ] **Step 2: Rebuild shared package if it has a build step**

Run:
```bash
cd packages/shared
npm run build 2>/dev/null || true  # no-op if shared is consumed via tsconfig path
```

- [ ] **Step 3: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/shared/src/types.ts
git commit -m "Expose RenderErrorCategoryName and related types from shared package"
```

---

## Task 13: Frontend API client wrapper

**Files:**
- Create: `packages/frontend/src/api/renderErrors.ts`

- [ ] **Step 1: Write the wrapper**

Create `packages/frontend/src/api/renderErrors.ts`:

```ts
import { apiFetch } from "./client.js";
import type { RenderErrorCategoryName, RenderErrorExample } from "shared";

export interface RenderErrorExamplesResponse {
  examples: RenderErrorExample[];
  total: number;
}

export async function fetchRenderErrorExamples(params: {
  categoryId: string;
  errorCategory: RenderErrorCategoryName;
  limit?: number;
  offset?: number;
}): Promise<RenderErrorExamplesResponse> {
  const search = new URLSearchParams({
    categoryId: params.categoryId,
    errorCategory: params.errorCategory,
    limit: String(params.limit ?? 50),
    offset: String(params.offset ?? 0),
  });
  return apiFetch<RenderErrorExamplesResponse>(`/api/admin/render-errors/examples?${search}`);
}
```

If the existing fetch wrapper has a different signature than `apiFetch<T>(url)`, adapt the call. Look at `packages/frontend/src/api/client.ts` or any existing `packages/frontend/src/api/*.ts` for the convention.

- [ ] **Step 2: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/frontend/src/api/renderErrors.ts
git commit -m "Add frontend API client wrapper for render-errors endpoint"
```

---

## Task 14: Frontend Render Errors tab

**Files:**
- Create: `packages/frontend/src/components/admin/RenderErrorsTab.tsx`
- Modify: wherever admin tabs are registered

- [ ] **Step 1: Locate the existing admin tab registration**

Find the admin page that hosts the tab list:
```bash
grep -rln "DataQualityTab\|KnowledgeTab" packages/frontend/src/pages packages/frontend/src/components/admin
```
The result is the file that registers the existing tabs. Take note of its path — needed in Step 4.

- [ ] **Step 2: Create the tab component**

Create `packages/frontend/src/components/admin/RenderErrorsTab.tsx`:

```tsx
import React, { useEffect, useMemo, useState } from "react";
import { Header, Table, Modal, List, Loader, Segment, Message } from "semantic-ui-react";
import { apiFetch } from "../../api/client.js";
import { fetchRenderErrorExamples } from "../../api/renderErrors.js";
import type {
  RenderErrorCategoryName,
  RenderErrorExample,
  RenderErrorHistogram,
} from "shared";

const CATEGORY_NAMES: RenderErrorCategoryName[] = [
  "kernel_error",
  "geometry",
  "type_error",
  "api_misuse",
  "syntax",
  "infrastructure",
  "unknown",
];

interface CategoryRow {
  categoryId: string;
  categoryName: string;
  stats: { renderErrorCategoryHistogram?: RenderErrorHistogram };
}

interface DataQualityResponse {
  categories?: CategoryRow[];
}

export function RenderErrorsTab(): JSX.Element {
  const [rows, setRows] = useState<CategoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<{
    categoryId: string;
    categoryName: string;
    errorCategory: RenderErrorCategoryName;
    examples: RenderErrorExample[];
    total: number;
  } | null>(null);

  useEffect(() => {
    apiFetch<DataQualityResponse | CategoryRow[]>("/api/admin/data-quality")
      .then((resp) => {
        const list = Array.isArray(resp) ? resp : (resp.categories ?? []);
        setRows(list);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const totals = useMemo(() => {
    if (!rows) return null;
    const t: Record<RenderErrorCategoryName, number> = {
      infrastructure: 0, api_misuse: 0, geometry: 0, type_error: 0,
      kernel_error: 0, syntax: 0, unknown: 0,
    };
    for (const r of rows) {
      const h = r.stats.renderErrorCategoryHistogram;
      if (!h) continue;
      for (const k of CATEGORY_NAMES) t[k] += h[k] ?? 0;
    }
    return t;
  }, [rows]);

  async function openDrillDown(categoryId: string, categoryName: string, errorCategory: RenderErrorCategoryName) {
    try {
      const resp = await fetchRenderErrorExamples({ categoryId, errorCategory, limit: 100 });
      setDrillDown({ categoryId, categoryName, errorCategory, examples: resp.examples, total: resp.total });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (error) return <Message negative content={error} />;
  if (!rows) return <Segment basic><Loader active inline="centered" /></Segment>;

  return (
    <Segment basic>
      <Header as="h2">Render Errors</Header>
      <Table celled compact>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Workbench category</Table.HeaderCell>
            {CATEGORY_NAMES.map((c) => (
              <Table.HeaderCell key={c}>{c}</Table.HeaderCell>
            ))}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row) => {
            const h = row.stats.renderErrorCategoryHistogram;
            return (
              <Table.Row key={row.categoryId}>
                <Table.Cell>{row.categoryName}</Table.Cell>
                {CATEGORY_NAMES.map((c) => {
                  const count = h?.[c] ?? 0;
                  return (
                    <Table.Cell
                      key={c}
                      style={{ cursor: count > 0 ? "pointer" : "default", color: count > 0 ? "#1678c2" : undefined }}
                      onClick={count > 0 ? () => openDrillDown(row.categoryId, row.categoryName, c) : undefined}
                    >
                      {count}
                    </Table.Cell>
                  );
                })}
              </Table.Row>
            );
          })}
          {totals && (
            <Table.Row style={{ fontWeight: 600 }}>
              <Table.Cell>TOTAL</Table.Cell>
              {CATEGORY_NAMES.map((c) => (
                <Table.Cell key={c}>{totals[c]}</Table.Cell>
              ))}
            </Table.Row>
          )}
        </Table.Body>
      </Table>

      <Modal open={drillDown !== null} onClose={() => setDrillDown(null)} size="large">
        <Modal.Header>
          {drillDown?.categoryName} — {drillDown?.errorCategory} ({drillDown?.total} examples)
        </Modal.Header>
        <Modal.Content scrolling>
          <List divided relaxed>
            {drillDown?.examples.map((ex) => (
              <List.Item key={ex.id}>
                <List.Content>
                  <List.Header>{ex.promptText.slice(0, 160)}</List.Header>
                  <List.Description style={{ fontFamily: "monospace", marginTop: 4 }}>
                    {ex.renderError?.slice(0, 400) ?? "(no message)"}
                  </List.Description>
                  {ex.renderErrorDetail && (
                    <div style={{ marginTop: 4, color: "#666" }}>
                      detail: <code>{ex.renderErrorDetail}</code>
                    </div>
                  )}
                </List.Content>
              </List.Item>
            ))}
          </List>
        </Modal.Content>
      </Modal>
    </Segment>
  );
}
```

- [ ] **Step 3: Register the tab**

In the file located in Step 1, add an entry for the new tab. The exact form depends on the registration pattern (`Tab` panes array, switch statement, route table, etc.). Mirror the existing `DataQualityTab` registration but with `RenderErrorsTab`.

Import:
```tsx
import { RenderErrorsTab } from "../components/admin/RenderErrorsTab.js";
```

Add the pane (example shape — adapt to the actual local pattern):
```tsx
{ menuItem: "Render Errors", render: () => <Tab.Pane><RenderErrorsTab /></Tab.Pane> }
```

- [ ] **Step 4: Smoke-test in the running app**

Rebuild the frontend container:
```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
docker compose build frontend && docker compose up -d frontend
```

Then open `http://localhost/admin` in a browser, switch to the new "Render Errors" tab, and verify:
1. The histogram table loads.
2. Cells with non-zero counts are clickable.
3. Clicking a cell opens the drill-down modal with example rows.
4. The TOTAL row sums correctly.

If anything looks broken, fix it before committing.

- [ ] **Step 5: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/frontend/src/components/admin/RenderErrorsTab.tsx \
        <admin-tab-registration-file-path>
git commit -m "Add Render Errors admin tab with per-category histogram and drill-down"
```

Replace `<admin-tab-registration-file-path>` with the actual path identified in Step 1.

---

## Task 15: Run the backfill in production for real

**Files:** (no code changes — operational step)

- [ ] **Step 1: Dry-run on PCB Cases**

Run:
```bash
cd packages/backend
npx tsx scripts/backfill-render-errors.ts --dry-run --category 7f274d66-f415-4d1f-8db2-aff361ebd2a2
```

Inspect the report: `recovered_from_conversation`, `recovered_from_render_error`, `still_unknown`. Confirm `parse_errors` is 0 or near-zero. Confirm `by_classification` shows a reasonable mix (not 100% `unknown`).

- [ ] **Step 2: Commit-mode backfill for PCB Cases**

Run:
```bash
cd packages/backend
npx tsx scripts/backfill-render-errors.ts --commit --category 7f274d66-f415-4d1f-8db2-aff361ebd2a2
```

Verify a few rows changed by querying:
```bash
docker compose exec postgres psql -U postgres -d chat3d -c \
  "SELECT render_error_category, COUNT(*) FROM workbench_examples we
   JOIN workbench_example_prompts wep ON wep.id = we.prompt_id
   WHERE wep.category_id = '7f274d66-f415-4d1f-8db2-aff361ebd2a2'
     AND we.render_status = 'error'
   GROUP BY render_error_category;"
```

- [ ] **Step 3: Dry-run across all categories**

Run:
```bash
cd packages/backend
npx tsx scripts/backfill-render-errors.ts --dry-run
```

Inspect the global report. Same sanity checks as Step 1.

- [ ] **Step 4: Commit-mode backfill across all categories**

Run:
```bash
cd packages/backend
npx tsx scripts/backfill-render-errors.ts --commit
```

- [ ] **Step 5: Open the Render Errors tab and capture findings**

Visit the admin tab. Note the dominant error category per workbench category — particularly for PCB Cases and bd_warehouse. This is the data that unblocks audit §2.13.x.

Add a brief observations note to `docs/codegen-harness-audit.md` under §2.13.1 with the recovered numbers (manual edit; this plan does not script it).

---

## Self-Review

### Spec coverage

| Spec section | Task(s) implementing |
|---|---|
| Motivation / Goal | All — overall plan delivers what the spec asks for |
| Architecture / data flow | Task 3 (helper), Task 5 (write path), Task 7 (backfill), Tasks 9–14 (surface) |
| Schema | Task 1 |
| Code changes — shared types | Task 12 |
| Code changes — workbench-codegen line 800 | Task 5 |
| Code changes — insertExample payload | Task 4 |
| Backfill script (sources, modes, reports) | Tasks 6–7 |
| `/api/admin/data-quality` histogram extension | Tasks 8–10 |
| New `/api/admin/render-errors/examples` endpoint | Tasks 8–9 (service) + Task 11 (route) |
| Frontend `Render Errors` tab + drill-down | Tasks 13–14 |
| Testing — backend unit tests | Tasks 2, 4, 6, 8, 10, 11 |
| Testing — backfill script tests | Task 6 |
| Testing — data-quality integration test | Task 10 |
| Testing — `/api/admin/render-errors/examples` integration | Task 11 |
| Testing — frontend smoke | Task 14 step 4 |
| Migration & rollout | Task 1 (migration), Task 15 (backfill in prod), Task 14 step 4 (UI smoke) |
| Rollback | Task 1 — down migration drops the columns; the helper code becomes dead but harmless |
| Non-goal: no targeted-fix loop | Honored — no task adds one |
| Non-goal: no agent-loop changes | Honored — Task 5 only touches the persistence block |
| Non-goal: no VLM eval work | Honored |
| Non-goal: no application-log scraping | Honored — backfill only reads DB columns |

### Placeholders

No `TBD`, `TODO`, `implement later`, or "add appropriate error handling" sentences. The only spots where the plan defers to the implementer are bounded discovery (the admin-tab registration file path in Task 14, the exact `createApp` factory name in Task 11) and both have concrete grep commands and fallback strategies.

### Type consistency

- The helper's return type `ClassifiedRenderError | null` flows through Task 5 (`classified?.category`, `classified?.capturedDetail`, `classified?.rawMessage`).
- `RenderErrorHistogram` keys match exactly across the analytics service, the data-quality response, the shared type, and the React component.
- `RenderErrorCategoryName` literal-union names match `RenderErrorCategory` enum string values (`"kernel_error"`, etc.) from `render-errors.ts`.
- Backfill report keys (`recovered_from_conversation`, `recovered_from_render_error`, `still_unknown`, `parse_errors`, `per_category`, `by_classification`) are consistent across the script, its tests, and Task 15.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-04-render-error-classification-recovery.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
