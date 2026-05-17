# Export Comment-Mode Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user export training-data JSONL with one of three comment-stripping modes — `none`, `smart`, `smarter` — applied to the `r.code` field of codegen-only formats (ShareGPT and Alpaca). The `openai-multitask` format ignores the parameter (it includes spec/agent rows where comment stripping is meaningless).

**Architecture:** A pure-TS Python-comment stripper (`strip-comments.ts`) walks each line, tracks string state (single, triple, escaped), and decides per `#` whether to drop the entire line. The two codegen exporters call it on `r.code` before formatting. The route accepts `?commentMode=` and forwards. The frontend dropdown expands from 3 items to 7: one for the multi-task format plus `(format × mode)` entries for the codegen formats. **The Build123d service's parameter extractor only reads inline (post-code) comments, so all "smart" variants leave UI sliders intact** — verified separately during analysis.

**Tech Stack:** TypeScript, Vitest, React (+ existing `DropdownMenu`).

**Out of scope:**
- Changing the recipe's `max_seq_length` (separate decision in `dgx-manager-fine-tune-recipes`).
- Stripping inline comments (would break UI parameter sliders — never do this).
- Stripping docstrings (currently 0.1% of dataset; not worth the effort).
- Held-out flag, dedup, license headers (still future work, see `docs/dataset-release-and-finetune-plan.md`).

**Reference data from analysis (2026-05-08):**
- 1376 codegen examples; 47.8% of total chars are `#` comments.
- `smart` (drop all whole-line) → 31% reduction; fits ≤256 tokens for 69.5% (vs. 43.7% baseline).
- `smarter` (drop only top-level whole-line) → 15% reduction; fits ≤256 tokens for 54.9% — preserves indented CoT.

---

## File Structure

**New files:**
- `packages/backend/src/services/training-export/strip-comments.ts` — pure function `stripComments(code, mode)`.
- `packages/backend/src/__tests__/training-export-strip-comments.test.ts` — covers the three modes plus edge cases (string literals, triple quotes, escapes).

**Modified files:**
- `packages/backend/src/services/training-export/types.ts` — add `commentMode?: "none" | "smart" | "smarter"` to `ExportRequest`.
- `packages/backend/src/services/training-export/sharegpt-codegen.exporter.ts` — call `stripComments` on `r.code` before wrapping in the python fence.
- `packages/backend/src/services/training-export/alpaca-codegen.exporter.ts` — call `stripComments` on `r.code` before assigning to `output`.
- `packages/backend/src/__tests__/training-export-sharegpt.test.ts` — add one test that `commentMode: "smart"` strips a top-level whole-line comment from the output.
- `packages/backend/src/__tests__/training-export-alpaca.test.ts` — same.
- `packages/backend/src/routes/workbench-training-export.routes.ts` — `parseExportQuery` reads `commentMode` from query string.
- `packages/frontend/src/lib/training-export-formats.ts` — replace 3-item list with 7-item list of `{menuId, formatId, commentMode, label, filename}`.
- `packages/frontend/src/components/WorkbenchPage.tsx` — `handleExportJsonl(menuId)` looks up the entry and passes both `format` and `commentMode` query params.

**Untouched on purpose:**
- `packages/backend/src/services/training-export/codegen-rows.service.ts` — strip is a presentation concern; do not couple it to data fetching.
- `packages/backend/src/services/training-export/openai-multitask.exporter.ts` — multi-task format has agent conversations and spec rows where comment stripping is meaningless; ignore the param entirely.
- `packages/backend/src/services/training-export/registry.ts` — `commentMode` is a request-level param, not a registry concern.

---

### Task 1: Implement the pure-TS comment stripper

**Why pure TS:** the strip is hot-path during export (1300+ rows × per-export); shelling out to Python is overkill. We track string state line-by-line, which handles 99.9% of Build123d code. Triple-quoted strings spanning lines are the only real edge case.

