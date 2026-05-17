# JSONL Export Format Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "Export JSONL" button in the Workbench with a dropdown that lets the user pick from multiple training-data export formats — preserving the current multi-task export and adding two simpler codegen-only formats (ShareGPT, Alpaca) that target the dgx-manager-fine-tune-recipes loader.

**Architecture:** A small format registry on the backend exposes named exporters; a single dispatcher route accepts `?format=<id>` and writes the file. New exporters live in a new `services/training-export/` directory so the existing 444-line `workbench-training-export.service.ts` is left untouched (it becomes the implementation behind the `openai-multitask` format). The frontend swaps the button for the existing `DropdownMenu` component, with a hardcoded format list mirroring the backend registry.

**Tech Stack:** TypeScript, Prisma, Express, Vitest (backend tests), React + existing `DropdownMenu` component (frontend).

**Out of scope (future work):**
- Held-out benchmark flag / train-vs-benchmark splits — separate concern; tracked in `docs/dataset-release-and-finetune-plan.md`.
- Deduplication, license headers, DATASHEET.md.
- Schema versioning embedded in the JSONL.

**Reference for format choices:**
- `dgx-manager-fine-tune-recipes/lib/dataset.py` accepts ShareGPT, OpenAI messages, QA, Instruct (Alpaca). The `qwen3.6-27b-base-lora` recipe declares `dataset_format: sharegpt`.
- See conversation 2026-05-08 in chat history for full rationale.

---

## File Structure

**New files:**
- `packages/backend/src/services/training-export/types.ts` — shared `ExportFormatId`, `FormatDefinition`, `ExportRequest` types.
- `packages/backend/src/services/training-export/registry.ts` — registry that maps format id → exporter; `listFormats()`, `getFormat(id)`.
- `packages/backend/src/services/training-export/codegen-rows.service.ts` — shared query: fetch approved + rendered codegen examples joined to their prompt and system prompt.
- `packages/backend/src/services/training-export/sharegpt-codegen.exporter.ts` — emits ShareGPT `{conversations: [{from, value}]}` JSONL.
- `packages/backend/src/services/training-export/alpaca-codegen.exporter.ts` — emits Alpaca `{instruction, input, output}` JSONL.
- `packages/backend/src/services/training-export/openai-multitask.exporter.ts` — thin wrapper around the existing `exportCombinedTrainingJsonl` so the registry has a uniform shape.
- `packages/backend/src/__tests__/training-export-codegen-rows.test.ts`
- `packages/backend/src/__tests__/training-export-sharegpt.test.ts`
- `packages/backend/src/__tests__/training-export-alpaca.test.ts`
- `packages/backend/src/__tests__/training-export-registry.test.ts`
- `packages/frontend/src/lib/training-export-formats.ts` — frontend mirror of format ids + labels (hardcoded; no fetch).

**Modified files:**
- `packages/backend/src/routes/workbench-training-export.routes.ts` — add `?format=` dispatcher route; keep existing endpoints as-is for backward compatibility.
- `packages/frontend/src/components/WorkbenchPage.tsx:264-288, 306-308` — replace single button with `DropdownMenu`; one menu item per format.

**Untouched on purpose:**
- `packages/backend/src/services/workbench-training-export.service.ts` — already at 444 lines (size-limit threshold). Wrap, do not modify.

---

### Task 1: Add format types and registry skeleton

**Files:**
- Create: `packages/backend/src/services/training-export/types.ts`
- Create: `packages/backend/src/services/training-export/registry.ts`
- Test: `packages/backend/src/__tests__/training-export-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/training-export-registry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { listFormats, getFormat } from "../services/training-export/registry.js";

describe("training-export registry", () => {
  it("listFormats returns at least one format", () => {
    const formats = listFormats();
    expect(formats.length).toBeGreaterThan(0);
    expect(formats[0]).toMatchObject({
      id: expect.any(String),
      label: expect.any(String),
      description: expect.any(String),
      filename: expect.any(String),
    });
  });

  it("getFormat returns a format by id", () => {
    const formats = listFormats();
    const first = formats[0];
    expect(getFormat(first.id)).toBe(first);
  });

  it("getFormat returns undefined for unknown id", () => {
    expect(getFormat("does-not-exist" as never)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-registry.test.ts
```
Expected: FAIL — module `services/training-export/registry.js` not found.

