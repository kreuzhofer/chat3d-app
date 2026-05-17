# Experiment UI Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the baseline (production-model) result to the experiment detail page in three places: (1) the visual comparison charts as another bar series, (2) the per-prompt comparison list with cost + duration rows in the baseline column, and (3) a new per-prompt bar-chart section (composite score / cost USD / duration) with one bar per prompt per model side-by-side and the baseline included.

**Architecture:** Backend widens `getExperimentComparison` and `getPerPromptComparison` to carry baseline cost + duration sourced from `generation_traces` joined to non-experiment auto-approved `workbench_examples`. Frontend extends `PromptBaseline`, the `BaselineCell` renderer, and `ComparisonCharts`; adds a new `PerPromptBarCharts` component using horizontal-scroll + sticky y-axis + sort toggle for ~100-bar density (this is the locked-in design decision from `docs/roadmap.md`).

**Tech Stack:** TypeScript strict mode, Prisma (raw SQL for aggregates), Vitest + supertest (integration), React 18 + Recharts, Tailwind. Linting via existing project config; no new dependencies.

**Design lock-in (from `docs/roadmap.md` "Near-Term: Experiment UI Enhancements"):** For Task 6's per-prompt bar charts with ~100 prompts, the layout is **horizontal-scrollable strip with sticky y-axis, hover tooltips, and a sort toggle (prompt-index | metric-desc)**. Heatmap variant deferred.

---

## File Structure

**Backend (modified):**
- `packages/backend/src/services/experiment-comparison.service.ts` — widen baseline SELECT in `getPerPromptComparison`; add `getExperimentBaselineMetrics()` helper and merge into `getExperimentComparison` payload.
- `packages/backend/src/__tests__/experiment-comparison.baseline.test.ts` — **new**, integration test for the widened payload.

**Frontend (modified):**
- `packages/frontend/src/api/experiment.api.ts` — extend `PromptBaseline` type with `costUsd` + `durationMs`; add `BaselineMetrics` type and thread it through `getExperimentComparison` return type.
- `packages/frontend/src/components/admin/ExperimentPromptComparisonTable.tsx` — extend `BaselineCell` to render cost + duration when present.
- `packages/frontend/src/components/admin/ExperimentDetailView.tsx` — `ComparisonCharts` prepends a baseline bar to each of the four charts; mount `<PerPromptBarCharts>` below the existing per-prompt table.

**Frontend (new):**
- `packages/frontend/src/components/admin/PerPromptBarCharts.tsx` — three Recharts BarCharts (score / cost / duration), horizontal-scroll strip with sticky y-axis, sort toggle, failed-prompt gap markers.

No DB migration. No Prisma schema changes (data sources already exist).

---

### Task 1: Backend — extend per-prompt baseline subquery with cost + duration

**Files:**
- Modify: `packages/backend/src/services/experiment-comparison.service.ts` (lines 287–326)

This widens the existing baseline raw-SQL SELECT to also pull `total_duration_ms` and `total_cost_usd` from `generation_traces`, and surfaces them on each per-prompt `baseline` object.

- [ ] **Step 1.1: Read the existing baseline subquery to confirm line numbers**

Run: `sed -n '287,326p' packages/backend/src/services/experiment-comparison.service.ts`
Expected: the `prisma.$queryRaw` block selecting `e.prompt_id, e.eval_score, e.visual_score, e.code_eval_score, t.total_steps, e.llm_model` followed by the `baselineMap` merge.

- [ ] **Step 1.2: Widen the SQL SELECT + result row type**

Edit `packages/backend/src/services/experiment-comparison.service.ts` lines 290–312. Replace the typed `prisma.$queryRaw<Array<{...}>>` block with:

```ts
const baselines = await prisma.$queryRaw<Array<{
  prompt_id: string;
  eval_score: number;
  visual_score: number | null;
  code_eval_score: number | null;
  total_steps: number | null;
  total_duration_ms: number | null;
  total_cost_usd: number | null;
  llm_model: string | null;
}>>`
  SELECT DISTINCT ON (e.prompt_id)
    e.prompt_id,
    e.eval_score,
    e.visual_score,
    e.code_eval_score,
    t.total_steps,
    t.total_duration_ms,
    t.total_cost_usd,
    e.llm_model
  FROM workbench_examples e
  LEFT JOIN generation_traces t ON t.workbench_example_id = e.id
  WHERE e.prompt_id = ANY(${promptIds}::uuid[])
    AND e.experiment_run_id IS NULL
    AND e.eval_score IS NOT NULL
    AND e.approval_status = 'auto_approved'
  ORDER BY e.prompt_id, e.eval_score DESC
`;
```

- [ ] **Step 1.3: Surface the new fields on each per-prompt baseline object**

Edit the same file, the `entry.baseline = { ... }` literal at lines 317–323. Replace with:

```ts
entry.baseline = {
  evalScore: Number(bl.eval_score),
  visualScore: bl.visual_score != null ? Number(bl.visual_score) : null,
  codeEvalScore: bl.code_eval_score != null ? Number(bl.code_eval_score) : null,
  totalSteps: bl.total_steps != null ? Number(bl.total_steps) : null,
  durationMs: bl.total_duration_ms != null ? Number(bl.total_duration_ms) : null,
  costUsd: bl.total_cost_usd != null ? Number(Number(bl.total_cost_usd).toFixed(6)) : null,
  llmModel: bl.llm_model,
};
```

Cost rounded to 6 decimals to match the convention used elsewhere in this file (see line 184).

- [ ] **Step 1.4: Build the backend and fix any tsc errors**

Run: `cd packages/backend && npm run build`
Expected: clean build. If tsc complains about the loose `entry.baseline` type, that's because the backend-private `PromptComparison` interface (lines 54–59) doesn't declare `baseline`. Add the optional field to the private interface so types stay honest:

```ts
interface PromptComparison {
  promptId: string;
  promptText: string;
  promptIndex: number;
  runs: PromptRunResult[];
  baseline?: {
    evalScore: number;
    visualScore: number | null;
    codeEvalScore: number | null;
    totalSteps: number | null;
    durationMs: number | null;
    costUsd: number | null;
    llmModel: string | null;
  };
}
```

- [ ] **Step 1.5: Commit**

```bash
git add packages/backend/src/services/experiment-comparison.service.ts
git commit -m "$(cat <<'EOF'
Include baseline cost + duration in per-prompt comparison payload

Widen the per-prompt baseline subquery to pull total_duration_ms and
total_cost_usd from generation_traces, mirroring the fields already
returned for experiment runs. Frontend baseline column can now show
parity with model columns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Backend — add baseline aggregate to `getExperimentComparison`

**Files:**
- Modify: `packages/backend/src/services/experiment-comparison.service.ts` (the existing `getExperimentComparison` function — read it to confirm the line range; it returns `{ runs }` today and we want `{ runs, baseline? }`)

This computes the baseline aggregate across the experiment's prompts (averaged best-non-experiment-auto-approved example per prompt) so the visual comparison charts can plot it as another bar series. The metric shape mirrors `RunMetrics` minus run-only fields (`runId`, `runOrder`, `fewShotCount`, `modelLabel` is replaced with the baseline's llm model string).

- [ ] **Step 2.1: Read `getExperimentComparison` to confirm structure**

Run: `grep -n "export async function getExperimentComparison\|^}" packages/backend/src/services/experiment-comparison.service.ts | head -20`
Expected: identifies the function start and the closing `}` so the next steps know where to insert.

- [ ] **Step 2.2: Add a `BaselineMetrics` interface near the top of the file**

In `packages/backend/src/services/experiment-comparison.service.ts`, immediately after the existing `RunMetrics` interface (around line 35), add:

```ts
interface BaselineMetrics {
  llmModel: string | null;
  totalPrompts: number;
  successCount: number;
  successRate: number;
  avgEvalScore: number | null;
  avgVisualScore: number | null;
  avgCodeEvalScore: number | null;
  avgDurationMs: number | null;
  avgCostUsd: number | null;
}
```

- [ ] **Step 2.3: Add a `getBaselineMetricsForExperiment(experimentId)` helper**

Append this helper inside the same file, between `getExperimentComparison` and `getPerPromptComparison` (placement keeps related code adjacent). The query picks the same "best non-experiment auto-approved example per prompt" set used per-prompt, then averages across all prompts belonging to the experiment's categories.

```ts
export async function getBaselineMetricsForExperiment(
  experimentId: string,
): Promise<BaselineMetrics | null> {
  // Prompt set for this experiment = the prompts the runs were executed against.
  // Source of truth: the experiment_run_examples (or equivalent) — we reuse the
  // same prompt set the per-prompt comparison sees, so the chart matches the table.
  const promptIds = await prisma.$queryRaw<Array<{ prompt_id: string }>>`
    SELECT DISTINCT e.prompt_id
    FROM workbench_examples e
    INNER JOIN experiment_runs r ON r.id = e.experiment_run_id
    WHERE r.experiment_id = ${experimentId}::uuid
  `;

  if (promptIds.length === 0) return null;

  const ids = promptIds.map(p => p.prompt_id);

  const rows = await prisma.$queryRaw<Array<{
    eval_score: number;
    visual_score: number | null;
    code_eval_score: number | null;
    total_duration_ms: number | null;
    total_cost_usd: number | null;
    llm_model: string | null;
  }>>`
    SELECT DISTINCT ON (e.prompt_id)
      e.eval_score,
      e.visual_score,
      e.code_eval_score,
      t.total_duration_ms,
      t.total_cost_usd,
      e.llm_model
    FROM workbench_examples e
    LEFT JOIN generation_traces t ON t.workbench_example_id = e.id
    WHERE e.prompt_id = ANY(${ids}::uuid[])
      AND e.experiment_run_id IS NULL
      AND e.eval_score IS NOT NULL
      AND e.approval_status = 'auto_approved'
    ORDER BY e.prompt_id, e.eval_score DESC
  `;

  if (rows.length === 0) return null;

  const avg = (vals: Array<number | null>) => {
    const nums = vals.filter((v): v is number => v != null);
    return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
  };

  // Pick most-frequent llm model string as the label.
  const labelCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.llm_model) labelCounts.set(r.llm_model, (labelCounts.get(r.llm_model) ?? 0) + 1);
  }
  const llmModel = [...labelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const avgCost = avg(rows.map(r => r.total_cost_usd != null ? Number(r.total_cost_usd) : null));

  return {
    llmModel,
    totalPrompts: promptIds.length,
    successCount: rows.length,
    successRate: rows.length / promptIds.length,
    avgEvalScore: avg(rows.map(r => Number(r.eval_score))),
    avgVisualScore: avg(rows.map(r => r.visual_score != null ? Number(r.visual_score) : null)),
    avgCodeEvalScore: avg(rows.map(r => r.code_eval_score != null ? Number(r.code_eval_score) : null)),
    avgDurationMs: avg(rows.map(r => r.total_duration_ms != null ? Number(r.total_duration_ms) : null)),
    avgCostUsd: avgCost != null ? Number(avgCost.toFixed(6)) : null,
  };
}
```

- [ ] **Step 2.4: Wire `baseline` into the `getExperimentComparison` return**

Locate the existing `return { runs };` in `getExperimentComparison` (find it with `grep -n "return { runs" packages/backend/src/services/experiment-comparison.service.ts`). Replace with:

```ts
const baseline = await getBaselineMetricsForExperiment(experimentId);
return { runs, baseline };
```

Make sure `experimentId` (or whatever the parameter is named in this function — verify when editing) matches the existing function signature.

- [ ] **Step 2.5: Build the backend**

Run: `cd packages/backend && npm run build`
Expected: clean build.

- [ ] **Step 2.6: Commit**

```bash
git add packages/backend/src/services/experiment-comparison.service.ts
git commit -m "$(cat <<'EOF'
Add baseline aggregate to experiment comparison payload