**Files:**
- Create: `packages/backend/src/services/training-export/strip-comments.ts`
- Test: `packages/backend/src/__tests__/training-export-strip-comments.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/training-export-strip-comments.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { stripComments } from "../services/training-export/strip-comments.js";

describe("stripComments", () => {
  it("none: returns input unchanged", () => {
    const code = "# header\nx = 1  # inline\n# end\n";
    expect(stripComments(code, "none")).toBe(code);
  });

  it("smart: drops all whole-line comments, keeps inline comments", () => {
    const code = "# header\nx = 1  # inline\n    # indented\ny = 2\n";
    expect(stripComments(code, "smart")).toBe("x = 1  # inline\ny = 2\n");
  });

  it("smarter: drops only top-level whole-line comments, keeps indented", () => {
    const code = "# header\nx = 1  # inline\n    # indented\ny = 2\n";
    expect(stripComments(code, "smarter")).toBe("x = 1  # inline\n    # indented\ny = 2\n");
  });

  it("preserves # characters inside double-quoted strings", () => {
    const code = 'x = "hash # not a comment"  # but this is\n';
    expect(stripComments(code, "smart")).toBe('x = "hash # not a comment"  # but this is\n');
  });

  it("preserves # characters inside single-quoted strings", () => {
    const code = "x = 'hash # not a comment'\n";
    expect(stripComments(code, "smart")).toBe("x = 'hash # not a comment'\n");
  });

  it("preserves # inside triple-quoted strings spanning multiple lines", () => {
    const code = 'doc = """\n# this is inside a docstring\nstill inside\n"""\nx = 1\n';
    // No top-level whole-line comment outside the triple-quoted block, so smart leaves the body alone.
    expect(stripComments(code, "smart")).toBe(code);
  });

  it("handles escaped quotes inside strings", () => {
    const code = 'x = "she said \\"hi\\""  # comment after\n';
    // smart drops nothing here because the only `#` is an inline comment after code
    expect(stripComments(code, "smart")).toBe(code);
  });

  it("collapses 3+ consecutive blank lines to 2 after stripping", () => {
    const code = "# h1\n# h2\nx = 1\n\n\n\ny = 2\n";
    // Both top-level comments are dropped; remaining triple-blank collapses
    expect(stripComments(code, "smart")).toBe("x = 1\n\ny = 2\n");
  });

  it("returns the input unchanged when input has no comments", () => {
    const code = "x = 1\ny = 2\n";
    expect(stripComments(code, "smart")).toBe(code);
    expect(stripComments(code, "smarter")).toBe(code);
  });

  it("smarter: keeps a whole-line comment that is indented inside a with-block", () => {
    const code = "x = 1\nwith open(p) as f:\n    # explain why\n    f.read()\n";
    expect(stripComments(code, "smarter")).toBe(code);
  });

  it("smart: drops the indented whole-line comment", () => {
    const code = "x = 1\nwith open(p) as f:\n    # explain why\n    f.read()\n";
    expect(stripComments(code, "smart")).toBe("x = 1\nwith open(p) as f:\n    f.read()\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-strip-comments.test.ts
```
Expected: FAIL — `Cannot find module '../services/training-export/strip-comments.js'`.

- [ ] **Step 3: Implement the stripper**

Create `packages/backend/src/services/training-export/strip-comments.ts`:

```typescript
export type CommentMode = "none" | "smart" | "smarter";

/**
 * Strip Python `#` comments from source code.
 *
 * Modes:
 *   none    — return input unchanged
 *   smart   — drop all whole-line `#` comments (lines whose first non-whitespace
 *             char is `#`). Keep inline comments (after code on same line).
 *   smarter — drop only top-level whole-line `#` comments (indent === 0).
 *             Keep indented whole-line comments (typically CoT inside blocks)
 *             and all inline comments.
 *
 * Inline comments are NEVER stripped because the Build123d parameter
 * extractor uses them as slider labels in the UI.
 *
 * String handling: tracks state line-by-line for `'`/`"` quotes (Python
 * forbids unterminated single-line strings) and across lines for `'''`/`"""`
 * triple-quoted strings.
 */
export function stripComments(code: string, mode: CommentMode): string {
  if (mode === "none") return code;

  const lines = code.split("\n");
  const out: string[] = [];
  let inTriple: '"""' | "'''" | null = null;

  for (const rawLine of lines) {
    if (inTriple) {
      // Currently inside a multi-line triple-quoted string. Pass through and
      // check whether it closes on this line.
      out.push(rawLine);
      const closeIdx = rawLine.indexOf(inTriple);
      if (closeIdx !== -1) {
        inTriple = null;
      }
      continue;
    }

    // Walk the line tracking string state to find the first `#` outside any string.
    let commentCol = -1;
    let strChar: '"' | "'" | null = null;
    let i = 0;
    while (i < rawLine.length) {
      const c = rawLine[i];
      if (strChar === null) {
        // Check for triple-quote opening first (3 chars beats 1 char).
        if (rawLine.startsWith('"""', i)) {
          const close = rawLine.indexOf('"""', i + 3);
          if (close === -1) {
            inTriple = '"""';
            i = rawLine.length;
          } else {
            i = close + 3;
          }
          continue;
        }
        if (rawLine.startsWith("'''", i)) {
          const close = rawLine.indexOf("'''", i + 3);
          if (close === -1) {
            inTriple = "'''";
            i = rawLine.length;
          } else {
            i = close + 3;
          }
          continue;
        }
        if (c === '"' || c === "'") {
          strChar = c;
          i++;
          continue;
        }
        if (c === "#") {
          commentCol = i;
          break;
        }
        i++;
      } else {
        // Inside a single-line string.
        if (c === "\\" && i + 1 < rawLine.length) {
          i += 2;
          continue;
        }
        if (c === strChar) {
          strChar = null;
        }
        i++;
      }
    }

    if (commentCol === -1) {
      out.push(rawLine);
      continue;
    }

    const before = rawLine.slice(0, commentCol);
    const isWholeLine = before.trim() === "";
    if (!isWholeLine) {
      // Inline comment — never strip.
      out.push(rawLine);
      continue;
    }

    if (mode === "smart") {
      // Drop all whole-line comments.
      continue;
    }
    // mode === "smarter": drop only top-level (indent === 0).
    if (before.length > 0) {
      out.push(rawLine);
    }
    // else drop
  }

  let result = out.join("\n");
  while (result.includes("\n\n\n")) {
    result = result.replace(/\n\n\n/g, "\n\n");
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-strip-comments.test.ts
```
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/training-export/strip-comments.ts \
        packages/backend/src/__tests__/training-export-strip-comments.test.ts
git commit -m "Add pure-TS Python comment stripper for training export"
```

---

### Task 2: Wire `commentMode` through types and codegen exporters

**Files:**
- Modify: `packages/backend/src/services/training-export/types.ts`
- Modify: `packages/backend/src/services/training-export/sharegpt-codegen.exporter.ts`
- Modify: `packages/backend/src/services/training-export/alpaca-codegen.exporter.ts`
- Modify: `packages/backend/src/__tests__/training-export-sharegpt.test.ts`
- Modify: `packages/backend/src/__tests__/training-export-alpaca.test.ts`

- [ ] **Step 1: Add `commentMode` to `ExportRequest`**

Replace `packages/backend/src/services/training-export/types.ts` with:

```typescript
export type ExportFormatId =
  | "openai-multitask"
  | "sharegpt-codegen"
  | "alpaca-codegen";

export type CommentMode = "none" | "smart" | "smarter";

export interface ExportRequest {
  minScore?: number;
  categoryId?: string;
  approvalOnly?: boolean;
  commentMode?: CommentMode;
}

export interface FormatDefinition {
  id: ExportFormatId;
  label: string;
  description: string;
  filename: string;
  exporter: (req: ExportRequest) => Promise<string>;
}
```

- [ ] **Step 2: Add a failing test for ShareGPT comment-mode forwarding**

Open `packages/backend/src/__tests__/training-export-sharegpt.test.ts`. Inside the existing `describe("exportShareGptCodegenJsonl", () => { ... })` block, before the closing `});`, append:

```typescript
  it("applies commentMode='smart' to the gpt code fence", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        exampleId: "ex-1",
        promptId: "p-1",
        prompt: "Make a cube",
        code: "# header\nx = 20\n",
        systemPrompt: "s",
        category: "c",
        evalScore: null,
      },
    ]);
    const out = await exportShareGptCodegenJsonl({ commentMode: "smart" });
    const parsed = JSON.parse(out);
    const gpt = parsed.conversations[2].value as string;
    expect(gpt).not.toContain("# header");
    expect(gpt).toContain("x = 20");
  });
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-sharegpt.test.ts
```
Expected: 4 tests pass, **1 new test fails** because the exporter ignores `commentMode`.

- [ ] **Step 4: Update the ShareGPT exporter to apply the strip**

Replace the entire content of `packages/backend/src/services/training-export/sharegpt-codegen.exporter.ts` with:

```typescript
import { createLogger } from "../../utils/logger.js";
import { fetchCodegenRows } from "./codegen-rows.service.js";
import { stripComments } from "./strip-comments.js";
import type { ExportRequest } from "./types.js";

const logger = createLogger("training-export-sharegpt");

export async function exportShareGptCodegenJsonl(req: ExportRequest): Promise<string> {
  const rows = await fetchCodegenRows(req);
  const mode = req.commentMode ?? "none";

  const lines = rows.map((r) => {
    const code = stripComments(r.code, mode);
    return JSON.stringify({
      conversations: [
        { from: "system", value: r.systemPrompt },
        { from: "human", value: r.prompt },
        { from: "gpt", value: `\`\`\`python\n${code}\n\`\`\`` },
      ],
    });
  });

  logger.info(
    { rowCount: rows.length, lineCount: lines.length, commentMode: mode },
    "sharegpt-codegen export complete",
  );
  return lines.join("\n");
}
```

- [ ] **Step 5: Run the ShareGPT test to confirm green**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-sharegpt.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 6: Add the failing test for Alpaca comment-mode forwarding**

Open `packages/backend/src/__tests__/training-export-alpaca.test.ts`. Inside the `describe("exportAlpacaCodegenJsonl", () => { ... })` block, before the closing `});`, append:

```typescript
  it("applies commentMode='smart' to the output field", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        exampleId: "ex-1",
        promptId: "p-1",
        prompt: "Make a cube",
        code: "# header\nx = 20\n",
        systemPrompt: "s",
        category: "c",
        evalScore: null,
      },
    ]);
    const out = await exportAlpacaCodegenJsonl({ commentMode: "smart" });
    const parsed = JSON.parse(out);
    expect(parsed.output).toBe("x = 20\n");
  });
