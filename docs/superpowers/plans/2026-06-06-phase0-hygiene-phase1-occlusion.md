# Phase 0 Hygiene + Phase 1 Gate Contract Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Fix four hygiene issues that pollute analytics + storage, then (2) fix the gate's contract mismatch by routing occluded checklist items to code-only verification.

**Architecture:** Phase 0 ships first (4 operational fixes — pipeline_type persistence, stale trace closure, test-data cascade delete, /health endpoint). Phase 1 adds `assemblyVisibility` to `ComponentChecklistItem`, decomposition LLM tags each item, dispatcher routes occluded items to code-only verification. Isolated component rendering deferred.

**Tech Stack:**
- Backend: TypeScript, Express, Prisma + Postgres, Vercel AI SDK
- Testing: vitest (`packages/backend/src/__tests__/`)
- Container: Docker Compose (`docker compose build backend && docker compose up -d backend`)
- nginx config in `packages/frontend/`

**Spec:** [`docs/superpowers/specs/2026-06-06-phase0-hygiene-phase1-occlusion-design.md`](../specs/2026-06-06-phase0-hygiene-phase1-occlusion-design.md)

---

## File Structure

**Create:**
- `packages/backend/scripts/close-stale-traces.ts` — one-time script: close `running` traces older than 7 days
- `packages/backend/scripts/backfill-pipeline-type.ts` — backfill `pipeline_type` from JSONB trace
- `packages/backend/scripts/delete-test-categories.ts` — cascade delete test categories + prompts + examples + storage files + traces
- `docs/superpowers/specs/2026-06-06-phase0-phase1-test-results.md` — A/B results

**Modify:**
- `packages/backend/src/services/trace-persistence.service.ts` (~line 119) — write real `pipeline_type` on finalize
- `packages/frontend/nginx.conf` (verify actual filename) — add `location = /health` proxying to backend
- `packages/backend/src/utils/component-checklist.ts` — add `AssemblyVisibilityEnum` + optional `assemblyVisibility` field
- `packages/backend/src/services/agent-multi-parser.ts` — extend `DECOMPOSE_CHECKLIST_ADDENDUM` with occlusion guidance
- `packages/backend/src/services/checklist-eval.service.ts` — pre-filter on `assemblyVisibility` in per-item dispatch; reasoning-text annotation
- `packages/backend/src/__tests__/component-checklist.test.ts` — `assemblyVisibility` schema tests
- `packages/backend/src/__tests__/checklist-eval.test.ts` — routing tests for occluded items

---

## Task 1: F4 — close stale `running` traces

**Files:**
- Create: `packages/backend/scripts/close-stale-traces.ts`

Riskless cleanup. One SQL UPDATE behind `--dry-run` / `--commit`.

- [ ] **Step 1: Create the script**

```typescript
// packages/backend/scripts/close-stale-traces.ts
import { prisma } from "../src/db/prisma.js";
import { createLogger } from "../src/utils/logger.js";

const logger = createLogger("close-stale-traces");

const STALE_THRESHOLD_DAYS = 7;
const NOTE = "stale; closed by hygiene pass 2026-06-06";

interface CloseReport {
  candidateCount: number;
  closedCount: number;
  sample: { id: string; updatedAt: Date }[];
}

export async function closeStaleTraces(commit: boolean): Promise<CloseReport> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.generationTrace.findMany({
    where: { status: "running", updatedAt: { lt: cutoff } },
    select: { id: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
  });

  logger.info({ count: candidates.length, cutoff }, "found stale running traces");

  if (!commit) {
    return {
      candidateCount: candidates.length,
      closedCount: 0,
      sample: candidates.slice(0, 5),
    };
  }

  const result = await prisma.generationTrace.updateMany({
    where: { status: "running", updatedAt: { lt: cutoff } },
    data: { status: "failed", errorMessage: NOTE },
  });

  logger.info({ closedCount: result.count }, "closed stale running traces");

  return {
    candidateCount: candidates.length,
    closedCount: result.count,
    sample: candidates.slice(0, 5),
  };
}

async function main() {
  const commit = process.argv.includes("--commit");
  if (!commit) logger.warn("dry-run mode (pass --commit to actually update)");
  const report = await closeStaleTraces(commit);
  logger.info(report, "close-stale-traces report");
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, "close-stale-traces failed");
  process.exit(1);
});
```

**Important:** the script imports `prisma` from `../src/db/prisma.js`. Verify this path is correct by checking how `backfill-render-errors.ts` does it. If the actual import differs (e.g., from `../src/lib/prisma.js`), match that.

Also verify the field name on `GenerationTrace`:
- The spec uses `error_message` (snake_case DB column).
- Prisma model field is likely `errorMessage` (camelCase).
- Confirm by checking `packages/backend/prisma/schema.prisma` for the `GenerationTrace` model.

If the field is named differently in Prisma (e.g., `errorMessage` vs `error`), use the actual name.

- [ ] **Step 2: Dry-run to confirm match**

```bash
docker compose exec -T backend npx tsx scripts/close-stale-traces.ts
```

Expected log line: `{"count": 23, ...}` (or whatever the current count is).