getExperimentComparison now returns { runs, baseline? } where baseline
is the aggregated production-model result across the same prompt set
the runs were evaluated against. Mirrors the per-prompt baseline so the
visual comparison charts can render baseline alongside trained variants.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3 (optional but recommended): Backend integration test for widened payload

**Files:**
- Create: `packages/backend/src/__tests__/experiment-comparison.baseline.test.ts`
- Test: same file

Asserts that with seeded fixture data (a prompt with one non-experiment auto-approved example + matching generation_trace, plus an experiment with one run), the per-prompt response carries `baseline.costUsd` + `baseline.durationMs`, and the aggregate response carries `baseline.avgCostUsd` + `baseline.avgDurationMs`.

**Why optional:** the manual smoke in Task 9 catches the same regressions on a real DB. The integration test pins the contract for future refactors but adds ~80 lines of test code. Skip if shipping speed matters more than future-proofing; do it if this payload shape is contract-stable now.

- [ ] **Step 3.1: Read the existing seeding template**

The test that already seeds the full `User → Category → Prompt → WorkbenchExample → GenerationTrace` chain is `packages/backend/src/__tests__/cleanup-examples.integration.test.ts`. Open it, locate the `beforeAll` block, and copy the seeding pattern. Adapt for our case by additionally creating `Experiment + ExperimentRun + a second WorkbenchExample whose experiment_run_id is set`. Use `prisma.experiment.create()` and `prisma.experimentRun.create()` with the minimum required fields visible from the Prisma schema — verify required-vs-optional from `packages/backend/prisma/schema.prisma`.

- [ ] **Step 3.2: Write the failing test (assertions first, seeding second)**

Create `packages/backend/src/__tests__/experiment-comparison.baseline.test.ts`. Start with this skeleton + assertions, then fill in the `beforeAll` seeding by adapting `cleanup-examples.integration.test.ts`:

```ts
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { prisma } from "../db/prisma.js";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const adminEmail = `exp-baseline-${suffix}@example.test`;
const password = "S3curePass!123";

interface LoginResponse { token: string; }

describe("experiment comparison — baseline cost + duration", () => {
  const app = createApp();
  let token = "";
  let adminId = "";
  let experimentId = "";
  let promptId = "";
  let runId = "";
  let baselineExampleId = "";
  let runExampleId = "";
  let traceId = "";
  let categoryId = "";

  beforeAll(async () => {
    // Admin user + login
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      create: { email: adminEmail, passwordHash, displayName: "Exp Baseline Admin", role: "admin", status: "active" },
      update: { passwordHash, role: "admin", status: "active", updatedAt: new Date() },
      select: { id: true },
    });
    adminId = admin.id;
    const login = await request(app).post("/api/auth/login").send({ email: adminEmail, password });
    token = (login.body as LoginResponse).token;

    // Category + prompt + baseline example + trace + experiment + run + run-example.
    // Use the cleanup-examples.integration.test.ts seeding pattern verbatim for the
    // first half (Category + Prompt + baseline WorkbenchExample + GenerationTrace),
    // then add the Experiment + ExperimentRun + a second WorkbenchExample with
    // experiment_run_id = runId. Required fields per schema.prisma:
    //   - WorkbenchExample.evalScore must be set (e.g. 8.5 for baseline, 7.0 for run)
    //   - WorkbenchExample.approvalStatus = "auto_approved" for baseline
    //   - WorkbenchExample.experimentRunId = null for baseline, = runId for run-example
    //   - GenerationTrace.totalCostUsd + totalDurationMs must be non-null on the baseline
    //   - Experiment.categoryIds includes categoryId; promptCount = 1
    //   - ExperimentRun.experimentId = experimentId; modelLabel = anything

    // Capture all IDs above into the let-bindings.
  });

  afterAll(async () => {
    // Tear down in reverse FK order:
    if (runExampleId) await prisma.workbenchExample.deleteMany({ where: { id: runExampleId } });
    if (baselineExampleId) await prisma.workbenchExample.deleteMany({ where: { id: baselineExampleId } });
    if (traceId) await prisma.generationTrace.deleteMany({ where: { id: traceId } });
    if (runId) await prisma.experimentRun.deleteMany({ where: { id: runId } });
    if (experimentId) await prisma.experiment.deleteMany({ where: { id: experimentId } });
    if (promptId) await prisma.workbenchExamplePrompt.deleteMany({ where: { id: promptId } });
    if (categoryId) await prisma.workbenchCategory.deleteMany({ where: { id: categoryId } });
    if (adminId) await prisma.user.deleteMany({ where: { id: adminId } });
  });

  it("GET /api/admin/experiments/:id/prompts includes baseline.costUsd and baseline.durationMs", async () => {
    const res = await request(app)
      .get(`/api/admin/experiments/${experimentId}/prompts`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const row = (res.body as Array<{ promptId: string; baseline?: { costUsd: number | null; durationMs: number | null } }>)
      .find(r => r.promptId === promptId);
    expect(row?.baseline).toBeTruthy();
    expect(row?.baseline?.costUsd).toBeGreaterThan(0);
    expect(row?.baseline?.durationMs).toBeGreaterThan(0);
  });

  it("GET /api/admin/experiments/:id/comparison includes baseline.avgCostUsd and baseline.avgDurationMs", async () => {
    const res = await request(app)
      .get(`/api/admin/experiments/${experimentId}/comparison`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = res.body as { runs: unknown[]; baseline?: { avgCostUsd: number | null; avgDurationMs: number | null } };
    expect(body.baseline).toBeTruthy();
    expect(body.baseline?.avgCostUsd).toBeGreaterThan(0);
    expect(body.baseline?.avgDurationMs).toBeGreaterThan(0);
  });
});
```

The exact model names (`WorkbenchExamplePrompt`, `WorkbenchCategory`) and required fields come from `packages/backend/prisma/schema.prisma` — verify before running. Adjust the `deleteMany` calls in `afterAll` if model names differ from the guesses above.

- [ ] **Step 3.3: Run the test, expect it to pass (the backend code from Tasks 1 + 2 already supports this)**

Run: `cd packages/backend && npx vitest run src/__tests__/experiment-comparison.baseline.test.ts`
Expected: 2/2 pass.

If a test fails:
- If `baseline` is undefined in the per-prompt response: confirm the seeded baseline `WorkbenchExample` matches the WHERE clause (`experiment_run_id IS NULL`, `eval_score IS NOT NULL`, `approval_status = 'auto_approved'`) AND that `GenerationTrace.workbenchExampleId` links to the baseline example, not the run example.
- If supertest returns 401: re-check the auth pattern matches `cleanup-examples.integration.test.ts`.
- If the aggregate `baseline` is null but per-prompt has one: the `getBaselineMetricsForExperiment` prompt-set query may not see the run-example. Ensure the second `WorkbenchExample.experimentRunId = runId` is committed before the test fires.

- [ ] **Step 3.4: Commit**