```

- [ ] **Step 7: Run the Alpaca test to verify it fails**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-alpaca.test.ts
```
Expected: 3 pass, 1 new fails.

- [ ] **Step 8: Update the Alpaca exporter to apply the strip**

Replace the entire content of `packages/backend/src/services/training-export/alpaca-codegen.exporter.ts` with:

```typescript
import { createLogger } from "../../utils/logger.js";
import { fetchCodegenRows } from "./codegen-rows.service.js";
import { stripComments } from "./strip-comments.js";
import type { ExportRequest } from "./types.js";

const logger = createLogger("training-export-alpaca");

export async function exportAlpacaCodegenJsonl(req: ExportRequest): Promise<string> {
  const rows = await fetchCodegenRows(req);
  const mode = req.commentMode ?? "none";

  const lines = rows.map((r) => {
    const code = stripComments(r.code, mode);
    return JSON.stringify({
      instruction: r.prompt,
      input: r.systemPrompt,
      output: code,
    });
  });

  logger.info(
    { rowCount: rows.length, lineCount: lines.length, commentMode: mode },
    "alpaca-codegen export complete",
  );
  return lines.join("\n");
}
```

- [ ] **Step 9: Run the Alpaca test to confirm green**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-alpaca.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 10: Run the full training-export test set**

