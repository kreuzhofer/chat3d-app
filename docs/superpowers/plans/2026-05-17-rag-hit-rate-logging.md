# RAG Hit-Rate Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every RAG-retrieved snippet that enters an agent run (pre-retrieved research package + on-demand tool searches), then post-loop attribute whether the agent actually used each snippet. Persist results to a queryable table so we can compute per-snippet, per-source, per-category hit rates.

**Architecture:** Introduce an in-memory `RagRetrievalCollector` created at `workbench-codegen.service.ts` and threaded through `runAgentCodegen` / `runMultiAgentCodegen` and into `buildAgentTools`. Each retrieval (research pre-pass + `search_examples` / `search_knowledge` / `lookup_api` tool calls) pushes one event. After the agent loop finishes, a pure attribution helper scans the final code + conversation + tool args, matches against the per-snippet identifier set, and bulk-inserts to a new `rag_retrieval_events` table — one row per snippet per generation, with a `used` boolean and `use_evidence` (the first matched identifier). Identifiers shared with the user prompt or spec are skipped to avoid prompt-self-attribution.

**Tech Stack:** TypeScript, Prisma 7, PostgreSQL 16, vitest. No new dependencies. Reuses the existing tool/build/test toolchain.

---

## Background context (for an engineer cold to this codebase)

This is gap #3 from a series of changes inspired by the AHE paper (arXiv:2604.25850v3, "Agentic Harness Engineering"). Gap #2 (per-tool-call latency + error category) is already done — see commits `eb33345`, `694b27e`, `7d7ce51`. This plan implements gap #3 — *RAG retrieval usage* — without which we can't tell whether the snippets we inject into the agent's context window are pulling weight.

Today, two channels feed RAG content to the agent:

1. **Pre-retrieved research package** — computed up front in `workbench-codegen.service.ts:308` via `runResearch()`. Returns examples (workbench rows) + knowledge (external snippets). Formatted into the agent's system prompt by `formatResearchSection` (single-agent) or per-component prompts (multi-agent).
2. **Tool searches** — `search_examples`, `search_knowledge`, `lookup_api` in `agent-tools.service.ts:151-229`. Called on-demand by the agent.

For channel 1 the agent never makes a tool call — the snippet is just in the system prompt. For channel 2 we see the tool call but not whether the response shaped the code. We need a single mechanism that covers both.

## Algorithm (in one paragraph)

For each retrieved snippet, extract a small set of high-signal identifiers (PascalCase tokens + multi-word `snake_case` tokens, capped at 30, with common Python/Build123d stopwords filtered). At retrieval time, push `{source, snippetRef, summary, identifiers, retrievalStep}` to an in-memory collector. After the agent loop finishes, build the haystack = `finalCode + "\n" + conversationToolArgs + "\n" + conversationText`. Compute `promptTokens = extractIdentifiers(promptText + " " + constructionSpec)`. For each event, the first identifier that **appears in the haystack AND is not in `promptTokens`** marks the snippet as `used` (and is stored as `use_evidence`). Bulk-insert events with `used` and `use_evidence` populated.

## What's intentionally out of scope

- **Frontend UI surfacing.** Logging only. A follow-up plan adds a per-category hit-rate dashboard.
- **Hit-rate-weighted RAG ranking.** Once we have the data, we can use it to demote dead snippets — but that's a separate change.
- **Live attribution during the loop.** Post-loop one-shot is cheaper and the data is identical for our purposes.

---

## File Structure

**New files:**
- `packages/backend/prisma/migrations/20260517000000_add_rag_retrieval_events/migration.sql` — DDL for the new table
- `packages/backend/src/services/rag-retrieval-collector.service.ts` — `RagRetrievalCollector` class + retrieval event types
- `packages/backend/src/services/rag-attribution.service.ts` — pure helpers: identifier extraction + usage detection
- `packages/backend/src/__tests__/rag-attribution.test.ts` — unit tests for the pure helpers

**Modified files:**
- `packages/backend/prisma/schema.prisma` — add `RagRetrievalEvent` model, relate to `WorkbenchExample`
- `packages/backend/src/services/agent-tools.service.ts` — accept optional collector in `buildAgentTools` options; push events from the three search tools
- `packages/backend/src/services/agent-codegen.service.ts` — accept optional collector on `AgentCodegenInput`; pass to `buildAgentTools`
- `packages/backend/src/services/agent-multi.service.ts` — forward collector to every `runAgentCodegen` call (sub-agents + assembly)
- `packages/backend/src/services/workbench-codegen.service.ts` — create collector; record pre-retrieved research package items; pass collector down; post-loop call attribution + bulk insert
- `packages/backend/src/routes/admin/index.ts` (or the existing admin router file) — register the new hit-rate route
- `packages/backend/src/routes/admin/rag-hit-rate.routes.ts` — new admin route file for aggregated reads