- [ ] **Step 3: Create types file**

Create `packages/backend/src/services/training-export/types.ts`:

```typescript
export type ExportFormatId =
  | "openai-multitask"
  | "sharegpt-codegen"
  | "alpaca-codegen";

export interface ExportRequest {
  minScore?: number;
  categoryId?: string;
  approvalOnly?: boolean;
}

export interface FormatDefinition {
  id: ExportFormatId;
  label: string;
  description: string;
  filename: string;
  exporter: (req: ExportRequest) => Promise<string>;
}
```

- [ ] **Step 4: Create registry file**

Create `packages/backend/src/services/training-export/registry.ts`:

```typescript
import type { ExportFormatId, FormatDefinition } from "./types.js";

const formats: FormatDefinition[] = [];

export function registerFormat(def: FormatDefinition): void {
  if (formats.some((f) => f.id === def.id)) {
    throw new Error(`Format already registered: ${def.id}`);
  }
  formats.push(def);
}

export function listFormats(): readonly FormatDefinition[] {
  return formats;
}

export function getFormat(id: ExportFormatId): FormatDefinition | undefined {
  return formats.find((f) => f.id === id);
}

// Placeholder registration so the registry is non-empty for tests and the
// real exporter is wired in Task 5.
registerFormat({
  id: "openai-multitask",
  label: "OpenAI multi-task (combined)",
  description: "Placeholder — replaced in Task 5",
  filename: "training-data-combined.jsonl",
  exporter: async () => "",
});
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-registry.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/training-export/types.ts \
        packages/backend/src/services/training-export/registry.ts \
        packages/backend/src/__tests__/training-export-registry.test.ts
git commit -m "Add training-export format registry skeleton"
```

---

### Task 2: Add shared codegen-rows query helper

This helper returns approved, successfully-rendered codegen examples joined to their user prompt and the agent system prompt the model was trained on. Used by both ShareGPT and Alpaca exporters.

**Files:**
- Create: `packages/backend/src/services/training-export/codegen-rows.service.ts`
- Test: `packages/backend/src/__tests__/training-export-codegen-rows.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/training-export-codegen-rows.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchCodegenRows } from "../services/training-export/codegen-rows.service.js";

vi.mock("../db/prisma.js", () => ({
  prisma: {
    workbenchExample: {
      findMany: vi.fn(),
    },
  },
}));

const { prisma } = await import("../db/prisma.js");

describe("fetchCodegenRows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries approved + successfully-rendered examples by default", async () => {
    (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await fetchCodegenRows({});
    const args = (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.renderStatus).toBe("success");
    expect(args.where.experimentRunId).toBe(null);
    expect(args.where.approvalStatus).toEqual({ in: ["auto_approved", "human_approved"] });
  });

  it("drops approval filter when approvalOnly=false", async () => {
    (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await fetchCodegenRows({ approvalOnly: false });
    const args = (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.approvalStatus).toBeUndefined();
  });

  it("applies minScore and categoryId when provided", async () => {
    (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await fetchCodegenRows({ minScore: 7, categoryId: "cat-uuid" });
    const args = (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.evalScore).toEqual({ gte: 7 });
    expect(args.where.promptRef).toEqual({ categoryId: "cat-uuid" });
  });

  it("maps prisma rows to flat shape with prompt, code, system_prompt", async () => {
    (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "ex-1",
        promptId: "p-1",
        code: "from build123d import *\n",
        agentSystemPrompt: "You are a Build123d expert.",
        evalScore: 9,
        promptRef: { prompt: "Make a cube", category: { name: "primitives" } },
      },
    ]);
    const rows = await fetchCodegenRows({});
    expect(rows).toEqual([
      {
        exampleId: "ex-1",
        promptId: "p-1",
        prompt: "Make a cube",
        code: "from build123d import *\n",
        systemPrompt: "You are a Build123d expert.",
        category: "primitives",
        evalScore: 9,
      },
    ]);
  });

  it("skips rows with no agent system prompt", async () => {
    (prisma.workbenchExample.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "ex-1",
        promptId: "p-1",
        code: "x",
        agentSystemPrompt: null,
        evalScore: null,
        promptRef: { prompt: "p", category: { name: "c" } },
      },
    ]);
    const rows = await fetchCodegenRows({});
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-codegen-rows.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `packages/backend/src/services/training-export/codegen-rows.service.ts`:

```typescript
import { prisma } from "../../db/prisma.js";
import type { ExportRequest } from "./types.js";