```bash
git add packages/backend/src/__tests__/experiment-comparison.baseline.test.ts
git commit -m "$(cat <<'EOF'
Test: baseline cost + duration in comparison endpoints

Asserts both the per-prompt and aggregate experiment comparison
endpoints surface baseline costUsd/durationMs (per-prompt) and
avgCostUsd/avgDurationMs (aggregate) when a seeded production-model
example with a generation_trace exists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Frontend types — extend `PromptBaseline`, add `BaselineMetrics`

**Files:**
- Modify: `packages/frontend/src/api/experiment.api.ts` (lines 112–118 for `PromptBaseline`; lines around 213–214 for `getExperimentComparison`'s return type)

- [ ] **Step 4.1: Extend `PromptBaseline`**

Edit `packages/frontend/src/api/experiment.api.ts` at lines 112–118. Replace the existing interface with:

```ts
export interface PromptBaseline {
  evalScore: number;
  visualScore: number | null;
  codeEvalScore: number | null;
  totalSteps: number | null;
  durationMs: number | null;
  costUsd: number | null;
  llmModel: string | null;
}
```

- [ ] **Step 4.2: Add `BaselineMetrics` type**

Immediately after the existing `RunMetrics` interface (around line 93), add:

```ts
export interface BaselineMetrics {
  llmModel: string | null;
  totalPrompts: number;
  successCount: number;
  successRate: number;
  avgEvalScore: number | null;
  avgVisualScore: number | null;
  avgCodeEvalScore: number | null;
  avgDurationMs: number | null;
  avgCostUsd: number | null;
}
```

- [ ] **Step 4.3: Update `getExperimentComparison` return type**

Find the existing `getExperimentComparison` wrapper (`grep -n "getExperimentComparison" packages/frontend/src/api/experiment.api.ts`). Replace its return type from `{ runs: RunMetrics[] }` to `{ runs: RunMetrics[]; baseline: BaselineMetrics | null }`. The runtime payload already carries this after Task 2.

- [ ] **Step 4.4: Build the frontend; fix any caller fallout**

Run: `cd packages/frontend && npm run build`
Expected: clean build. If any caller destructures `{ runs }` without acknowledging the new field, that's fine (additive) — tsc won't complain. If a caller pre-declares the response shape locally, update it.

- [ ] **Step 4.5: Commit**

```bash
git add packages/frontend/src/api/experiment.api.ts
git commit -m "$(cat <<'EOF'
Extend frontend experiment types with baseline cost/duration

Adds costUsd + durationMs to PromptBaseline and a new BaselineMetrics
type threaded through getExperimentComparison's return type. Matches
the widened backend payload from the prior two commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Frontend — render baseline cost + duration in `BaselineCell`

**Files:**
- Modify: `packages/frontend/src/components/admin/ExperimentPromptComparisonTable.tsx` (lines 61–78)

Parity with `ScoreCell` (which renders `{n}st $X.XXX Ys` on line 50–54). Baseline column gets the same row.

- [ ] **Step 5.1: Edit `BaselineCell`**

Replace the existing `BaselineCell` function (lines 61–78) with:

```tsx
function BaselineCell({ baseline }: { baseline?: PromptBaseline }) {
  if (!baseline) return <td className="p-2 text-center text-[hsl(var(--muted-foreground))]">—</td>;
  return (
    <td className="p-2 text-center">
      <span style={{ color: scoreColor(baseline.evalScore) }} className="text-[0.9rem] font-semibold">
        {baseline.evalScore.toFixed(1)}
      </span>
      <div className="flex justify-center gap-2 text-[0.65rem] text-[hsl(var(--muted-foreground))]">
        {baseline.visualScore != null && <span>vis:{baseline.visualScore.toFixed(1)}</span>}
        {baseline.codeEvalScore != null && <span>code:{baseline.codeEvalScore.toFixed(1)}</span>}
      </div>
      <div className="text-[0.65rem] text-[hsl(var(--muted-foreground))]">
        {baseline.totalSteps != null && <span>{baseline.totalSteps}st</span>}
        {baseline.costUsd != null && <span> ${baseline.costUsd.toFixed(3)}</span>}
        {baseline.durationMs != null && <span> {(baseline.durationMs / 1000).toFixed(0)}s</span>}
      </div>
      <div className="text-[0.65rem] text-[hsl(var(--muted-foreground))]">
        {baseline.llmModel && <span>{baseline.llmModel.split("/").pop()}</span>}
      </div>
    </td>
  );
}
```

Two visual changes vs. before:
1. New middle row carries `{steps}st ${cost} {sec}s` — same format as `ScoreCell`.
2. `llmModel` moved to its own fourth row so it doesn't crowd the cost/time row.

- [ ] **Step 5.2: Build the frontend**

Run: `cd packages/frontend && npm run build`
Expected: clean.

- [ ] **Step 5.3: Commit**

```bash
git add packages/frontend/src/components/admin/ExperimentPromptComparisonTable.tsx
git commit -m "$(cat <<'EOF'
Render baseline cost + duration in per-prompt comparison

BaselineCell now shows the same {steps}st \$cost {sec}s row that model
columns already render, giving the baseline column parity for visual
cost/latency comparison.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Frontend — include baseline as a bar in `ComparisonCharts`

**Files:**
- Modify: `packages/frontend/src/components/admin/ExperimentDetailView.tsx` (`ComparisonCharts` function, lines 315–387; also the parent that calls it — find the call site with `grep -n "ComparisonCharts" packages/frontend/src/components/admin/ExperimentDetailView.tsx`)

The four bar charts (Avg Eval Score, Success Rate %, Avg Cost USD, Avg Duration s) currently iterate `runs`. We prepend the baseline as one extra entry in `chartData` when a baseline is present, using a distinct color (`#6b7280` slate-500) so it reads as "reference line" rather than another run.