- [ ] **Step 3: Commit**

```bash
git add packages/backend/scripts/close-stale-traces.ts
git commit -m "Add close-stale-traces script for hygiene pass"
```

- [ ] **Step 4: Run --commit**

```bash
docker compose exec -T backend npx tsx scripts/close-stale-traces.ts --commit
```

Expected: closedCount matches candidateCount.

- [ ] **Step 5: Verify**

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT COUNT(*) FROM generation_traces WHERE status='running' AND updated_at < NOW() - INTERVAL '7 days';"
```

Expected: 0.

---

## Task 2: F3 — `pipeline_type` forward fix + backfill

**Files:**
- Modify: `packages/backend/src/services/trace-persistence.service.ts`
- Create: `packages/backend/scripts/backfill-pipeline-type.ts`
- Test: `packages/backend/src/__tests__/trace-persistence-pipeline-type.test.ts` (smoke)

The column gets written as `'single_agent'` at trace start. Update path: on finalize, write the real value from `trace.pipelineType`.

- [ ] **Step 1: Read current trace-persistence flow**

```bash
grep -n "pipelineType\|pipeline_type" packages/backend/src/services/trace-persistence.service.ts | head -20
```

Locate:
- The function that creates the initial row (writes `single_agent` early)
- The function that finalizes / updates with the JSONB `trace` payload
- Where `trace.pipelineType` lives in the trace structure

- [ ] **Step 2: Update finalize path**

When the row's `trace` field is being written/updated and `trace.pipelineType` is populated, also update the `pipeline_type` column to match.

Example shape (adapt to actual code structure):

```typescript
await prisma.generationTrace.update({
  where: { id: traceId },
  data: {
    trace: finalTrace,
    status,
    pipelineType: finalTrace.pipelineType ?? "single_agent",
    // ... other finalize fields
  },
});
```

- [ ] **Step 3: Create backfill script**

```typescript
// packages/backend/scripts/backfill-pipeline-type.ts
import { prisma } from "../src/db/prisma.js";
import { createLogger } from "../src/utils/logger.js";

const logger = createLogger("backfill-pipeline-type");

interface BackfillReport {
  candidateCount: number;
  updatedCount: number;
  sample: { id: string; oldType: string; newType: string }[];
}

export async function backfillPipelineType(commit: boolean): Promise<BackfillReport> {
  // Find rows where the JSONB trace has a pipelineType that differs from the column
  const candidatesQuery = `
    SELECT id, pipeline_type AS old_type, trace->>'pipelineType' AS new_type
    FROM generation_traces
    WHERE trace->>'pipelineType' IS NOT NULL
      AND pipeline_type != trace->>'pipelineType'
    ORDER BY created_at DESC
  `;
  const candidates: { id: string; old_type: string; new_type: string }[] =
    await prisma.$queryRawUnsafe(candidatesQuery);

  logger.info({ count: candidates.length }, "found rows needing backfill");

  if (!commit) {
    return {
      candidateCount: candidates.length,
      updatedCount: 0,
      sample: candidates.slice(0, 5).map((c) => ({
        id: c.id,
        oldType: c.old_type,
        newType: c.new_type,
      })),
    };
  }

  const updateResult = await prisma.$executeRawUnsafe(`
    UPDATE generation_traces
    SET pipeline_type = trace->>'pipelineType'
    WHERE trace->>'pipelineType' IS NOT NULL
      AND pipeline_type != trace->>'pipelineType'
  `);

  logger.info({ updatedCount: updateResult }, "backfilled pipeline_type");

  return {
    candidateCount: candidates.length,
    updatedCount: Number(updateResult),
    sample: candidates.slice(0, 5).map((c) => ({
      id: c.id,
      oldType: c.old_type,
      newType: c.new_type,
    })),
  };
}

async function main() {
  const commit = process.argv.includes("--commit");
  if (!commit) logger.warn("dry-run mode (pass --commit to actually update)");
  const report = await backfillPipelineType(commit);
  logger.info(report, "backfill-pipeline-type report");
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, "backfill-pipeline-type failed");
  process.exit(1);
});
```

- [ ] **Step 4: Verify forward fix with a smoke**

If you can trigger a fresh generation, do so. Then check:

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT id, pipeline_type, trace->>'pipelineType' \
   FROM generation_traces ORDER BY created_at DESC LIMIT 5;"
```

The two values should match for new rows.

If you can't easily trigger a fresh generation in this task, defer the smoke to Task 7 (Phase 1 smoke).

- [ ] **Step 5: Run backfill dry-run, then commit**

```bash
docker compose exec -T backend npx tsx scripts/backfill-pipeline-type.ts
docker compose exec -T backend npx tsx scripts/backfill-pipeline-type.ts --commit
```

- [ ] **Step 6: Verify**

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT pipeline_type, COUNT(*) FROM generation_traces GROUP BY 1 ORDER BY 1;"
```

Expected: a realistic split (not 95% single_agent). Note the actual ratio for the A/B report.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/trace-persistence.service.ts \
        packages/backend/scripts/backfill-pipeline-type.ts
git commit -m "Fix pipeline_type forward write + backfill historical rows"
```