export interface CodegenRow {
  exampleId: string;
  promptId: string;
  prompt: string;
  code: string;
  systemPrompt: string;
  category: string;
  evalScore: number | null;
}

export async function fetchCodegenRows(req: ExportRequest): Promise<CodegenRow[]> {
  const { minScore, categoryId, approvalOnly = true } = req;

  const where: Record<string, unknown> = {
    renderStatus: "success",
    experimentRunId: null,
  };
  if (approvalOnly) {
    where.approvalStatus = { in: ["auto_approved", "human_approved"] };
  }
  if (minScore != null) {
    where.evalScore = { gte: minScore };
  }
  if (categoryId) {
    where.promptRef = { categoryId };
  }

  const rows = await prisma.workbenchExample.findMany({
    where,
    select: {
      id: true,
      promptId: true,
      code: true,
      agentSystemPrompt: true,
      evalScore: true,
      promptRef: {
        select: {
          prompt: true,
          category: { select: { name: true } },
        },
      },
    },
    orderBy: [
      { promptRef: { categoryId: "asc" } },
      { promptRef: { index: "asc" } },
      { evalScore: "desc" },
    ],
  });

  const out: CodegenRow[] = [];
  for (const r of rows) {
    if (!r.agentSystemPrompt) continue;
    out.push({
      exampleId: r.id,
      promptId: r.promptId,
      prompt: r.promptRef.prompt,
      code: r.code,
      systemPrompt: r.agentSystemPrompt,
      category: r.promptRef.category.name,
      evalScore: r.evalScore != null ? Number(r.evalScore) : null,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-codegen-rows.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/training-export/codegen-rows.service.ts \
        packages/backend/src/__tests__/training-export-codegen-rows.test.ts
git commit -m "Add shared codegen-rows query for training-export"
```

---

### Task 3: Add ShareGPT codegen exporter

Emits one JSONL line per approved row in the format the dgx-manager loader normalizes via `from`/`value`:

```json
{"conversations":[{"from":"system","value":"..."},{"from":"human","value":"..."},{"from":"gpt","value":"```python\n...\n```"}]}
```

**Files:**
- Create: `packages/backend/src/services/training-export/sharegpt-codegen.exporter.ts`
- Test: `packages/backend/src/__tests__/training-export-sharegpt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/training-export-sharegpt.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../services/training-export/codegen-rows.service.js", () => ({
  fetchCodegenRows: vi.fn(),
}));

const { fetchCodegenRows } = await import("../services/training-export/codegen-rows.service.js");
const { exportShareGptCodegenJsonl } = await import("../services/training-export/sharegpt-codegen.exporter.js");

describe("exportShareGptCodegenJsonl", () => {
  it("emits one JSON line per row with conversations [system, human, gpt]", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        exampleId: "ex-1",
        promptId: "p-1",
        prompt: "Make a 20mm cube",
        code: "from build123d import *\nb = Box(20, 20, 20)\n",
        systemPrompt: "You are a Build123d expert.",
        category: "primitives",
        evalScore: 9,
      },
    ]);

    const out = await exportShareGptCodegenJsonl({});
    const lines = out.split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toEqual({
      conversations: [
        { from: "system", value: "You are a Build123d expert." },
        { from: "human", value: "Make a 20mm cube" },
        { from: "gpt", value: "```python\nfrom build123d import *\nb = Box(20, 20, 20)\n\n```" },
      ],
    });
  });

  it("returns empty string when no rows match", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const out = await exportShareGptCodegenJsonl({});
    expect(out).toBe("");
  });

  it("emits one line per row joined by newlines", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([
      { exampleId: "1", promptId: "p1", prompt: "a", code: "x", systemPrompt: "s", category: "c", evalScore: null },
      { exampleId: "2", promptId: "p2", prompt: "b", code: "y", systemPrompt: "s", category: "c", evalScore: null },
    ]);
    const out = await exportShareGptCodegenJsonl({});
    expect(out.split("\n")).toHaveLength(2);
  });

  it("forwards minScore, categoryId, approvalOnly to fetchCodegenRows", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await exportShareGptCodegenJsonl({ minScore: 8, categoryId: "cat-x", approvalOnly: false });
    expect(fetchCodegenRows).toHaveBeenCalledWith({ minScore: 8, categoryId: "cat-x", approvalOnly: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-sharegpt.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the exporter**

Create `packages/backend/src/services/training-export/sharegpt-codegen.exporter.ts`:

```typescript
import { createLogger } from "../../utils/logger.js";
import { fetchCodegenRows } from "./codegen-rows.service.js";
import type { ExportRequest } from "./types.js";

const logger = createLogger("training-export-sharegpt");

export async function exportShareGptCodegenJsonl(req: ExportRequest): Promise<string> {
  const rows = await fetchCodegenRows(req);

  const lines = rows.map((r) =>
    JSON.stringify({
      conversations: [
        { from: "system", value: r.systemPrompt },
        { from: "human", value: r.prompt },
        { from: "gpt", value: `\`\`\`python\n${r.code}\n\`\`\`` },
      ],
    }),
  );

  logger.info({ rowCount: rows.length, lineCount: lines.length }, "sharegpt-codegen export complete");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-sharegpt.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/training-export/sharegpt-codegen.exporter.ts \
        packages/backend/src/__tests__/training-export-sharegpt.test.ts