Each file has one clear responsibility. The pure attribution helpers are isolated and unit-testable; the collector class is dumb storage; the wiring changes are small and mechanical; the DB read path is a separate small file so it doesn't bloat any existing service.

---

### Task 1: Add `rag_retrieval_events` table + Prisma model

**Files:**
- Create: `packages/backend/prisma/migrations/20260517000000_add_rag_retrieval_events/migration.sql`
- Modify: `packages/backend/prisma/schema.prisma:445-510` (add relation on `WorkbenchExample`) + new model below `WorkbenchExample`

- [ ] **Step 1: Write the migration SQL**

Create `packages/backend/prisma/migrations/20260517000000_add_rag_retrieval_events/migration.sql`:

```sql
-- One row per retrieved snippet per workbench_example generation.
-- "used" is populated post-loop by the attribution pass.

CREATE TABLE rag_retrieval_events (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  workbench_example_id UUID NOT NULL,
  source              VARCHAR(40) NOT NULL,
  snippet_ref         TEXT,
  snippet_summary     TEXT NOT NULL,
  identifiers         JSONB NOT NULL,
  retrieval_step      INTEGER,
  used                BOOLEAN NOT NULL DEFAULT FALSE,
  use_evidence        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rag_retrieval_events_pkey PRIMARY KEY (id),
  CONSTRAINT rag_retrieval_events_workbench_example_fk
    FOREIGN KEY (workbench_example_id)
    REFERENCES workbench_examples(id)
    ON DELETE CASCADE
);

CREATE INDEX idx_rag_retrieval_events_example ON rag_retrieval_events (workbench_example_id);
CREATE INDEX idx_rag_retrieval_events_source_used ON rag_retrieval_events (source, used);
CREATE INDEX idx_rag_retrieval_events_snippet_ref ON rag_retrieval_events (source, snippet_ref) WHERE snippet_ref IS NOT NULL;
```

- [ ] **Step 2: Add the Prisma model**

In `packages/backend/prisma/schema.prisma`, immediately after the `WorkbenchExample` model (around line 510) and add a relation back-reference on `WorkbenchExample`.

First, inside the `WorkbenchExample` model's `// Relations` section, add this line (alphabetically with the other relations):

```prisma
  ragRetrievalEvents     RagRetrievalEvent[]
```

Then append the new model below `WorkbenchExample`:

```prisma
model RagRetrievalEvent {
  id                  String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workbenchExampleId  String   @map("workbench_example_id") @db.Uuid
  source              String   @db.VarChar(40)
  snippetRef          String?  @map("snippet_ref") @db.Text
  snippetSummary      String   @map("snippet_summary") @db.Text
  identifiers         Json     @db.JsonB
  retrievalStep       Int?     @map("retrieval_step")
  used                Boolean  @default(false)
  useEvidence         String?  @map("use_evidence") @db.Text
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz()

  // Relations
  workbenchExample    WorkbenchExample @relation(fields: [workbenchExampleId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@index([workbenchExampleId], map: "idx_rag_retrieval_events_example")
  @@index([source, used], map: "idx_rag_retrieval_events_source_used")
  @@map("rag_retrieval_events")
}
```

- [ ] **Step 3: Apply migration and regenerate the Prisma client**

Run:

```bash
cd packages/backend && npx prisma migrate deploy
npx prisma generate --schema=prisma/schema.prisma
```

Expected: `Database is now in sync with the schema.` and `Generated Prisma Client (vX.X.X)`.

- [ ] **Step 4: Verify the table exists and is empty**

Run:

```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -c "\d rag_retrieval_events"
docker compose exec -T postgres psql -U chat3d -d chat3d -c "SELECT COUNT(*) FROM rag_retrieval_events"
```

Expected: schema with 10 columns; count = 0.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/prisma/migrations/20260517000000_add_rag_retrieval_events packages/backend/prisma/schema.prisma
git commit -m "Add rag_retrieval_events table for per-snippet RAG hit tracking"
```

---

### Task 2: Pure attribution helpers + unit tests

**Files:**
- Create: `packages/backend/src/services/rag-attribution.service.ts`
- Create: `packages/backend/src/__tests__/rag-attribution.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/src/__tests__/rag-attribution.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractIdentifiers, detectUsage } from "../services/rag-attribution.service.js";