```bash
cd packages/backend && npx vitest run src/__tests__/training-export-*.test.ts
```
Expected: PASS — total tests = 5 (registry) + 5 (codegen-rows) + 5 (sharegpt) + 4 (alpaca) + 11 (strip-comments) = **30**.

- [ ] **Step 11: Commit**

```bash
git add packages/backend/src/services/training-export/types.ts \
        packages/backend/src/services/training-export/sharegpt-codegen.exporter.ts \
        packages/backend/src/services/training-export/alpaca-codegen.exporter.ts \
        packages/backend/src/__tests__/training-export-sharegpt.test.ts \
        packages/backend/src/__tests__/training-export-alpaca.test.ts
git commit -m "Apply commentMode strip in codegen JSONL exporters"
```

---

### Task 3: Read `?commentMode=` from the route

The `parseExportQuery` helper in `routes/workbench-training-export.routes.ts` builds the `ExportRequest` passed to each exporter. We add one more field. Unknown values fall back to `"none"` so the request never errors out.

**Files:**
- Modify: `packages/backend/src/routes/workbench-training-export.routes.ts`

- [ ] **Step 1: Read the existing `parseExportQuery` helper**

```bash
grep -n "parseExportQuery" packages/backend/src/routes/workbench-training-export.routes.ts
```
Confirm it lives near the top of the file (currently lines ~30-36 after Task 5 of the prior plan).