---

## Task 3: F10 — nginx `/health` proxy

**Files:**
- Modify: `packages/frontend/nginx.conf` (verify actual file location)

- [ ] **Step 1: Locate the nginx config**

```bash
find packages -name "nginx*.conf" -not -path "*/node_modules/*" 2>/dev/null
```

The actual file is likely `packages/frontend/nginx.conf`. Open it and find the existing `server { ... }` block.

- [ ] **Step 2: Add the location block**

Inside the `server { ... }` block, alongside the existing `location /api/`, add:

```nginx
location = /health {
  proxy_pass http://backend:3001/api/health;
  proxy_http_version 1.1;
  access_log off;
}
```

The upstream name (`backend`) and port (`3001`) should match the existing `location /api/` proxy_pass. Verify by reading the existing block first.

- [ ] **Step 3: Verify backend's `/api/health` exists**

```bash
grep -rn "/api/health\|router.get.*health\|app.get.*health" packages/backend/src/ | head -5
```

If `/api/health` doesn't exist, find where backend health is exposed (e.g., `/health` directly on the backend port) and adjust the proxy_pass accordingly.

- [ ] **Step 4: Rebuild frontend container**

```bash
docker compose build frontend && docker compose up -d frontend
```

- [ ] **Step 5: Verify**

```bash
curl -s http://localhost/health | head -100
```

Expected: JSON response from backend (e.g., `{"status":"ok"}`), NOT HTML.

If you get HTML, the location block didn't take effect — check nginx logs:

```bash
docker compose logs frontend --since 2m | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/nginx.conf
git commit -m "Proxy /health to backend so liveness probes see real status"
```

---

## Task 4: F5 — delete test categories

**Files:**
- Create: `packages/backend/scripts/delete-test-categories.ts`

The biggest Phase 0 task. Hard-delete categories matching `*test*` (case-insensitive) along with their full graph.

- [ ] **Step 1: Confirm the cascade graph**

```bash
grep -A 15 "model WorkbenchCategory\|model WorkbenchPrompt\|model WorkbenchExample\|model GenerationTrace" \
  packages/backend/prisma/schema.prisma
```

Verify:
- WorkbenchCategory has many WorkbenchPrompts
- WorkbenchPrompt has many WorkbenchExamples
- WorkbenchExample is linked to GenerationTrace (via traceId or similar)
- Storage file naming convention (the spec says `/data/storage/modelcreator/{example.id}.{b123d,3mf,step,stl}`)

- [ ] **Step 2: Create the script**