describe("extractIdentifiers", () => {
  it("captures PascalCase symbols from Build123d code", () => {
    const code = `from build123d import *
with BuildPart() as part:
    Box(10, 10, 10)
    fillet(part.edges(), 1.0)`;
    const ids = extractIdentifiers(code);
    expect(ids).toContain("BuildPart");
    expect(ids).toContain("Box");
  });

  it("captures multi-word snake_case identifiers (length>=2 segments)", () => {
    const code = `result = sweep_along_path(profile, path_line)`;
    const ids = extractIdentifiers(code);
    expect(ids).toContain("sweep_along_path");
    expect(ids).toContain("path_line");
  });

  it("filters Python and common-generic stopwords", () => {
    const code = `if value is None: return True`;
    const ids = extractIdentifiers(code);
    expect(ids).not.toContain("True");
    expect(ids).not.toContain("None");
  });

  it("caps the identifier set at 30", () => {
    const ids = extractIdentifiers(
      Array.from({ length: 100 }, (_, i) => `Class${i}`).join(" "),
    );
    expect(ids.length).toBeLessThanOrEqual(30);
  });

  it("returns an empty array for empty input", () => {
    expect(extractIdentifiers("")).toEqual([]);
  });
});

describe("detectUsage", () => {
  it("returns used=true with evidence when an identifier appears in the final code", () => {
    const result = detectUsage(
      ["RadiusArc", "BuildLine"],
      "with BuildLine() as line: RadiusArc((0,0),(5,5), 3)",
      "",
      "draw an arc",
      "spec: arc geometry",
    );
    expect(result.used).toBe(true);
    expect(["RadiusArc", "BuildLine"]).toContain(result.evidence);
  });

  it("returns used=false when no identifier appears anywhere", () => {
    const result = detectUsage(
      ["RadiusArc"],
      "with BuildLine() as line: line.line((0,0),(5,5))",
      "",
      "draw a polyline",
      "spec: polyline geometry",
    );
    expect(result.used).toBe(false);
    expect(result.evidence).toBeNull();
  });

  it("does not credit identifiers that also appear in the user prompt (ambiguous)", () => {
    const result = detectUsage(
      ["Box"],
      "Box(10,10,10)",
      "",
      "create a Box",
      "spec",
    );
    expect(result.used).toBe(false);
  });

  it("matches against tool-call args / conversation in addition to final code", () => {
    const result = detectUsage(
      ["LoftToProfile"],
      "result = something_else()",
      "tool_args: {\"topic\": \"LoftToProfile\"}",
      "make a loft",
      "spec: loft",
    );
    expect(result.used).toBe(true);
    expect(result.evidence).toBe("LoftToProfile");
  });

  it("requires word-boundary match (no substrings)", () => {
    const result = detectUsage(
      ["Arc"],
      "ArchedRoof()",
      "",
      "build a roof",
      "spec",
    );
    expect(result.used).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd packages/backend && npx vitest run src/__tests__/rag-attribution.test.ts
```

Expected: `Cannot find module './rag-attribution.service.js'` (or similar import error).

- [ ] **Step 3: Implement `rag-attribution.service.ts`**

Create `packages/backend/src/services/rag-attribution.service.ts`:

```typescript
/**
 * Pure helpers for RAG retrieval attribution.
 *
 * extractIdentifiers picks "high-signal" tokens (PascalCase + multi-segment
 * snake_case) from a code/prose snippet. detectUsage tells whether any of
 * those identifiers appears in the agent's final output, after subtracting
 * tokens that already appear in the prompt or spec (which would make
 * attribution ambiguous).
 */

// Generic Python / typing keywords that show up everywhere and aren't useful
// as evidence of "this specific snippet helped".
const STOPWORDS = new Set<string>([
  "True", "False", "None", "Self",
  "Any", "List", "Dict", "Set", "Tuple", "Optional", "Union", "Type",
  "Exception", "ValueError", "TypeError", "Iterable",
  "If", "Else", "Return", "Import", "From",
]);

const MAX_IDS_PER_SNIPPET = 30;

export function extractIdentifiers(text: string): string[] {
  if (!text) return [];
  const set = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z][a-zA-Z0-9_]+\b/g)) {
    if (!STOPWORDS.has(m[0])) set.add(m[0]);
  }
  for (const m of text.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) {
    set.add(m[0]);
  }
  return Array.from(set).slice(0, MAX_IDS_PER_SNIPPET);
}

export interface UsageResult {
  used: boolean;
  evidence: string | null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectUsage(
  snippetIdentifiers: string[],
  finalCode: string,
  conversationText: string,
  promptText: string,
  specText: string,
): UsageResult {
  const ambiguous = new Set(extractIdentifiers(`${promptText} ${specText}`));
  const haystack = `${finalCode}\n${conversationText}`;
  for (const id of snippetIdentifiers) {
    if (ambiguous.has(id)) continue;
    const re = new RegExp(`\\b${escapeRegex(id)}\\b`);
    if (re.test(haystack)) {
      return { used: true, evidence: id };
    }
  }
  return { used: false, evidence: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd packages/backend && npx vitest run src/__tests__/rag-attribution.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/rag-attribution.service.ts packages/backend/src/__tests__/rag-attribution.test.ts
git commit -m "Add pure RAG attribution helpers (identifier extraction + usage detection)"
```

---

### Task 3: `RagRetrievalCollector` class

**Files:**
- Create: `packages/backend/src/services/rag-retrieval-collector.service.ts`

- [ ] **Step 1: Write the collector module**

Create `packages/backend/src/services/rag-retrieval-collector.service.ts`:

```typescript
/**
 * In-memory accumulator for RAG retrieval events during one workbench
 * generation. A single instance is created at the top of the pipeline
 * (workbench-codegen.service.ts) and threaded through agent-codegen,
 * agent-multi, and agent-tools.service.ts. Post-loop, the calling code
 * computes "used" per event and bulk-inserts to rag_retrieval_events.
 *
 * Source values:
 *   - "preretrieved_example"   research package examples (workbench rows)
 *   - "preretrieved_knowledge" research package knowledge entries
 *   - "tool_search_examples"   agent called search_examples
 *   - "tool_search_knowledge"  agent called search_knowledge
 *   - "tool_lookup_api"        agent called lookup_api
 */

export type RagRetrievalSource =
  | "preretrieved_example"
  | "preretrieved_knowledge"
  | "tool_search_examples"
  | "tool_search_knowledge"
  | "tool_lookup_api";

export interface RagRetrievalEvent {
  source: RagRetrievalSource;
  /** Stable reference if known (e.g. workbench prompt id, knowledge source id, api topic). Null for unstructured. */
  snippetRef: string | null;
  /** Short human-readable label (<=200 chars) for UI/debug. */
  snippetSummary: string;
  /** High-signal identifiers extracted from the snippet body. */
  identifiers: string[];
  /** Agent step number when retrieval happened. Null for pre-retrieval. */
  retrievalStep: number | null;
}

export class RagRetrievalCollector {
  private events: RagRetrievalEvent[] = [];

  push(e: RagRetrievalEvent): void {
    this.events.push(e);
  }

  list(): readonly RagRetrievalEvent[] {
    return this.events;
  }

  size(): number {
    return this.events.length;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run:

```bash
npm --workspace @chat3d/backend run build 2>&1 | grep -E "rag-retrieval-collector" | head
```

Expected: no errors mentioning the new file.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/rag-retrieval-collector.service.ts
git commit -m "Add RagRetrievalCollector for in-memory retrieval event capture"
```

---

### Task 4: Wire collector into agent-tools (3 search tools)

**Files:**
- Modify: `packages/backend/src/services/agent-tools.service.ts:108` (options signature) + the three search tool bodies (lines 151-229)

- [ ] **Step 1: Extend the options signature**

In `packages/backend/src/services/agent-tools.service.ts`, change the `buildAgentTools` signature at line 108:

```typescript
export function buildAgentTools(
  deps: AgentToolDeps,
  options: {
    disableRender?: boolean;
    enableSearch?: boolean;
    ragMaxExamplesOverride?: number;
    excludePromptIds?: string[];
    /** Optional collector — when present, RAG-style tools push retrieval events here. */
    retrievalCollector?: import("./rag-retrieval-collector.service.js").RagRetrievalCollector;
    /** Current agent step number (incremented externally per step). Pass a getter so tools see live value. */
    getCurrentStep?: () => number;
  },
): Record<string, any> {
```

- [ ] **Step 2: Import the attribution helper at the top of the file**

Add this import near the other service imports (around line 8-12):

```typescript
import { extractIdentifiers } from "./rag-attribution.service.js";
```

- [ ] **Step 3: Record `search_examples` results**

Inside the `search_examples` tool's `execute` (after the line `const filtered = matches.filter(m => m.similarity >= simThreshold);`), append per-match collector pushes before the formatting return:

```typescript
          if (options.retrievalCollector) {
            const step = options.getCurrentStep?.() ?? null;
            for (const m of filtered) {
              options.retrievalCollector.push({
                source: "tool_search_examples",
                snippetRef: m.promptId ?? null,
                snippetSummary: m.prompt.slice(0, 200),
                identifiers: extractIdentifiers(m.code),
                retrievalStep: step,
              });
            }
          }
```

- [ ] **Step 4: Record `search_knowledge` results**

Inside `search_knowledge`'s `execute`, after `const { matches } = await hybridSearchKnowledge(query, maxKnowledge);` and before the formatting:

```typescript
          if (options.retrievalCollector) {
            const step = options.getCurrentStep?.() ?? null;
            for (const m of matches) {
              options.retrievalCollector.push({
                source: "tool_search_knowledge",
                snippetRef: m.id ?? null,
                snippetSummary: (m.title ?? "").slice(0, 200),
                identifiers: extractIdentifiers(m.code ?? m.description ?? ""),
                retrievalStep: step,
              });
            }
          }
```

If `m.id` or `m.title` don't exist on `KnowledgeSearchMatch`, check the type at `packages/backend/src/services/knowledge.service.ts:38` and use whichever stable field exists (likely `sourceUrl`). The code field IS present (it's the snippet body).

- [ ] **Step 5: Record `lookup_api` results**

Inside `lookup_api`'s `execute`, after the unknown-topic guard and before `return section;`:

```typescript
        if (options.retrievalCollector) {
          const step = options.getCurrentStep?.() ?? null;
          options.retrievalCollector.push({
            source: "tool_lookup_api",
            snippetRef: topic,
            snippetSummary: `API topic: ${topic}`,
            identifiers: extractIdentifiers(section),
            retrievalStep: step,
          });
        }
```

- [ ] **Step 6: Build to verify TypeScript compiles**

Run:

```bash
npm --workspace @chat3d/backend run build 2>&1 | grep -E "agent-tools" | head
```

Expected: no errors on agent-tools. (Pre-existing errors elsewhere are out of scope.)

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/agent-tools.service.ts
git commit -m "Push RAG retrieval events from search_examples, search_knowledge, lookup_api tools"
```

---

### Task 5: Thread collector through agent-codegen

**Files:**
- Modify: `packages/backend/src/services/agent-codegen.service.ts:39-128` (input/result types) + the call to `buildAgentTools` near line 242 + the step counter

- [ ] **Step 1: Add `retrievalCollector` to `AgentCodegenInput`**

In `packages/backend/src/services/agent-codegen.service.ts`, inside `AgentCodegenInput` (right after the `previousMessages` field around line 97):

```typescript
  /** Optional collector — when present, tools log retrieval events here. */
  retrievalCollector?: import("./rag-retrieval-collector.service.js").RagRetrievalCollector;
```

- [ ] **Step 2: Track current step number**

Inside `runAgentCodegen`, locate the step loop (search for `stepCount++` or the `for (let step` loop — around line 300-450). Before the loop, add:

```typescript
  let currentStep = 0;
```

Inside the loop, at the very start of each iteration, increment:

```typescript
    currentStep += 1;
```

- [ ] **Step 3: Pass collector + step getter into `buildAgentTools`**

At the existing call site around line 242, extend the options object:

```typescript
  const agentTools = buildAgentTools(
    { fs, /* ...existing deps... */ },
    {
      disableRender,
      enableSearch: input.enableSearch ?? true,
      ragMaxExamplesOverride: input.ragMaxExamplesOverride,
      excludePromptIds: input.excludePromptIds,
      retrievalCollector: input.retrievalCollector,
      getCurrentStep: () => currentStep,
    },
  );
```

Preserve any other existing options/deps the call site already passes — only add the two new ones at the end.

- [ ] **Step 4: Build + run existing tests to confirm nothing broke**

Run:

```bash
npm --workspace @chat3d/backend run build 2>&1 | grep -E "agent-codegen" | head
cd packages/backend && npx vitest run src/__tests__/rag-attribution.test.ts
```

Expected: build clean for agent-codegen.service.ts; 9 attribution tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/agent-codegen.service.ts
git commit -m "Thread RAG retrieval collector and step counter through runAgentCodegen"
```

---

### Task 6: Forward collector through agent-multi

**Files:**
- Modify: `packages/backend/src/services/agent-multi.service.ts:183, 268, 398, 438` — every internal call to `runAgentCodegen`

- [ ] **Step 1: Identify every `runAgentCodegen(` call site inside `agent-multi.service.ts`**

Run:

```bash
grep -n "runAgentCodegen(" packages/backend/src/services/agent-multi.service.ts
```

Expected: 4 call sites (~lines 183, 268, 398, 438 — verify against current line numbers).

- [ ] **Step 2: At each call site, forward `input.retrievalCollector`**

For each of the 4 sites, ensure the object passed to `runAgentCodegen(...)` includes:

```typescript
    retrievalCollector: input.retrievalCollector,
```

Two of the call sites already spread `input` (e.g., `return runAgentCodegen(input);`) — those need no change. The other two construct fresh input objects (sub-agent + assembly) — add the field there.

After the change, verify:

```bash
grep -B 2 -A 12 "runAgentCodegen(" packages/backend/src/services/agent-multi.service.ts | grep -E "retrievalCollector|runAgentCodegen"
```

Expected: every `runAgentCodegen(` is either passing `input` directly or passing an explicit `retrievalCollector: input.retrievalCollector`.

- [ ] **Step 3: Build**

Run:

```bash
npm --workspace @chat3d/backend run build 2>&1 | grep -E "agent-multi" | head
```

Expected: clean (no new errors on agent-multi).

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/agent-multi.service.ts
git commit -m "Forward RAG retrieval collector through multi-agent sub-runs"
```

---

### Task 7: Capture pre-retrieved research package + attribution + persistence in workbench-codegen

**Files:**
- Modify: `packages/backend/src/services/workbench-codegen.service.ts:90-200` (create collector at pipeline start) + `:308-345` (push pre-retrieved events after `runResearch`) + a new post-loop block after `agResult` is finalized but before the final `insertExample` write

- [ ] **Step 1: Import dependencies at the top of workbench-codegen.service.ts**

Add near the other service imports (around line 35-50):

```typescript
import { RagRetrievalCollector } from "./rag-retrieval-collector.service.js";
import { detectUsage, extractIdentifiers } from "./rag-attribution.service.js";
```

- [ ] **Step 2: Create the collector early in `_generateForPromptInner`**

Just after `const ctx = await loadPromptContext(promptId);` (around line 148), add:

```typescript
  const retrievalCollector = new RagRetrievalCollector();
```

- [ ] **Step 3: Record pre-retrieved research package items after `runResearch`**

Find the block that assigns `researchPackage` (around line 315-322). Immediately after that block completes (i.e., when `researchPackage` is non-null), add:

```typescript
    if (researchPackage) {
      for (const ex of researchPackage.examples) {
        retrievalCollector.push({
          source: "preretrieved_example",
          snippetRef: ex.promptId ?? null,
          snippetSummary: (ex.prompt ?? "").slice(0, 200),
          identifiers: extractIdentifiers(ex.code ?? ""),
          retrievalStep: null,
        });
      }
      for (const k of researchPackage.knowledge) {
        retrievalCollector.push({
          source: "preretrieved_knowledge",
          snippetRef: k.id ?? k.sourceUrl ?? null,
          snippetSummary: (k.title ?? k.description ?? "").slice(0, 200),
          identifiers: extractIdentifiers(k.code ?? k.description ?? ""),
          retrievalStep: null,
        });
      }
    }
```

If `ex.promptId`, `k.id`, `k.sourceUrl`, `k.title`, or `k.description` fields are named differently on the `ResearchPackage` types (defined in `research-agent.service.ts`), substitute the actual field names. Open the type to confirm before editing.

- [ ] **Step 4: Pass the collector into `runAgentCodegen` / `runMultiAgentCodegen`**

Find the agent call sites in this file (search for `runAgentCodegen(` and `runMultiAgentCodegen(`). Each `await` of either function takes an input object — add `retrievalCollector,` to that input:

```typescript
  const agResult = await runAgentCodegen({
    // ... existing fields ...
    retrievalCollector,
  });
```

There may be 2-3 sites (initial run, fix loop retry, multi-agent variant). Touch each one.

- [ ] **Step 5: Post-loop attribution + bulk insert**

Find the post-loop section where `agResult` and the final code/conversation are available (search for `agResult.code` and the `insertExample` call near the end of `_generateForPromptInner`). Before the final `insertExample` (so the example row exists by FK insert time, since the example is inserted earlier as a placeholder — check the placeholder at `:175-190`), add this block:

```typescript
  // Attribute RAG retrievals against the final code + conversation.
  // The placeholder example row was inserted at the start; we attach
  // events to it via earlyExampleId.
  if (retrievalCollector.size() > 0) {
    const finalCode = agResult?.code ?? "";
    const convoText = JSON.stringify(agResult?.conversationHistory ?? []);
    const promptText = ctx.prompt ?? "";
    const specText = specResult?.constructionSpec ?? specResult?.interpretation ?? "";
    const events = retrievalCollector.list();
    const rows = events.map((e) => {
      const ids = Array.isArray(e.identifiers) ? e.identifiers : [];
      const { used, evidence } = detectUsage(ids, finalCode, convoText, promptText, specText);
      return {
        workbenchExampleId: earlyExampleId,
        source: e.source,
        snippetRef: e.snippetRef,
        snippetSummary: e.snippetSummary,
        identifiers: ids as unknown as undefined,
        retrievalStep: e.retrievalStep,
        used,
        useEvidence: evidence,
      };
    });
    try {
      await prisma.ragRetrievalEvent.createMany({ data: rows });
      const usedCount = rows.filter(r => r.used).length;
      logger.info(
        { exampleId: earlyExampleId, total: rows.length, used: usedCount, hitRate: rows.length ? usedCount / rows.length : 0 },
        "rag retrieval attribution complete",
      );
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "rag retrieval persistence failed (non-fatal)");
    }
  }
```

The variable names (`agResult`, `ctx`, `specResult`, `earlyExampleId`) match what's already in scope in that function — verify by reading the surrounding code before pasting. If the multi-agent branch uses a different result variable name (e.g., `multiResult`), perform the same attribution there too with that variable.

- [ ] **Step 6: Build**

Run:

```bash
npm --workspace @chat3d/backend run build 2>&1 | grep -E "workbench-codegen" | head
```

Expected: no new errors in workbench-codegen.service.ts (TS2589 / pre-existing errors elsewhere are not from this change).

- [ ] **Step 7: Manual smoke test — generate one prompt against the running backend**

Restart the backend:

```bash
docker compose build backend && docker compose up -d backend
```

Pick any approved prompt id in any category, fire a regeneration via the admin API (same flow `/improve-category` uses), and after it finishes, inspect events:

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
EXAMPLE_ID=<the example id from the response>
docker compose exec -T postgres psql -U chat3d -d chat3d -c "
SELECT source, snippet_ref, used, use_evidence,
       LEFT(snippet_summary, 60) AS summary
FROM rag_retrieval_events
WHERE workbench_example_id = '${EXAMPLE_ID}'
ORDER BY created_at;"
```

Expected: at least one row per retrieval source the agent touched (usually pre-retrieved examples + knowledge + likely a `tool_search_examples` call). A reasonable hit rate (some `used = true`, some `false`).

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/services/workbench-codegen.service.ts
git commit -m "Capture and attribute RAG retrievals per workbench generation"
```

---

### Task 8: Admin route to query aggregate hit rates

**Files:**
- Create: `packages/backend/src/routes/admin/rag-hit-rate.routes.ts`
- Modify: wherever admin sub-routers are mounted (search for `experimentRouter` or similar pattern to find the mount point; commonly `packages/backend/src/routes/admin/index.ts` or directly in `app.ts`).

- [ ] **Step 1: Locate the admin mount point**

Run:

```bash
grep -rn "experimentRouter\|adminRouter" packages/backend/src/routes packages/backend/src/app.ts 2>/dev/null | head -10
```

Note the file and pattern used — you'll follow the same style.

- [ ] **Step 2: Create the route file**

Create `packages/backend/src/routes/admin/rag-hit-rate.routes.ts`:

```typescript
import { Router, type Request, type Response } from "express";
import { prisma } from "../../db/prisma.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("rag-hit-rate-routes");

export const ragHitRateRouter = Router();

/**
 * GET /api/admin/rag-hit-rate
 * Optional query param: categoryId (filter to one category)
 * Returns per-source counts and used/total ratios.
 */
ragHitRateRouter.get("/", async (req: Request, res: Response) => {
  try {
    const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : null;
    const rows = await prisma.$queryRaw<Array<{
      source: string; total: bigint; used: bigint;
    }>>`
      SELECT r.source,
             COUNT(*)::bigint AS total,
             SUM(CASE WHEN r.used THEN 1 ELSE 0 END)::bigint AS used
      FROM rag_retrieval_events r
      JOIN workbench_examples e ON e.id = r.workbench_example_id
      JOIN workbench_example_prompts p ON p.id = e.prompt_id
      WHERE (${categoryId}::uuid IS NULL OR p.category_id = ${categoryId}::uuid)
      GROUP BY r.source
      ORDER BY r.source
    `;
    const result = rows.map((r) => ({
      source: r.source,
      total: Number(r.total),
      used: Number(r.used),
      hitRate: Number(r.total) > 0 ? Number(r.used) / Number(r.total) : 0,
    }));
    res.json({ bySource: result, categoryId });
  } catch (err) {
    logger.error({ err }, "rag hit rate query failed");
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /api/admin/rag-hit-rate/snippets
 * Returns the most-frequently-retrieved snippets and their per-snippet hit rate.
 */
ragHitRateRouter.get("/snippets", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const rows = await prisma.$queryRaw<Array<{
      source: string; snippet_ref: string | null; summary: string;
      total: bigint; used: bigint;
    }>>`
      SELECT r.source, r.snippet_ref,
             MIN(r.snippet_summary) AS summary,
             COUNT(*)::bigint AS total,
             SUM(CASE WHEN r.used THEN 1 ELSE 0 END)::bigint AS used
      FROM rag_retrieval_events r
      WHERE r.snippet_ref IS NOT NULL
      GROUP BY r.source, r.snippet_ref
      HAVING COUNT(*) > 1
      ORDER BY total DESC
      LIMIT ${limit}::int
    `;
    res.json(rows.map(r => ({
      source: r.source,
      snippetRef: r.snippet_ref,
      summary: r.summary,
      total: Number(r.total),
      used: Number(r.used),
      hitRate: Number(r.total) > 0 ? Number(r.used) / Number(r.total) : 0,
    })));
  } catch (err) {
    logger.error({ err }, "rag hit rate snippets query failed");
    res.status(500).json({ error: "internal_error" });
  }
});
```

- [ ] **Step 3: Mount the router**

At the admin mount point identified in Step 1, register:

```typescript
import { ragHitRateRouter } from "./admin/rag-hit-rate.routes.js";
// ...
adminRouter.use("/rag-hit-rate", ragHitRateRouter);
```

The exact import path depends on the file you're editing; adjust as needed.

- [ ] **Step 4: Restart backend and smoke-test**

Run:

```bash
docker compose build backend && docker compose up -d backend
TOKEN=$(cat /tmp/chat3d-token.txt)
curl -s "http://localhost/api/admin/rag-hit-rate" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
curl -s "http://localhost/api/admin/rag-hit-rate/snippets?limit=20" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -40
```

Expected: JSON with per-source totals and hit rates (if Task 7 has produced any rows). With zero data the endpoints still return `200` with empty arrays.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/admin/rag-hit-rate.routes.ts <admin-mount-file>
git commit -m "Add /api/admin/rag-hit-rate endpoints for per-source and per-snippet stats"
```

---

## How to verify the feature end-to-end after all tasks

1. Restart backend: `docker compose build backend && docker compose up -d backend`
2. Pick a fresh prompt in any category. Trigger a generation through the admin API:
   ```bash
   TOKEN=$(cat /tmp/chat3d-token.txt)
   PROMPT_ID=<known prompt id>
   curl -s -X POST "http://localhost/api/admin/workbench/generate" \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d "{\"promptId\":\"$PROMPT_ID\"}"
   ```
3. Wait for completion (poll the job id, ~3-10 minutes).
4. Query the events for that example:
   ```bash
   docker compose exec -T postgres psql -U chat3d -d chat3d -c \
     "SELECT source, COUNT(*) AS n, SUM(CASE WHEN used THEN 1 ELSE 0 END) AS used FROM rag_retrieval_events WHERE workbench_example_id = (SELECT id FROM workbench_examples WHERE prompt_id='$PROMPT_ID' ORDER BY created_at DESC LIMIT 1) GROUP BY source;"
   ```
   Expected: rows for `preretrieved_example`, `preretrieved_knowledge`, and likely one or more `tool_*` sources, with a non-trivial `used` count for at least the pre-retrieved sources (those are the ones the agent saw without having to search).
5. Hit the aggregate endpoint:
   ```bash
   curl -s "http://localhost/api/admin/rag-hit-rate" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
   ```
   Expected: per-source totals and ratios summarising everything captured so far.

If everything above works, gap #3 is closed — the next AHE-aligned move is gap #5 (component-level ablation), which is now strictly easier because the experiment framework already has baseline charts and per-prompt comparison.