- [ ] **Step 2: Update `parseExportQuery` to extract `commentMode`**

In `packages/backend/src/routes/workbench-training-export.routes.ts`, find the existing `parseExportQuery`:

```typescript
function parseExportQuery(query: Record<string, unknown>) {
  return {
    minScore: query.minScore ? Number(query.minScore) : undefined,
    categoryId: typeof query.categoryId === "string" ? query.categoryId : undefined,
    approvalOnly: query.approvalOnly !== "false",
  };
}
```

Replace it with:

```typescript
function parseExportQuery(query: Record<string, unknown>) {
  const cmRaw = typeof query.commentMode === "string" ? query.commentMode : undefined;
  const commentMode =
    cmRaw === "smart" || cmRaw === "smarter" || cmRaw === "none" ? cmRaw : undefined;
  return {
    minScore: query.minScore ? Number(query.minScore) : undefined,
    categoryId: typeof query.categoryId === "string" ? query.categoryId : undefined,
    approvalOnly: query.approvalOnly !== "false",
    commentMode,
  };
}
```

- [ ] **Step 3: Verify the backend builds**

```bash
docker compose build backend
```
Expected: build succeeds. (`npm run build` OOMs on Node 24 locally per the prior task — Docker build is the canonical check.)

- [ ] **Step 4: Restart backend and smoke-test the new query param**

```bash
docker compose up -d backend
TOKEN=$(cat /tmp/chat3d-token.txt)
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost/api/admin/workbench/export/training-jsonl?format=alpaca-codegen&commentMode=smart" \
  -o /tmp/export-alpaca-smart.jsonl
wc -l /tmp/export-alpaca-smart.jsonl
head -1 /tmp/export-alpaca-smart.jsonl | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print('output starts with #?', d['output'].lstrip().startswith('#'))"
```

Expected: file has the same line count as the unstripped variant, but `output starts with #?` should print `False` for most rows (a few may legitimately start with an inline-only line). Compare to the unstripped variant:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost/api/admin/workbench/export/training-jsonl?format=alpaca-codegen" \
  -o /tmp/export-alpaca-none.jsonl
wc -c /tmp/export-alpaca-smart.jsonl /tmp/export-alpaca-none.jsonl
```

Expected: the `smart` variant should be roughly 30% smaller in bytes.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/workbench-training-export.routes.ts
git commit -m "Read commentMode from training-export route query string"
```

---

### Task 4: Expand the frontend dropdown to 7 entries

We replace the 3-format mirror with a 7-entry menu. Each entry carries both a format and a comment-mode. The handler builds a URL with both query params.

**Files:**
- Modify: `packages/frontend/src/lib/training-export-formats.ts`
- Modify: `packages/frontend/src/components/WorkbenchPage.tsx`

- [ ] **Step 1: Replace the format mirror with menu items**

Replace the entire content of `packages/frontend/src/lib/training-export-formats.ts` with:

```typescript
export type ExportFormatId = "openai-multitask" | "sharegpt-codegen" | "alpaca-codegen";
export type CommentMode = "none" | "smart" | "smarter";

export interface ExportMenuItem {
  /** Stable id for use as the dropdown menu item key. */
  menuId: string;
  formatId: ExportFormatId;
  commentMode: CommentMode;
  label: string;
  filename: string;
}

export const EXPORT_MENU_ITEMS: ExportMenuItem[] = [
  {
    menuId: "openai-multitask",
    formatId: "openai-multitask",
    commentMode: "none",
    label: "OpenAI multi-task (combined)",
    filename: "training-data-combined.jsonl",
  },
  {
    menuId: "sharegpt-codegen-none",
    formatId: "sharegpt-codegen",
    commentMode: "none",
    label: "ShareGPT — full comments",
    filename: "training-data-sharegpt-codegen.jsonl",
  },
  {
    menuId: "sharegpt-codegen-smarter",
    formatId: "sharegpt-codegen",
    commentMode: "smarter",
    label: "ShareGPT — smarter strip (keep CoT)",
    filename: "training-data-sharegpt-codegen-smarter.jsonl",
  },
  {
    menuId: "sharegpt-codegen-smart",
    formatId: "sharegpt-codegen",
    commentMode: "smart",
    label: "ShareGPT — smart strip (densest UI-safe)",
    filename: "training-data-sharegpt-codegen-smart.jsonl",
  },
  {
    menuId: "alpaca-codegen-none",
    formatId: "alpaca-codegen",
    commentMode: "none",
    label: "Alpaca — full comments",
    filename: "training-data-alpaca-codegen.jsonl",
  },
  {
    menuId: "alpaca-codegen-smarter",
    formatId: "alpaca-codegen",
    commentMode: "smarter",
    label: "Alpaca — smarter strip (keep CoT)",
    filename: "training-data-alpaca-codegen-smarter.jsonl",
  },
  {
    menuId: "alpaca-codegen-smart",
    formatId: "alpaca-codegen",
    commentMode: "smart",
    label: "Alpaca — smart strip (densest UI-safe)",
    filename: "training-data-alpaca-codegen-smart.jsonl",
  },
];
```