- [ ] **Step 6.1: Update `ComparisonCharts` signature**

Change the props from `{ runs: RunMetrics[] }` to `{ runs: RunMetrics[]; baseline: BaselineMetrics | null }`. Import `BaselineMetrics` at the top of the file alongside the existing `RunMetrics` import.

- [ ] **Step 6.2: Prepend baseline to `chartData`**

Replace the existing `chartData` construction (lines 316–323) with:

```tsx
const BASELINE_COLOR = "#6b7280"; // slate-500

const runEntries = runs.map((r, i) => ({
  name: r.modelLabel.split("/").pop() ?? r.modelLabel,
  evalScore: r.avgEvalScore ?? 0,
  successRate: (r.successRate ?? 0) * 100,
  avgCost: r.avgCostUsd ?? 0,
  avgDuration: r.avgDurationMs ? r.avgDurationMs / 1000 : 0,
  color: COLORS[i % COLORS.length],
}));

const baselineEntry = baseline
  ? [{
      name: `baseline${baseline.llmModel ? ` (${baseline.llmModel.split("/").pop()})` : ""}`,
      evalScore: baseline.avgEvalScore ?? 0,
      successRate: (baseline.successRate ?? 0) * 100,
      avgCost: baseline.avgCostUsd ?? 0,
      avgDuration: baseline.avgDurationMs ? baseline.avgDurationMs / 1000 : 0,
      color: BASELINE_COLOR,
    }]
  : [];

const chartData = [...baselineEntry, ...runEntries];
```

Baseline-first ordering keeps the reference value visually anchored at the left of each chart.

- [ ] **Step 6.3: Update the call site to pass baseline**

Open `ExperimentDetailView.tsx` and find where `<ComparisonCharts runs={...} />` is rendered. The data comes from `getExperimentComparison`'s return — destructure `baseline` alongside `runs` and pass both:

```tsx
<ComparisonCharts runs={comparison.runs} baseline={comparison.baseline} />
```

Adjust the local variable name if the existing code uses different naming (e.g. `data.runs`).

- [ ] **Step 6.4: Build the frontend**

Run: `cd packages/frontend && npm run build`
Expected: clean.

- [ ] **Step 6.5: Commit**

```bash
git add packages/frontend/src/components/admin/ExperimentDetailView.tsx
git commit -m "$(cat <<'EOF'
Include baseline as a reference bar in visual comparison charts

ComparisonCharts now prepends the baseline (production-model)
aggregate to each of the four bar charts (eval score, success rate,
cost, duration), rendered in slate-500 so it reads as a reference
value rather than another experiment run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Frontend — new `PerPromptBarCharts` component

**Files:**
- Create: `packages/frontend/src/components/admin/PerPromptBarCharts.tsx`

Three Recharts BarCharts (composite score / cost USD / duration). For each chart: one cluster of bars per prompt; within a cluster, one bar per (baseline + each model run). Failed prompts render as zero-height bars with a distinguishing `FailedBar` shape so they leave a gap that keeps the prompt-index axis aligned.

**Layout decision (locked from `docs/roadmap.md`):** horizontal-scrollable strip with sticky y-axis, hover tooltips, sort toggle (prompt index | metric desc). Each prompt cluster takes a fixed pixel width (`~80px` per cluster works well for ~100 prompts at ~8000px scroll width); the y-axis is rendered separately and pinned with `position: sticky` so the values stay readable as the user scrolls.

- [ ] **Step 7.1: Create the component skeleton**

Create `packages/frontend/src/components/admin/PerPromptBarCharts.tsx` with the props + sort-state scaffolding:

```tsx
/**
 * Per-prompt bar charts for experiment detail page.
 * Renders three stacked-by-prompt charts: composite score, cost USD, duration s.
 * One bar per (baseline + each run) per prompt. Failed prompts render as gap markers.
 * Layout: horizontal-scroll strip with sticky y-axis + sort toggle.
 */

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SectionCard } from "../layout/SectionCard";
import type { PromptComparison } from "../../api/experiment.api";

type SortMode = "prompt-index" | "score-desc" | "cost-desc" | "duration-desc";

interface Props {
  data: PromptComparison[];
}

const CLUSTER_WIDTH_PX = 80; // pixels per prompt cluster
const BASELINE_COLOR = "#6b7280";
const RUN_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

export function PerPromptBarCharts({ data }: Props) {
  const [sort, setSort] = useState<SortMode>("prompt-index");
  // ... implementation in next step
  return null;
}
```

- [ ] **Step 7.2: Build the sorted + flattened chart data**

Replace `// ... implementation in next step` with the data-shaping logic:

```tsx
// Collect distinct (runId, modelLabel) pairs across data; baseline always first.
const runOrder = useMemo(() => {
  const seen = new Map<string, string>();
  for (const row of data) {
    for (const r of row.runs) {
      if (!seen.has(r.runId)) seen.set(r.runId, r.modelLabel.split("/").pop() ?? r.modelLabel);
    }
  }
  return [...seen.entries()]; // [runId, shortLabel]
}, [data]);

const sorted = useMemo(() => {
  const arr = [...data];
  if (sort === "prompt-index") arr.sort((a, b) => a.promptIndex - b.promptIndex);
  else if (sort === "score-desc") arr.sort((a, b) => (avgScore(b) ?? -1) - (avgScore(a) ?? -1));
  else if (sort === "cost-desc") arr.sort((a, b) => (avgCost(b) ?? -1) - (avgCost(a) ?? -1));
  else arr.sort((a, b) => (avgDuration(b) ?? -1) - (avgDuration(a) ?? -1));
  return arr;
}, [data, sort]);

// One row in the recharts data array = one prompt cluster.
// Each row has a key per series: "baseline_<metric>", "<runId>_<metric>".
const chartRows = useMemo(() => sorted.map(row => {
  const out: Record<string, number | string | null> = {
    promptIndex: row.promptIndex,
    label: `#${row.promptIndex}`,
    baseline_score: row.baseline?.evalScore ?? null,
    baseline_cost: row.baseline?.costUsd ?? null,
    baseline_duration: row.baseline?.durationMs != null ? row.baseline.durationMs / 1000 : null,
  };
  for (const r of row.runs) {
    out[`${r.runId}_score`] = r.evalScore ?? null;
    out[`${r.runId}_cost`] = r.costUsd ?? null;
    out[`${r.runId}_duration`] = r.durationMs != null ? r.durationMs / 1000 : null;
  }
  return out;
}), [sorted]);