git commit -m "Add ShareGPT codegen JSONL exporter"
```

---

### Task 4: Add Alpaca codegen exporter

Flat single-turn format. The `instruction` field carries the system prompt + user prompt joined; `output` carries the code. (Alpaca has no native system-prompt slot — concatenation is the established convention used by LLaMA-Factory's Alpaca template.)

**Files:**
- Create: `packages/backend/src/services/training-export/alpaca-codegen.exporter.ts`
- Test: `packages/backend/src/__tests__/training-export-alpaca.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/training-export-alpaca.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../services/training-export/codegen-rows.service.js", () => ({
  fetchCodegenRows: vi.fn(),
}));

const { fetchCodegenRows } = await import("../services/training-export/codegen-rows.service.js");
const { exportAlpacaCodegenJsonl } = await import("../services/training-export/alpaca-codegen.exporter.js");

describe("exportAlpacaCodegenJsonl", () => {
  it("emits {instruction, input, output} per row, with system prompt as input", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        exampleId: "ex-1",
        promptId: "p-1",
        prompt: "Make a 20mm cube",
        code: "from build123d import *\nb = Box(20, 20, 20)\n",
        systemPrompt: "You are a Build123d expert.",
        category: "primitives",
        evalScore: 9,
      },
    ]);

    const out = await exportAlpacaCodegenJsonl({});
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({
      instruction: "Make a 20mm cube",
      input: "You are a Build123d expert.",
      output: "from build123d import *\nb = Box(20, 20, 20)\n",
    });
  });

  it("returns empty string when no rows match", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    expect(await exportAlpacaCodegenJsonl({})).toBe("");
  });

  it("emits one line per row joined by newlines", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([
      { exampleId: "1", promptId: "p1", prompt: "a", code: "x", systemPrompt: "s", category: "c", evalScore: null },
      { exampleId: "2", promptId: "p2", prompt: "b", code: "y", systemPrompt: "s", category: "c", evalScore: null },
    ]);
    expect((await exportAlpacaCodegenJsonl({})).split("\n")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-alpaca.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the exporter**

Create `packages/backend/src/services/training-export/alpaca-codegen.exporter.ts`:

```typescript
import { createLogger } from "../../utils/logger.js";
import { fetchCodegenRows } from "./codegen-rows.service.js";
import type { ExportRequest } from "./types.js";

const logger = createLogger("training-export-alpaca");

export async function exportAlpacaCodegenJsonl(req: ExportRequest): Promise<string> {
  const rows = await fetchCodegenRows(req);

  const lines = rows.map((r) =>
    JSON.stringify({
      instruction: r.prompt,
      input: r.systemPrompt,
      output: r.code,
    }),
  );

  logger.info({ rowCount: rows.length, lineCount: lines.length }, "alpaca-codegen export complete");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-alpaca.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/training-export/alpaca-codegen.exporter.ts \
        packages/backend/src/__tests__/training-export-alpaca.test.ts
git commit -m "Add Alpaca codegen JSONL exporter"
```

---

### Task 5: Wire all formats into the registry and add the dispatcher route

Replace the placeholder registration in `registry.ts` with real exporters for all three formats, and add a single dispatcher route `GET /export/training-jsonl?format=<id>` that picks the format by id.

**Files:**
- Modify: `packages/backend/src/services/training-export/registry.ts`
- Create: `packages/backend/src/services/training-export/openai-multitask.exporter.ts`
- Modify: `packages/backend/src/routes/workbench-training-export.routes.ts`
- Test: extend `packages/backend/src/__tests__/training-export-registry.test.ts`

- [ ] **Step 1: Create the multi-task wrapper**

Create `packages/backend/src/services/training-export/openai-multitask.exporter.ts`:

```typescript
import { exportCombinedTrainingJsonl } from "../workbench-training-export.service.js";
import type { ExportRequest } from "./types.js";

export async function exportOpenAiMultiTaskJsonl(req: ExportRequest): Promise<string> {
  return exportCombinedTrainingJsonl(req);
}
```

- [ ] **Step 2: Update the registry to register all three formats**

Replace the entire content of `packages/backend/src/services/training-export/registry.ts` with:

```typescript
import { exportOpenAiMultiTaskJsonl } from "./openai-multitask.exporter.js";
import { exportShareGptCodegenJsonl } from "./sharegpt-codegen.exporter.js";
import { exportAlpacaCodegenJsonl } from "./alpaca-codegen.exporter.js";
import type { ExportFormatId, FormatDefinition } from "./types.js";

const formats: FormatDefinition[] = [
  {
    id: "openai-multitask",
    label: "OpenAI multi-task (combined)",
    description:
      "Combined agent tool-use + spec-generation + spec-enrichment with task_type discriminator. OpenAI messages format with rich metadata. Backward-compatible default.",
    filename: "training-data-combined.jsonl",
    exporter: exportOpenAiMultiTaskJsonl,
  },
  {
    id: "sharegpt-codegen",
    label: "ShareGPT — codegen only",
    description:
      "Single-turn prompt → final code. {conversations: [{from, value}]}. Matches dataset_format: sharegpt in dgx-manager-fine-tune-recipes.",
    filename: "training-data-sharegpt-codegen.jsonl",
    exporter: exportShareGptCodegenJsonl,
  },
  {
    id: "alpaca-codegen",
    label: "Alpaca — codegen only",
    description:
      "Single-turn flat {instruction, input, output}. Simplest format; system prompt placed in `input`.",
    filename: "training-data-alpaca-codegen.jsonl",
    exporter: exportAlpacaCodegenJsonl,
  },
];

export function listFormats(): readonly FormatDefinition[] {
  return formats;
}

export function getFormat(id: ExportFormatId): FormatDefinition | undefined {
  return formats.find((f) => f.id === id);
}
```

- [ ] **Step 3: Extend registry test**

Append to `packages/backend/src/__tests__/training-export-registry.test.ts` (inside the existing `describe` block, before the closing `});`):

```typescript
  it("registers openai-multitask, sharegpt-codegen, alpaca-codegen", () => {
    const ids = listFormats().map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining(["openai-multitask", "sharegpt-codegen", "alpaca-codegen"]),
    );
  });

  it("each format has non-empty label, description, filename, and an exporter function", () => {
    for (const f of listFormats()) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
      expect(f.filename.length).toBeGreaterThan(0);
      expect(typeof f.exporter).toBe("function");
    }
  });
```

- [ ] **Step 4: Run registry tests**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-registry.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Update the route to dispatch by format**

Modify `packages/backend/src/routes/workbench-training-export.routes.ts` — replace the `trainingExportRouter.get("/export/training-jsonl", ...)` handler at lines 40–48 with this dispatcher version, and add a `GET /export/formats` endpoint for the frontend to introspect available formats. Keep the other routes (`/export/agent-jsonl`, `/export/spec-gen-jsonl`, `/export/spec-enrichment-jsonl`, `/export/agent-tools`) untouched for backward compatibility.

Replace lines 1–48 of the file with:

```typescript
/**
 * Training data export routes — sub-router mounted on workbenchRouter.
 *
 * Endpoints:
 *   GET /export/formats              — List available export formats
 *   GET /export/training-jsonl?format=<id>
 *                                    — Dispatched export (defaults to openai-multitask)
 *   GET /export/agent-jsonl          — (legacy) Agent tool-use trajectories
 *   GET /export/spec-gen-jsonl       — (legacy) Spec generation training data
 *   GET /export/spec-enrichment-jsonl — (legacy) Spec enrichment training data
 *   GET /export/agent-tools          — Tool definitions JSON (for inspection)
 */

import { Router } from "express";
import {
  exportAgentTrainingJsonl,
  exportSpecGenTrainingJsonl,
  exportSpecEnrichmentTrainingJsonl,
  getAgentToolDefinitions,
} from "../services/workbench-training-export.service.js";
import { listFormats, getFormat } from "../services/training-export/registry.js";
import type { ExportFormatId } from "../services/training-export/types.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("training-export-routes");

export const trainingExportRouter = Router();

function parseExportQuery(query: Record<string, unknown>) {
  return {
    minScore: query.minScore ? Number(query.minScore) : undefined,
    categoryId: typeof query.categoryId === "string" ? query.categoryId : undefined,
    approvalOnly: query.approvalOnly !== "false",
  };
}

function sendJsonl(res: import("express").Response, data: string, filename: string) {
  res.setHeader("Content-Type", "application/jsonl");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.status(200).send(data);
}

trainingExportRouter.get("/export/formats", (_req, res) => {
  const formats = listFormats().map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    filename: f.filename,
  }));
  res.json({ formats });
});

trainingExportRouter.get("/export/training-jsonl", async (req, res) => {
  const formatId = (typeof req.query.format === "string" ? req.query.format : "openai-multitask") as ExportFormatId;
  const def = getFormat(formatId);
  if (!def) {
    res.status(400).json({ error: "Unknown format", format: formatId });
    return;
  }
  try {
    const jsonl = await def.exporter(parseExportQuery(req.query));
    sendJsonl(res, jsonl, def.filename);
  } catch (error) {
    logger.error({ err: error, formatId }, "training export failed");
    res.status(500).json({ error: "Export failed", detail: String(error) });
  }
});
```

The remaining handlers (`/export/agent-jsonl` through `/export/agent-tools` at the original lines 50–87) stay exactly as they are.

- [ ] **Step 6: Verify the backend builds and all tests pass**

```bash
cd packages/backend && npm run build
```
Expected: PASS — TypeScript compiles cleanly.

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-*.test.ts
```
Expected: PASS, 12 tests across 4 files.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/training-export/registry.ts \
        packages/backend/src/services/training-export/openai-multitask.exporter.ts \
        packages/backend/src/routes/workbench-training-export.routes.ts \
        packages/backend/src/__tests__/training-export-registry.test.ts
git commit -m "Wire training-export formats into registry + dispatcher route"
```

---

### Task 6: Replace Export JSONL button with a DropdownMenu

The existing button is at `packages/frontend/src/components/WorkbenchPage.tsx:306-308`, with the click handler at lines 264-288. We swap the single button for a `DropdownMenu`, parameterizing the existing fetch+blob+download logic by format id and filename.

**Files:**
- Create: `packages/frontend/src/lib/training-export-formats.ts`
- Modify: `packages/frontend/src/components/WorkbenchPage.tsx`

- [ ] **Step 1: Add the frontend format mirror**

Create `packages/frontend/src/lib/training-export-formats.ts`:

```typescript
export type ExportFormatId = "openai-multitask" | "sharegpt-codegen" | "alpaca-codegen";

export interface ExportFormat {
  id: ExportFormatId;
  label: string;
  description: string;
  filename: string;
}

export const EXPORT_FORMATS: ExportFormat[] = [
  {
    id: "openai-multitask",
    label: "OpenAI multi-task (combined)",
    description: "Agent tool-use + spec-gen + enrichment combined; OpenAI messages format with metadata.",
    filename: "training-data-combined.jsonl",
  },
  {
    id: "sharegpt-codegen",
    label: "ShareGPT — codegen only",
    description: "Single-turn ShareGPT (from/value). Matches dgx-manager-fine-tune-recipes.",
    filename: "training-data-sharegpt-codegen.jsonl",
  },
  {
    id: "alpaca-codegen",
    label: "Alpaca — codegen only",
    description: "Flat instruction/input/output. Simplest format.",
    filename: "training-data-alpaca-codegen.jsonl",
  },
];
```

- [ ] **Step 2: Update WorkbenchPage imports**

In `packages/frontend/src/components/WorkbenchPage.tsx`, find the existing imports near the top of the file. Add (alongside existing imports):

```typescript
import { DropdownMenu, type DropdownItem } from "./ui/dropdown-menu";
import { EXPORT_FORMATS, type ExportFormatId } from "../lib/training-export-formats";
```

(`DropdownMenu` may already be imported elsewhere; if so, skip the duplicate.)

- [ ] **Step 3: Replace the export handler**

Replace the entire `handleExportJsonl` callback at `WorkbenchPage.tsx:264-288` with this format-aware version:

```typescript
  const handleExportJsonl = useCallback((formatId: ExportFormatId) => {
    if (!token) return;
    const format = EXPORT_FORMATS.find((f) => f.id === formatId);
    if (!format) return;
    const url = `/api/admin/workbench/export/training-jsonl?format=${encodeURIComponent(formatId)}`;
    void (async () => {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error("Export failed");
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = format.filename;
        link.click();
        URL.revokeObjectURL(blobUrl);
        pushToast({ tone: "success", title: `Export downloaded (${format.label})` });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [pushToast, token]);
```

- [ ] **Step 4: Replace the button with a DropdownMenu**

In `WorkbenchPage.tsx`, find the `Export JSONL` button at the original lines 306-308:

```tsx
<Button variant="outline" size="sm" iconLeft={<Download className="h-3.5 w-3.5" />} onClick={handleExportJsonl} disabled={!totals || totals.autoApproved + totals.humanApproved === 0}>
  Export JSONL
</Button>
```

Replace with:

```tsx
<DropdownMenu
  triggerLabel="Export JSONL"
  items={EXPORT_FORMATS.map<DropdownItem>((f) => ({
    id: f.id,
    type: "item",
    label: f.label,
    onSelect: () => handleExportJsonl(f.id),
    disabled: !totals || totals.autoApproved + totals.humanApproved === 0,
  }))}
/>
```

- [ ] **Step 5: Verify the frontend type-checks**

```bash
cd packages/frontend && npx tsc --noEmit
```
Expected: PASS — no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/lib/training-export-formats.ts \
        packages/frontend/src/components/WorkbenchPage.tsx
git commit -m "Replace Export JSONL button with format-selector dropdown"
```

---

### Task 7: Docker rebuild + manual smoke test

Per CLAUDE.md: any code change must be verified by rebuilding the affected containers.

- [ ] **Step 1: Rebuild backend and frontend**

```bash
docker compose build backend frontend && docker compose up -d backend frontend
```
Expected: both images build and containers come up healthy.

- [ ] **Step 2: Get an auth token (reuse existing if valid)**

```bash
if curl -sf -H "Authorization: Bearer $(cat /tmp/chat3d-token.txt 2>/dev/null)" http://localhost/api/auth/me > /dev/null 2>&1; then
  echo "Existing token valid"
else
  TOKEN=$(curl -s http://localhost/api/auth/login -H "Content-Type: application/json" \
    -d '{"email":"admin@chat3d.local","password":"change-admin-password"}' | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['token'])")
  echo "$TOKEN" > /tmp/chat3d-token.txt
fi
```

- [ ] **Step 3: Verify `/export/formats` returns the three formats**

```bash
curl -s -H "Authorization: Bearer $(cat /tmp/chat3d-token.txt)" \
  http://localhost/api/admin/workbench/export/formats | python3 -m json.tool
```
Expected: JSON with `formats` array of length 3 — `openai-multitask`, `sharegpt-codegen`, `alpaca-codegen`.

- [ ] **Step 4: Download each format and verify shape**

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
for fmt in openai-multitask sharegpt-codegen alpaca-codegen; do
  echo "=== $fmt ==="
  curl -s -H "Authorization: Bearer $TOKEN" \
    "http://localhost/api/admin/workbench/export/training-jsonl?format=$fmt" \
    -o "/tmp/export-$fmt.jsonl"
  wc -l "/tmp/export-$fmt.jsonl"
  head -1 "/tmp/export-$fmt.jsonl" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print('keys:', list(d.keys()))"
done
```

Expected:
- `openai-multitask`: keys include `task_type`, `messages`, `metadata` (and `tools` for agent rows)
- `sharegpt-codegen`: keys = `["conversations"]` only
- `alpaca-codegen`: keys = `["instruction", "input", "output"]`

- [ ] **Step 5: Verify unknown format returns 400**

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $(cat /tmp/chat3d-token.txt)" \
  "http://localhost/api/admin/workbench/export/training-jsonl?format=does-not-exist"
```
Expected: `400`.

- [ ] **Step 6: Manual UI smoke test**

Open `http://localhost/admin/workbench` in a browser, click the **Export JSONL** dropdown. Verify three options appear with the labels from `EXPORT_FORMATS`. Select each one in turn and confirm that:
1. A download is triggered with the expected filename.
2. A success toast appears with the format label.

If any step fails, debug before marking complete. Do not claim success without running these checks.

- [ ] **Step 7: Commit any incidental fixes**

If steps 1–6 surfaced bugs that needed code changes, commit them. Otherwise, this task is complete with no commit.

---

## Self-Review Notes

- **Spec coverage:** The user asked for a dropdown selector + multiple format support. Tasks 3–4 add ShareGPT and Alpaca; Task 5 adds the dispatcher; Task 6 swaps the button for a dropdown. ✅
- **Backward compatibility:** The default of `?format=openai-multitask` produces byte-identical output to the previous `/export/training-jsonl` endpoint. Legacy `/export/agent-jsonl`, `/export/spec-gen-jsonl`, `/export/spec-enrichment-jsonl` are untouched. ✅
- **File-size check:** `workbench-training-export.service.ts` is 444 lines and is left untouched (wrapped, not edited). Each new file in `services/training-export/` is well under 100 lines. ✅
- **Type consistency:** `ExportFormatId` and `ExportRequest` are defined once in `types.ts` and reused everywhere. Frontend mirrors the same `ExportFormatId` literal-union. ✅
- **TDD:** Each new exporter has tests written first (Tasks 2, 3, 4 follow red-green-commit). ✅
- **What's deferred:** Held-out flag, dedup, license/datasheet, schema versioning. These are noted up-front as out of scope.