- [ ] **Step 2: Update WorkbenchPage imports**

In `packages/frontend/src/components/WorkbenchPage.tsx`, find the existing import line:

```typescript
import { EXPORT_FORMATS, type ExportFormatId } from "../lib/training-export-formats";
```

Replace with:

```typescript
import { EXPORT_MENU_ITEMS } from "../lib/training-export-formats";
```

- [ ] **Step 3: Replace the export handler**

Find the existing `handleExportJsonl` callback in `WorkbenchPage.tsx` (introduced in the previous plan, takes `formatId: ExportFormatId`). Replace the entire callback with:

```typescript
  const handleExportJsonl = useCallback((menuId: string) => {
    if (!token) return;
    const item = EXPORT_MENU_ITEMS.find((it) => it.menuId === menuId);
    if (!item) return;
    const url =
      `/api/admin/workbench/export/training-jsonl` +
      `?format=${encodeURIComponent(item.formatId)}` +
      `&commentMode=${encodeURIComponent(item.commentMode)}`;
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
        link.download = item.filename;
        link.click();
        URL.revokeObjectURL(blobUrl);
        pushToast({ tone: "success", title: `Export downloaded (${item.label})` });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [pushToast, token]);
```

- [ ] **Step 4: Update the DropdownMenu items**

Find the existing `<DropdownMenu triggerLabel="Export JSONL" items={EXPORT_FORMATS.map<DropdownItem>(...)} />` in the page-header `actions` block. Replace it with:

```tsx
<DropdownMenu
  triggerLabel="Export JSONL"
  items={EXPORT_MENU_ITEMS.map<DropdownItem>((item) => ({
    id: item.menuId,
    type: "item",
    label: item.label,
    onSelect: () => handleExportJsonl(item.menuId),
    disabled: !totals || totals.autoApproved + totals.humanApproved === 0,
  }))}
/>
```

- [ ] **Step 5: Verify the frontend type-checks**

```bash
cd packages/frontend && npx tsc --noEmit 2>&1 | grep -E "(WorkbenchPage|training-export-formats)" || echo "no relevant type errors"
```
Expected: `no relevant type errors`. (Pre-existing errors in other files are unrelated and can be ignored.)

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/lib/training-export-formats.ts \
        packages/frontend/src/components/WorkbenchPage.tsx
git commit -m "Expand Export JSONL dropdown to 7 entries with commentMode"
```

---

### Task 5: Docker rebuild + end-to-end smoke test

Per CLAUDE.md: any code change must be verified against running containers.

- [ ] **Step 1: Rebuild backend and frontend**

```bash
docker compose build backend frontend && docker compose up -d backend frontend
```
Expected: both images build and containers come up healthy.

- [ ] **Step 2: Refresh auth token if needed**

```bash
if curl -sf -H "Authorization: Bearer $(cat /tmp/chat3d-token.txt 2>/dev/null)" http://localhost/api/auth/me > /dev/null 2>&1; then
  echo "Existing token valid"
else
  TOKEN=$(curl -s http://localhost/api/auth/login -H "Content-Type: application/json" \
    -d '{"email":"admin@chat3d.local","password":"change-admin-password"}' | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['token'])")
  echo "$TOKEN" > /tmp/chat3d-token.txt