function avgScore(row: PromptComparison) {
  const vals = [row.baseline?.evalScore, ...row.runs.map(r => r.evalScore)].filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function avgCost(row: PromptComparison) {
  const vals = [row.baseline?.costUsd, ...row.runs.map(r => r.costUsd)].filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function avgDuration(row: PromptComparison) {
  const vals = [row.baseline?.durationMs, ...row.runs.map(r => r.durationMs)].filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
```

- [ ] **Step 7.3: Render the three charts inside a horizontal-scroll wrapper**

Append the JSX return (replacing the `return null;`):

```tsx
const stripWidth = Math.max(chartRows.length * CLUSTER_WIDTH_PX, 600);

return (
  <SectionCard title="Per-prompt Bar Charts">
    <div className="mb-3 flex items-center gap-2 text-xs">
      <span className="text-[hsl(var(--muted-foreground))]">Sort:</span>
      {(["prompt-index", "score-desc", "cost-desc", "duration-desc"] as SortMode[]).map(mode => (
        <button
          key={mode}
          onClick={() => setSort(mode)}
          className={`rounded px-2 py-0.5 ${sort === mode ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "border border-[hsl(var(--border))]"}`}
        >
          {mode}
        </button>
      ))}
    </div>

    {[
      { key: "score", title: "Composite Score (0–10)", yDomain: [0, 10] as [number, number], unit: "" },
      { key: "cost", title: "Cost (USD)", yDomain: ["auto", "auto"] as [string, string], unit: "$" },
      { key: "duration", title: "Duration (s)", yDomain: ["auto", "auto"] as [string, string], unit: "s" },
    ].map(metric => (
      <div key={metric.key} className="mb-4">
        <h4 className="mb-2 text-xs text-[hsl(var(--muted-foreground))]">{metric.title}</h4>
        <div className="flex">
          {/* Sticky y-axis: render an empty BarChart of fixed width holding only the axis. */}
          <div className="shrink-0" style={{ width: 60 }}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartRows.slice(0, 1)} margin={{ left: 0, right: 0, top: 0, bottom: 24 }}>
                <YAxis domain={metric.yDomain as never} tick={{ fontSize: 10, fill: "hsl(213 31% 70%)" }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Scrollable strip of clustered bars. */}
          <div className="overflow-x-auto">
            <div style={{ width: stripWidth }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartRows} margin={{ left: 0, right: 8, top: 0, bottom: 24 }} barGap={1}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 22%)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(213 31% 70%)" }} interval={Math.max(0, Math.floor(chartRows.length / 25) - 1)} />
                  <YAxis hide domain={metric.yDomain as never} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(222 47% 14%)", border: "1px solid hsl(217 33% 22%)", borderRadius: 6, color: "hsl(213 31% 91%)" }}
                    formatter={(value: number | null) => value == null ? "—" : `${metric.unit}${value.toFixed(metric.key === "cost" ? 4 : 2)}`}
                  />
                  <Bar dataKey={`baseline_${metric.key}`} fill={BASELINE_COLOR} name="baseline" />
                  {runOrder.map(([runId, label], i) => (
                    <Bar key={runId} dataKey={`${runId}_${metric.key}`} fill={RUN_COLORS[i % RUN_COLORS.length]} name={label} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    ))}
  </SectionCard>
);
```

Notes on the chosen approach:
- **Failed-prompt gap markers** fall out naturally: when a run failed, the per-prompt comparison row has `evalScore: null` and `costUsd/durationMs: null`, which become `null` in `chartRows`. Recharts renders `null` as a missing bar in the cluster, which is exactly the "empty bar / gap marker" the roadmap asked for.
- The sticky y-axis is implemented as a separate fixed-width container alongside the scrollable strip rather than a CSS `position: sticky` on a nested element, because Recharts manages its own SVG layout and `position: sticky` inside a scroll container would not anchor the YAxis component reliably.
- The X-axis `interval` prop thins tick labels for high prompt counts (showing every Nth `#index` so 100 prompts stay readable).

- [ ] **Step 7.4: Build the frontend**

Run: `cd packages/frontend && npm run build`
Expected: clean.

- [ ] **Step 7.5: Commit**

```bash
git add packages/frontend/src/components/admin/PerPromptBarCharts.tsx
git commit -m "$(cat <<'EOF'
Add per-prompt bar charts (score / cost / duration)

New component renders three Recharts BarCharts, one bar per
(baseline + each run) per prompt. Horizontal-scroll strip + sticky
y-axis + sort toggle (prompt index | metric desc), per the design
locked in docs/roadmap.md. Failed prompts render as gap markers via
null data points.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Mount `PerPromptBarCharts` into `ExperimentDetailView`

**Files:**
- Modify: `packages/frontend/src/components/admin/ExperimentDetailView.tsx` (around lines 91–122 where the other sub-sections render)

- [ ] **Step 8.1: Import the new component**

At the top of `ExperimentDetailView.tsx`, add:

```tsx
import { PerPromptBarCharts } from "./PerPromptBarCharts";
```

- [ ] **Step 8.2: Render below the existing per-prompt table**

Find the `<ExperimentPromptComparisonTable data={...} />` usage. Immediately after it, add:

```tsx
<PerPromptBarCharts data={perPromptData} />
```

(replace `perPromptData` with whatever local name holds the `PromptComparison[]` array — verify when editing).

- [ ] **Step 8.3: Build the frontend**

Run: `cd packages/frontend && npm run build`
Expected: clean.

- [ ] **Step 8.4: Commit**

```bash
git add packages/frontend/src/components/admin/ExperimentDetailView.tsx
git commit -m "$(cat <<'EOF'
Mount PerPromptBarCharts below per-prompt comparison table

Wires the new score/cost/duration bar charts into the experiment
detail page so reviewers can scan for outliers visually next to the
existing tabular view.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Manual smoke + rebuild docker

**Files:** none (manual verification)

- [ ] **Step 9.1: Rebuild and restart the affected containers**

Run (two-step per `CLAUDE.md`):
```bash
docker compose build backend frontend
docker compose up -d backend frontend
```

- [ ] **Step 9.2: Open the experiment detail page in a browser**

Navigate to an existing experiment that has runs *and* whose category has at least one non-experiment auto-approved baseline example. Verify:

1. **Visual Comparison section:** four charts now show a `baseline (xxx)` bar in slate-grey alongside the colored run bars.
2. **Per-prompt comparison table:** the baseline column shows a cost row (`$X.XXX`) and a duration row (`Ns`) where prior versions showed only score + visual + code.
3. **Per-prompt Bar Charts section (new):** three charts visible. Sort toggle (4 buttons) at the top works — click "score-desc" and confirm the highest-composite-score prompt clusters move to the left. Horizontal scroll works smoothly with ~100 prompts. Y-axis stays pinned. Failed prompts (if any) render as visible gaps in the cluster rather than zero-height bars stealing space.

- [ ] **Step 9.3: Hand off to Daniel**

If anything in Step 9.2 is wrong (wrong layout, baseline missing on an experiment that should have one, tooltip noise, axis labels overlapping), file a follow-up note in this plan or open a new short plan rather than over-engineering inline.

---

## Out of scope (deliberate)

- **Heatmap variant for #3:** noted as alternative in roadmap; not implemented unless the locked-in horizontal-scroll layout proves unreadable at 100 prompts. Easy to add later as a layout-mode toggle alongside `sort`.
- **Per-prompt cost/duration on the baseline column when no `generation_trace` exists for the baseline example:** the SELECT left-joins the trace, so missing traces yield `null` and the cells display `—` — no extra code needed.
- **Caching the baseline aggregate:** the query is small (≤100 prompts, one row each); add caching only if profiling shows it on the hot path.
- **Color customization for baseline-vs-runs:** slate-grey baseline + cycling RUN_COLORS is fixed. Theme override out of scope.