```typescript
// packages/backend/scripts/delete-test-categories.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "../src/db/prisma.js";
import { createLogger } from "../src/utils/logger.js";

const logger = createLogger("delete-test-categories");

const STORAGE_ROOT = "/data/storage/modelcreator";
const FILE_EXTS = [".b123d", ".3mf", ".step", ".stl"];
const NAME_PATTERN = /test/i;

interface CategorySummary {
  id: string;
  name: string;
  promptCount: number;
  exampleCount: number;
  fileCount: number; // existing files on disk
}

interface DeleteReport {
  matchedCount: number;
  categories: CategorySummary[];
  totalPrompts: number;
  totalExamples: number;
  totalFilesDeleted: number;
  diskFreedBytes: number;
}

async function statFileSize(filePath: string): Promise<number> {
  try {
    const s = await fs.stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
}

async function findMatchingCategories() {
  // Pull all categories, filter by pattern (Prisma where { name: { contains } } is case-insensitive only with mode)
  const all = await prisma.workbenchCategory.findMany({
    select: { id: true, name: true },
  });
  return all.filter((c) => NAME_PATTERN.test(c.name));
}

async function summarizeCategory(categoryId: string, categoryName: string): Promise<CategorySummary> {
  const prompts = await prisma.workbenchPrompt.findMany({
    where: { categoryId },
    select: { id: true },
  });
  const promptIds = prompts.map((p) => p.id);

  const examples = await prisma.workbenchExample.findMany({
    where: { promptId: { in: promptIds } },
    select: { id: true },
  });

  let fileCount = 0;
  let totalBytes = 0;
  for (const ex of examples) {
    for (const ext of FILE_EXTS) {
      const p = path.join(STORAGE_ROOT, `${ex.id}${ext}`);
      const size = await statFileSize(p);
      if (size > 0) {
        fileCount += 1;
        totalBytes += size;
      }
    }
  }

  return {
    id: categoryId,
    name: categoryName,
    promptCount: prompts.length,
    exampleCount: examples.length,
    fileCount,
  };
}

export async function deleteTestCategories(commit: boolean): Promise<DeleteReport> {
  const matches = await findMatchingCategories();
  logger.info({ count: matches.length }, "found candidate test categories");

  const summaries: CategorySummary[] = [];
  for (const m of matches) {
    summaries.push(await summarizeCategory(m.id, m.name));
  }

  const totalPrompts = summaries.reduce((s, c) => s + c.promptCount, 0);
  const totalExamples = summaries.reduce((s, c) => s + c.exampleCount, 0);
  const totalFiles = summaries.reduce((s, c) => s + c.fileCount, 0);

  if (!commit) {
    return {
      matchedCount: matches.length,
      categories: summaries.slice(0, 30), // cap the printed sample
      totalPrompts,
      totalExamples,
      totalFilesDeleted: 0,
      diskFreedBytes: 0,
    };
  }

  let filesDeleted = 0;
  let diskFreed = 0;

  // Commit phase — wrap in a transaction
  await prisma.$transaction(async (tx) => {
    for (const cat of matches) {
      logger.info({ categoryId: cat.id, name: cat.name }, "deleting category");

      const prompts = await tx.workbenchPrompt.findMany({
        where: { categoryId: cat.id },
        select: { id: true },
      });

      for (const prompt of prompts) {
        const examples = await tx.workbenchExample.findMany({
          where: { promptId: prompt.id },
          select: { id: true, traceId: true },
        });

        for (const ex of examples) {
          // Delete storage files BEFORE deleting the example row.
          // Note: file ops outside the DB transaction means rollback leaves files gone.
          // Acceptable per spec — orphan files are fine, /api/files handles missing.
          for (const ext of FILE_EXTS) {
            const p = path.join(STORAGE_ROOT, `${ex.id}${ext}`);
            try {
              const s = await fs.stat(p);
              await fs.unlink(p);
              filesDeleted += 1;
              diskFreed += s.size;
            } catch {
              /* missing file is fine */
            }
          }

          // Delete linked generation_traces
          if (ex.traceId) {
            await tx.generationTrace.deleteMany({ where: { id: ex.traceId } });
          }

          await tx.workbenchExample.delete({ where: { id: ex.id } });
        }

        await tx.workbenchPrompt.delete({ where: { id: prompt.id } });
      }

      await tx.workbenchCategory.delete({ where: { id: cat.id } });
    }
  }, { timeout: 5 * 60 * 1000 }); // 5 min timeout for big sweeps

  logger.info({ filesDeleted, diskFreed }, "delete-test-categories complete");

  return {
    matchedCount: matches.length,
    categories: summaries.slice(0, 30),
    totalPrompts,
    totalExamples,
    totalFilesDeleted: filesDeleted,
    diskFreedBytes: diskFreed,
  };
}

async function main() {
  const commit = process.argv.includes("--commit");
  if (!commit) logger.warn("dry-run mode (pass --commit to actually delete)");
  const report = await deleteTestCategories(commit);
  // Print report (avoid huge category list in non-commit mode)
  logger.info(
    {
      matchedCount: report.matchedCount,
      totalPrompts: report.totalPrompts,
      totalExamples: report.totalExamples,
      diskFreedMB: Math.round(report.diskFreedBytes / 1024 / 1024),
      filesDeleted: report.totalFilesDeleted,
    },
    "delete-test-categories report"
  );
  if (report.categories.length > 0) {
    logger.info({ sample: report.categories.slice(0, 10) }, "sample of matched categories");
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, "delete-test-categories failed");
  process.exit(1);
});
```

**Important caveats during implementation:**
- Verify the Prisma model name for the trace link on `WorkbenchExample` — could be `traceId`, `generationTraceId`, or via a relation. Adapt the `tx.generationTrace.deleteMany` accordingly.
- If `workbench_examples` has additional cascade-like dependencies (other tables that reference example.id), Prisma will throw on foreign-key violation. Read the schema and handle those too.
- The script doesn't handle `WorkbenchPromptTag` join-table cleanup — Prisma should handle these via cascade if the schema declared `onDelete: Cascade`, but verify.

- [ ] **Step 3: Dry-run review**

```bash
docker compose exec -T backend npx tsx scripts/delete-test-categories.ts
```

Expected output:
```
matchedCount: <N> (~500 per Codex's audit)
totalPrompts: <N>
totalExamples: <N>
diskFreedMB: <N>
filesDeleted: 0 (dry-run)
sample of matched categories: [...]
```

**Carefully review the sample.** Confirm no legit category names match the pattern. If any do (e.g., a category genuinely named "Testing Patterns"), adjust the pattern to exclude them — either narrow the regex or add a deny-list.

- [ ] **Step 4: Pause and have the user review**

After the dry-run output is captured, STOP. Report the matched count + sample to the user. Confirm before --commit.

- [ ] **Step 5: Commit the script (script source, not deletion)**

```bash
git add packages/backend/scripts/delete-test-categories.ts
git commit -m "Add delete-test-categories cascade script (dry-run + commit modes)"
```

- [ ] **Step 6: Run --commit (after user approval)**

```bash
docker compose exec -T backend npx tsx scripts/delete-test-categories.ts --commit
```

Expected: matchedCount matches Step 3, filesDeleted > 0, diskFreedMB > 0.