fi
```

- [ ] **Step 3: Download all six codegen variants and compare sizes**

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
for fmt in sharegpt-codegen alpaca-codegen; do
  for mode in none smarter smart; do
    curl -s -H "Authorization: Bearer $TOKEN" \
      "http://localhost/api/admin/workbench/export/training-jsonl?format=$fmt&commentMode=$mode" \
      -o "/tmp/export-$fmt-$mode.jsonl"
    bytes=$(wc -c < "/tmp/export-$fmt-$mode.jsonl")
    lines=$(wc -l < "/tmp/export-$fmt-$mode.jsonl")
    printf "%-32s mode=%-7s bytes=%9d lines=%5d\n" "$fmt" "$mode" "$bytes" "$lines"
  done
done
```

Expected output: for each format, line counts are identical across modes; bytes monotonically decrease as `none > smarter > smart`. Approximate ratios (vs. `none`) per the analysis: `smarter ≈ 0.85`, `smart ≈ 0.69`.

- [ ] **Step 4: Verify slider-driving inline comments survive in `smart` mode**

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
# Pull one alpaca row that has parameter assignments and inspect.
head -1 /tmp/export-alpaca-codegen-smart.jsonl | python3 -c "
import sys, json, re
d = json.loads(sys.stdin.read())
out = d['output']
# Count inline-style comments after assignments (heuristic: ' = NUMBER  # text')
hits = re.findall(r'^\s*\w+\s*=\s*[\d.\-]+\s+#', out, flags=re.MULTILINE)
print(f'inline param-with-comment lines: {len(hits)}')
# Count whole-line top-level comments (these should be ZERO in smart mode)
whole = re.findall(r'^# ', out, flags=re.MULTILINE)
print(f'top-level whole-line comments: {len(whole)}')
"
```

Expected: `inline param-with-comment lines` is positive (sliders will work); `top-level whole-line comments: 0`.

- [ ] **Step 5: Verify unknown commentMode falls back to no-strip**

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost/api/admin/workbench/export/training-jsonl?format=alpaca-codegen&commentMode=bogus"
```
Expected: `200` (unknown values silently fall back to `commentMode: undefined` which means "none" inside the exporter — correct fail-soft behavior for an admin-only feature).

Also confirm a bogus `format` still rejects:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost/api/admin/workbench/export/training-jsonl?format=does-not-exist&commentMode=smart"
```
Expected: `400`.

- [ ] **Step 6: Manual UI smoke test**

Open `http://localhost/admin/workbench` in a browser. Click **Export JSONL**. Verify:
1. Seven menu items appear with labels matching `EXPORT_MENU_ITEMS`.
2. Selecting "ShareGPT — smart strip (densest UI-safe)" downloads a file named `training-data-sharegpt-codegen-smart.jsonl`.
3. Toast appears with the matching label.

If any step fails, debug before marking complete.

- [ ] **Step 7: Commit any incidental fixes**

If steps 1-6 surfaced bugs, commit fixes. Otherwise, no commit.

---

## Self-Review Notes

- **Spec coverage:** Task 1 implements the strip; Task 2 wires it through the codegen exporters with TDD; Task 3 reads the query param; Task 4 expands the frontend dropdown; Task 5 verifies end-to-end. ✅
- **UI sliders preserved:** All three modes leave inline comments untouched; the Build123d parameter extractor only reads inline comments (verified during analysis at `parameter-tweak.service.ts:44-91`). ✅
- **Multi-task untouched:** `openai-multitask.exporter.ts` is not modified; the menu item passes `commentMode: "none"` and the route forwards it; the wrapper around `exportCombinedTrainingJsonl` doesn't read it. ✅
- **Backward compatibility:** Default `commentMode` is `undefined → "none"` in both exporters, so existing API consumers get byte-identical output. ✅
- **File-size check:** All modified files stay well under the 400-line target. The new `strip-comments.ts` is ~95 lines. ✅
- **Type consistency:** `CommentMode` is defined once in `types.ts` and re-exported by name in the frontend mirror. `EXPORT_MENU_ITEMS` replaces `EXPORT_FORMATS` (the prior export); `WorkbenchPage` is updated to match. ✅
- **TDD:** Tasks 1 and 2 are red-green-commit. Task 3 has no unit-testable surface (route plumbing); covered by the smoke test in Task 5. ✅
- **What's deferred:** Stripping docstrings (0.1% of dataset — not worth it), recipe `max_seq_length` change (separate repo), held-out splits.