- [ ] **Step 7: Verify**

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT COUNT(*) FROM workbench_categories;"
```

Expected: ~16 (was 521).

```bash
docker compose exec -T backend ls /data/storage/modelcreator/ | wc -l
```

Should be significantly lower than before.

---

## Task 5: Phase 1 — `assemblyVisibility` schema

**Files:**
- Modify: `packages/backend/src/utils/component-checklist.ts`
- Test: `packages/backend/src/__tests__/component-checklist.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/src/__tests__/component-checklist.test.ts`:

```typescript
describe("ComponentChecklistItem with assemblyVisibility", () => {
  it("accepts an item with assemblyVisibility=visible", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "x",
      visibility: "visual",
      assemblyVisibility: "visible",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.assemblyVisibility).toBe("visible");
  });

  it("accepts an item with assemblyVisibility=occluded", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "Pin diameter 3mm",
      visibility: "code",
      assemblyVisibility: "occluded",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an item without assemblyVisibility (backwards compat)", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "x",
      visibility: "visual",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.assemblyVisibility).toBeUndefined();
  });

  it("rejects unknown assemblyVisibility value", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "x",
      visibility: "visual",
      assemblyVisibility: "hidden",
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
docker compose exec -T backend npx vitest run src/__tests__/component-checklist.test.ts
```

Expected: 4 new tests FAIL.

- [ ] **Step 3: Extend the schema**

In `packages/backend/src/utils/component-checklist.ts`, add the enum + extend the item schema:

```typescript
export const AssemblyVisibilityEnum = z.enum(["visible", "occluded"]);
export type AssemblyVisibility = z.infer<typeof AssemblyVisibilityEnum>;

export const ComponentChecklistItemSchema = z.object({
  item: z.string().min(1),
  visibility: ChecklistVisibilityEnum,
  componentName: z.string().min(1).optional(),
  /** Whether the feature is visible in the assembled render (Phase 1 — Codex F6 fix). */
  assemblyVisibility: AssemblyVisibilityEnum.optional(),
});
```

- [ ] **Step 4: Run tests**

```bash
docker compose exec -T backend npx vitest run src/__tests__/component-checklist.test.ts
```

Expected: 14/14 PASS (10 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/utils/component-checklist.ts \
        packages/backend/src/__tests__/component-checklist.test.ts
git commit -m "Add AssemblyVisibility enum + assemblyVisibility field on ComponentChecklistItem"
```

---

## Task 6: Phase 1 — extend decomposition prompt with occlusion guidance

**Files:**
- Modify: `packages/backend/src/services/agent-multi-parser.ts`
- Test: `packages/backend/src/__tests__/decompose-prompt-checklist.test.ts`

- [ ] **Step 1: Add an assertion test on prompt content**

Append to `packages/backend/src/__tests__/decompose-prompt-checklist.test.ts`:

```typescript
import { DECOMPOSE_CHECKLIST_ADDENDUM } from "../services/agent-multi-parser.js";

describe("DECOMPOSE_CHECKLIST_ADDENDUM — Phase 1 occlusion guidance", () => {
  it("instructs the LLM to emit assemblyVisibility", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/assemblyVisibility/);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/visible/);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/occluded/);
  });

  it("provides example types of occluded features", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/hidden inside|covered by/i);
  });

  it("explains the dispatcher routing consequence", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/skip VLM verification|code-eval/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
docker compose exec -T backend npx vitest run src/__tests__/decompose-prompt-checklist.test.ts
```

Expected: 3 new tests FAIL.

- [ ] **Step 3: Also extend `parseComponentChecklist` test for assemblyVisibility passthrough**

In the same file, ensure `parseComponentChecklist` returns the `assemblyVisibility` field:

```typescript
it("parses assemblyVisibility through parseComponentChecklist", () => {
  const json = JSON.stringify({
    components: [
      {
        name: "body",
        description: "the box",
        componentChecklist: [
          { item: "Wall thickness 2mm", visibility: "code", assemblyVisibility: "occluded" },
          { item: "Port cutout visible", visibility: "visual", assemblyVisibility: "visible" },
        ],
      },
    ],
    assemblyNotes: "n/a",
  });
  const r = parseDecompositionResponse(json);
  expect(r.components[0].componentChecklist?.[0].assemblyVisibility).toBe("occluded");
  expect(r.components[0].componentChecklist?.[1].assemblyVisibility).toBe("visible");
});
```

- [ ] **Step 4: Extend the addendum**

In `packages/backend/src/services/agent-multi-parser.ts`, find `DECOMPOSE_CHECKLIST_ADDENDUM` and append:

```typescript
const DECOMPOSE_CHECKLIST_ADDENDUM = `
${/* existing addendum content stays unchanged */ ""}

For each item, ALSO emit "assemblyVisibility":
  - "visible" if the feature remains externally visible in the final assembled object
    (e.g. external dimensions, port cutouts, surface features on the outer skin).
  - "occluded" if the feature is hidden inside the assembly or covered by other
    components (e.g. hollow interior of a case body once the lid is on, screw threads
    inside a tapped hole, PCB-mounting standoffs covered by the PCB).

Default to "visible" when unsure. The dispatcher uses this to skip VLM verification
for occluded items (visual evaluation cannot see hidden features) and rely on
code-eval instead.
`.trim();
```

**Implementer note:** the constant currently exists with content for componentChecklist's basic emission. Don't replace it wholesale — APPEND the new paragraph at the end. Read the existing constant and append rather than overwriting.

Export the constant so the test can import it:

```typescript
export const DECOMPOSE_CHECKLIST_ADDENDUM = `...`;
```

(May already be exported; verify.)

- [ ] **Step 5: Run tests**

```bash
docker compose exec -T backend npx vitest run src/__tests__/decompose-prompt-checklist.test.ts
```

Expected: PASS for new tests + all existing tests.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/agent-multi-parser.ts \
        packages/backend/src/__tests__/decompose-prompt-checklist.test.ts
git commit -m "Extend decomposition prompt with assemblyVisibility guidance (Phase 1)"
```

---

## Task 7: Phase 1 — dispatcher routing for occluded items

**Files:**
- Modify: `packages/backend/src/services/checklist-eval.service.ts`
- Test: `packages/backend/src/__tests__/checklist-eval.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/src/__tests__/checklist-eval.test.ts`:

```typescript
describe("runChecklistEval — assemblyVisibility occlusion routing", () => {
  const FAKE_IMG = { filename: "iso.png", contentBase64: "f" } as any;

  it("routes occluded visual-only items to code-only verification", async () => {
    const visualVerify = vi.fn();
    const codeVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "ok in code" });

    const r = await runChecklistEval({
      checklist: [
        {
          item: "Body interior is hollow",
          visibility: "visual",
          assemblyVisibility: "occluded",
        },
      ],
      code: "body = hollow_box(2)",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(visualVerify).not.toHaveBeenCalled();
    expect(codeVerify).toHaveBeenCalledTimes(1);
    expect(r.results[0].reasoning).toContain("occluded");
  });

  it("routes occluded both-visibility items to code-only", async () => {
    const visualVerify = vi.fn();
    const codeVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "wall_thickness=2" });

    const r = await runChecklistEval({
      checklist: [
        {
          item: "Wall thickness is 2mm",
          visibility: "both",
          assemblyVisibility: "occluded",
        },
      ],
      code: "wall_thickness = 2",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(visualVerify).not.toHaveBeenCalled();
    expect(codeVerify).toHaveBeenCalledTimes(1);
  });

  it("keeps visible visual items on VLM (unchanged behavior)", async () => {
    const visualVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "looks fine" });
    const codeVerify = vi.fn();

    await runChecklistEval({
      checklist: [
        {
          item: "Front face has 4 mounting holes",
          visibility: "visual",
          assemblyVisibility: "visible",
        },
      ],
      code: "",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(visualVerify).toHaveBeenCalledTimes(1);
    expect(codeVerify).not.toHaveBeenCalled();
  });

  it("annotates reasoning with [occluded] marker for downgraded items", async () => {
    const visualVerify = vi.fn();
    const codeVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "wall=2" });

    const r = await runChecklistEval({
      checklist: [
        {
          item: "Wall thickness is 2mm",
          visibility: "visual",
          assemblyVisibility: "occluded",
        },
      ],
      code: "wall = 2",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(r.results[0].reasoning).toMatch(/\[occluded — code-only/i);
  });

  it("does NOT annotate code-visibility items (never had visual to begin with)", async () => {
    const visualVerify = vi.fn();
    const codeVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "param=correct" });

    const r = await runChecklistEval({
      checklist: [
        {
          item: "Parameter is set",
          visibility: "code",
          assemblyVisibility: "occluded",
        },
      ],
      code: "x = 1",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(r.results[0].reasoning).not.toMatch(/\[occluded/);
  });

  it("backwards compat: items without assemblyVisibility treated as visible", async () => {
    const visualVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "ok" });
    const codeVerify = vi.fn();

    await runChecklistEval({
      checklist: [{ item: "x", visibility: "visual" }], // no assemblyVisibility
      code: "",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(visualVerify).toHaveBeenCalledTimes(1);
    expect(codeVerify).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
docker compose exec -T backend npx vitest run src/__tests__/checklist-eval.test.ts
```

Expected: 6 new tests FAIL (no routing implemented yet).

- [ ] **Step 3: Update the dispatcher**

In `packages/backend/src/services/checklist-eval.service.ts`, modify the per-item dispatch in `runChecklistEval`. Find the existing code that branches on `entry.visibility`:

```typescript
const wantVisual = entry.visibility === "visual" || entry.visibility === "both";
const wantCode = entry.visibility === "code" || entry.visibility === "both";
```

Replace with the occlusion-aware version:

```typescript
const isOccluded = entry.assemblyVisibility === "occluded";
const wantVisual = (entry.visibility === "visual" || entry.visibility === "both") && !isOccluded;
const wantCode = entry.visibility === "code"
              || entry.visibility === "both"
              || (isOccluded && entry.visibility === "visual");
```

- [ ] **Step 4: Annotate the reasoning text**

In the same per-item processing block, after the `combined` result is computed but before constructing the returned `ChecklistItemResult`, add:

```typescript
const occludedDowngrade = isOccluded && entry.visibility !== "code";
const annotatedReasoning = occludedDowngrade
  ? `[occluded — code-only verification] ${combined.reasoning}`
  : combined.reasoning;

return {
  index,
  item: entry.item,
  visibility: entry.visibility,
  verdict: combined.verdict,
  reasoning: annotatedReasoning,
};
```

(Adapt to the actual return-object construction in the existing code.)

- [ ] **Step 5: Run tests**

```bash
docker compose exec -T backend npx vitest run src/__tests__/checklist-eval.test.ts
```

Expected: all PASS (existing + 6 new).

- [ ] **Step 6: Rebuild backend container**

```bash
docker compose build backend && docker compose up -d backend
```

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/checklist-eval.service.ts \
        packages/backend/src/__tests__/checklist-eval.test.ts
git commit -m "Route occluded items to code-only verification + annotate reasoning (Phase 1)"
```

---

## Task 8: Smoke run — M3 screw recovery check

**Files:** none modified.

Verify Phase 1 actually fixes the M3 screw regression before running the full A/B.

- [ ] **Step 1: Identify the M3 screw prompt**

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT id, LEFT(prompt_text, 100) FROM workbench_example_prompts \
   WHERE id::text LIKE '2d902495%' OR prompt_text ILIKE '%m3 screw%' \
   LIMIT 5;"
```

Identify the prompt id. Confirm it's a multi-agent prompt (the spec said `2d902495` regressed –3.6 in v4 vs v3).

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

```bash
grep -rn "router.post\|routes.post\|\\.post(" /Users/daniel/src/github/kreuzhofer/chat3d-app/packages/backend/src/routes/admin/ | grep -iE "workbench.*generat|regenerat" | head -10
```

Adapt the curl call to the actual endpoint. Trigger regeneration for `2d902495...`.

- [ ] **Step 4: Wait for completion**

```bash
PROMPT_ID="<the M3 screw id>"
while true; do
  NEW=$(docker compose exec -T postgres psql -U postgres -d chat3d -t -c \
    "SELECT id FROM workbench_examples \
     WHERE prompt_id = '$PROMPT_ID' \
     AND created_at > NOW() - INTERVAL '15 minutes' \
     AND eval_score IS NOT NULL \
     ORDER BY created_at DESC LIMIT 1;" | xargs)
  if [ -n "$NEW" ]; then echo "Done: $NEW"; break; fi
  echo "Still generating..."
  sleep 30
done
```

- [ ] **Step 5: Inspect outcome**

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT id, eval_score, \
          jsonb_pretty(sub_agent_verifications) as sub_agent_verifications \
   FROM workbench_examples \
   WHERE prompt_id = '$PROMPT_ID' \
   ORDER BY created_at DESC LIMIT 1;"
```

Expected vs criteria:
- Eval score ≥ 5 (was 2.0 in v4, target 5.6 v3 baseline)
- `sub_agent_verifications` populated (carry-over from v2)

Also check the prompt's componentChecklist to see if any items got `assemblyVisibility: occluded`:

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT jsonb_pretty(decomposition->'components') \
   FROM generation_traces \
   WHERE id IN (SELECT trace_id FROM workbench_examples WHERE prompt_id = '$PROMPT_ID' ORDER BY created_at DESC LIMIT 1);"
```

Expected: at least some items in the JSON have `assemblyVisibility: "occluded"`. If zero items are annotated occluded, the prompt template isn't landing.

- [ ] **Step 6: Inspect logs for occlusion routing**

```bash
docker compose logs backend --since 15m 2>&1 | grep -iE "occluded|assembler checklist|submission rejected" | head -20
```

Expected: log lines confirming the gate ran. If the rejection messages reference items with the `[occluded — code-only verification]` annotation, the dispatcher is working.

- [ ] **Step 7: Decide based on outcome**

- If score ≥ 5: proceed to Task 9 (A/B)
- If score < 5 and decomposition has occluded items: dispatcher may not be wired correctly — investigate
- If score < 5 and decomposition has NO occluded items: prompt template needs sharpening — iterate before A/B

- [ ] **Step 8: Optional commit**

If notable findings, append to spec follow-ups. Otherwise skip.

---

## Task 9: A/B run — 30 prompts, v4 → v5

**Files:**
- Create: `docs/superpowers/specs/2026-06-06-phase0-phase1-test-results.md`

- [ ] **Step 1: Confirm v4 baseline TSV**

```bash
ls -la /tmp/eval-plan-v3-after.tsv /tmp/in-loop-eval-v4*.csv 2>/dev/null
```

v4 results are in `docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md`. Reference those scores as baseline.

- [ ] **Step 2: Trigger regeneration for all 30 test-set prompts**

Reuse the script pattern from the v2 A/B run (Task 7 of `2026-06-06-in-loop-semantic-eval-v2.md`).

- [ ] **Step 3: Wait for all 30 to complete**

Same poll pattern as v2 Task 7. ETA 45-90 min wall-clock with concurrency.

- [ ] **Step 4: Capture v5 metrics**

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT we.prompt_id, we.eval_score, we.composite_weight_source, p.requires_decomposition, \
          jsonb_pretty(we.sub_agent_verifications) as sub_agent_verifications \
   FROM workbench_examples we \
   JOIN workbench_example_prompts p ON we.prompt_id = p.id \
   WHERE we.prompt_id IN (...) \
   AND we.created_at > NOW() - INTERVAL '3 hours' \
   ORDER BY we.prompt_id;" > /tmp/phase1-v5.csv
```

Also capture occluded-item statistics:

```bash
docker compose exec -T postgres psql -U postgres -d chat3d -c \
  "SELECT we.prompt_id, \
          jsonb_array_length(jsonb_path_query_array(gt.decomposition, '\$.components[*].componentChecklist[*]')) as total_items, \
          jsonb_array_length(jsonb_path_query_array(gt.decomposition, '\$.components[*].componentChecklist[*] ? (@.assemblyVisibility == \"occluded\")')) as occluded_items \
   FROM workbench_examples we \
   JOIN generation_traces gt ON we.trace_id = gt.id \
   WHERE we.prompt_id IN (...) \
   AND we.created_at > NOW() - INTERVAL '3 hours' \
   ORDER BY we.prompt_id;" > /tmp/phase1-occlusion-stats.csv
```

- [ ] **Step 5: Write the results report**

Create `/Users/daniel/src/github/kreuzhofer/chat3d-app/docs/superpowers/specs/2026-06-06-phase0-phase1-test-results.md`:

```markdown
# Phase 0 + Phase 1 — A/B Test Results

Generated: 2026-06-06

## Setup

v4 (baseline): in-loop semantic eval v2 (assembler-side forced gate) — see
`docs/superpowers/specs/2026-06-06-in-loop-eval-test-results.md`.

v5 (treatment): v4 + Phase 0 hygiene (no expected effect on scoring) + Phase 1
assemblyVisibility annotation (occluded items routed to code-only).

## Phase 0 verification

- `SELECT pipeline_type, COUNT(*) FROM generation_traces GROUP BY 1`: <result>
- `SELECT COUNT(*) FROM generation_traces WHERE status='running'`: <result>
- `SELECT COUNT(*) FROM workbench_categories`: <result>
- `curl -s http://localhost/health`: <result snippet>

## M3 screw recovery (primary criterion)

| State | Score |
|---|---|
| v3 baseline | 5.6 |
| v4 (regression) | 2.0 |
| v5 (this run) | <X> |

Target: ≥ 5.0

## Per-bucket Δ (v4 → v5)

| Bucket | n | v4 mean | v5 mean | Δ | Target |
|---|---|---|---|---|---|
| Multi-agent | <N> | <M4> | <M5> | <Δ> | ≥ 0.0 (stretch: ≥ +0.2) |
| Single-agent | <N> | <M4> | <M5> | <Δ> | ≥ −0.2 |
| Overall | 30 | <M4> | <M5> | <Δ> | — |

## Annotation usage (criteria #4 + #5)

- Total componentChecklist items across multi-agent runs: <X>
- Items annotated occluded: <Y> (target: ≥ 15%)
- Occluded items returning UNCERTAIN: <Z> (target: < 50%)

## Cost

- Mean LLM cost per generation v4 vs v5: <c4> → <c5> (ratio <r>)

## Decision

<Ship / iterate / escalate to isolated rendering>

Reasoning:
- M3 screw recovery: <score> (target ≥ 5 → pass/fail)
- Multi-agent Δ: <X> (target ≥ 0 → pass/fail)
- % annotated occluded: <X%> (target ≥ 15% → pass/fail)
- % occluded UNCERTAIN: <X%> (target < 50% → pass/fail)
- Cost ratio: <r> (target ≤ 1.0 → pass/fail)
```

Fill in actual numbers.

- [ ] **Step 6: Commit results**

```bash
git add docs/superpowers/specs/2026-06-06-phase0-phase1-test-results.md
git commit -m "Phase 0 hygiene + Phase 1 occlusion routing A/B test results"
```

- [ ] **Step 7: Report back**

Summarize the decision (ship / iterate / escalate) with the criterion table for the user.

---

## Self-Review Notes

- **Spec coverage:** §Phase 0 hygiene → Tasks 1 (F4), 2 (F3), 3 (F10), 4 (F5). §Phase 1 → Tasks 5 (schema), 6 (prompt), 7 (dispatcher). §Sequence → ordering preserved (Phase 0 before Phase 1). §A/B → Tasks 8 (smoke) + 9 (A/B). Non-goals respected: no isolated rendering, no canonical scoring change, no KB work.
- **Placeholder scan:** Task 1 has an "Important" note about verifying Prisma field name and import path — this is a one-step grounding instruction (the engineer reads existing scripts to ground), not a missing requirement. Task 4 has similar grounding instructions (verify Prisma model name for trace link). Task 8/9 use `<PROMPT_ID>` placeholders that are filled in at runtime from the queries.
- **Type consistency:** `AssemblyVisibilityEnum`, `AssemblyVisibility`, `assemblyVisibility` used consistently across Tasks 5, 6, 7. `ComponentChecklistItem` schema extension stable. Existing test files extended (component-checklist.test.ts, checklist-eval.test.ts) preserve existing tests.
- **Risk:** Task 4 is the highest-risk single task — full cascade delete touches the database, file system, and the user's expectation of categories surviving. The dry-run-then-user-review-then-commit flow is the safety mechanism. Task 4 Step 4 explicitly pauses for user confirmation.
