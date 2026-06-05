# Per-Prompt Eval Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the eval pipeline derive its rubric, image selection, and composite weight from a per-prompt `evalPlan` emitted by the spec LLM, replacing the single static VLM template + global code weight + always-on ±4 clamp.

**Architecture:** The spec LLM gains one nested output `evalPlan = {systemPrompt, inspectionPlan, suggestedCodeWeight}` persisted on `workbench_example_prompts.eval_plan` (JSONB). Three downstream consumers (VLM prompt builder, image selector, composite weight resolver) read it when present and fall back to current legacy behaviour when null.

**Tech Stack:** TypeScript, Prisma (Postgres), Vercel AI SDK, vitest, Zod.

**Source spec:** `docs/superpowers/specs/2026-06-05-per-prompt-eval-plan-design.md`

---

## File Structure

**Backend — new:**
- `packages/backend/src/utils/eval-plan.ts` — `EvalPlan` type + Zod schema + parse/validate helpers (consumed by spec parser + consumers)
- `packages/backend/src/__tests__/eval-plan.test.ts` — vitest unit tests for the schema and parser
- `packages/backend/prisma/migrations/<timestamp>_eval_plan/migration.sql` — adds `eval_plan` JSONB on prompts + `composite_weight_source` on examples
- `packages/backend/scripts/eval-plan-test-set.ts` — selects ~30 prompts and writes IDs to a tracking file
- `packages/backend/scripts/eval-plan-ab-report.ts` — runs the A/B re-eval and writes the markdown report
- `packages/backend/src/__tests__/spec-generation-eval-plan.test.ts` — end-to-end test: spec LLM mock returns evalPlan; parseSpecResponse extracts it; persistSpecToPrompt writes it
- `packages/backend/src/__tests__/visual-eval-prompt-evalplan.test.ts` — covers the dynamic VLM prompt builder
- `packages/backend/src/__tests__/composite-eval-plan.test.ts` — covers the new weight resolver + clamp gating

**Backend — modified:**
- `packages/backend/prisma/schema.prisma` — `evalPlan Json?` on `WorkbenchExamplePrompt`; `compositeWeightSource String?` on `WorkbenchExample`
- `packages/backend/src/services/spec-generation.service.ts` — extend `SpecResult`, `SPEC_SYSTEM_PROMPT`, `parseSpecResponse`, `EMPTY_SPEC`
- `packages/backend/src/services/workbench-spec-persist.service.ts` — persist `evalPlan`
- `packages/backend/src/services/visual-eval-prompt.service.ts` — split static scaffolds + add dynamic branch
- `packages/backend/src/services/eval-orchestrator.service.ts` — pass `evalPlan` through; apply image filter; call new weight resolver
- `packages/backend/src/services/code-eval-composite.service.ts` — new `resolveCodeEvalWeight()` + `computeCompositeScore()` accepts override + threshold-gated clamp
- `packages/backend/src/services/workbench-persist.service.ts` — `insertExample` payload accepts `compositeWeightSource`
- `packages/backend/src/services/workbench-codegen.service.ts` — pass `compositeWeightSource` from composite result to insertExample

**Spec/docs — new (operational outputs):**
- `docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt` — 30 prompt IDs
- `docs/superpowers/specs/2026-06-05-eval-plan-test-results.md` — A/B markdown report

---

## Task 1: Schema migration

**Files:**
- Create: `packages/backend/prisma/migrations/20260605130000_eval_plan/migration.sql`
- Modify: `packages/backend/prisma/schema.prisma`

- [ ] **Step 1: Write the migration SQL**

Create `packages/backend/prisma/migrations/20260605130000_eval_plan/migration.sql`:

```sql
ALTER TABLE "workbench_example_prompts"
  ADD COLUMN "eval_plan" JSONB NULL;

CREATE INDEX "idx_wb_prompts_eval_plan_weight"
  ON "workbench_example_prompts" (((eval_plan->>'suggestedCodeWeight')::float))
  WHERE eval_plan IS NOT NULL;

COMMENT ON COLUMN "workbench_example_prompts"."eval_plan" IS
  'Per-prompt eval plan from spec LLM: {systemPrompt, inspectionPlan, suggestedCodeWeight}. Null = legacy global pipeline.';

ALTER TABLE "workbench_examples"
  ADD COLUMN "composite_weight_source" VARCHAR(20) NULL;

ALTER TABLE "workbench_examples"
  ADD CONSTRAINT "workbench_examples_composite_weight_source_check"
  CHECK (
    "composite_weight_source" IS NULL OR
    "composite_weight_source" IN ('eval_plan', 'adaptive', 'global')
  );

COMMENT ON COLUMN "workbench_examples"."composite_weight_source" IS
  'Which weight resolution branch produced this examples composite score.';
```

- [ ] **Step 2: Update schema.prisma**

In `packages/backend/prisma/schema.prisma`, find the `WorkbenchExamplePrompt` model (around line 407). After the `decompositionReasoning` field add:

```prisma
  evalPlan                Json?                          @map("eval_plan") @db.JsonB
```

In the `WorkbenchExample` model, immediately after `renderErrorDetail` (added by the prior PR), add:

```prisma
  compositeWeightSource String?  @map("composite_weight_source") @db.VarChar(20)
```

- [ ] **Step 3: Apply migration**

Run:
```bash
cd packages/backend
npm run db:migrate
```

Expected: `Applied migration: 20260605130000_eval_plan`.

- [ ] **Step 4: Verify columns exist**

Run:
```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -c \
  "\d workbench_example_prompts" | grep eval_plan
docker compose exec -T postgres psql -U chat3d -d chat3d -c \
  "\d workbench_examples" | grep composite_weight_source
```

Expected: rows showing `eval_plan jsonb` and `composite_weight_source character varying(20)`.

- [ ] **Step 5: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/prisma/migrations/20260605130000_eval_plan \
        packages/backend/prisma/schema.prisma
git commit -m "Add eval_plan JSONB and composite_weight_source columns"
```

---

## Task 2: EvalPlan type + Zod schema — failing test

**Files:**
- Create: `packages/backend/src/__tests__/eval-plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/eval-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EvalPlanSchema,
  parseEvalPlan,
  type EvalPlan,
  RENDER_ANGLE_NAMES,
} from "../utils/eval-plan.js";

describe("EvalPlanSchema", () => {
  const valid: EvalPlan = {
    systemPrompt: "Evaluate the rendered enclosure against the prompt's exact dimensions.",
    inspectionPlan: {
      angles: ["isometric", "back", "top"],
    },
    suggestedCodeWeight: 0.8,
  };

  it("accepts a valid plan with required fields only", () => {
    const result = EvalPlanSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts a plan with optional focus", () => {
    const plan = {
      ...valid,
      inspectionPlan: {
        angles: ["isometric_back"],
        focus: { isometric_back: "verify port cutouts on the +Y wall" },
      },
    };
    expect(EvalPlanSchema.safeParse(plan).success).toBe(true);
  });

  it("rejects empty systemPrompt", () => {
    expect(EvalPlanSchema.safeParse({ ...valid, systemPrompt: "" }).success).toBe(false);
  });

  it("rejects unknown angles", () => {
    const bad = { ...valid, inspectionPlan: { angles: ["close_up"] } };
    expect(EvalPlanSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects suggestedCodeWeight outside [0,1]", () => {
    expect(EvalPlanSchema.safeParse({ ...valid, suggestedCodeWeight: 1.5 }).success).toBe(false);
    expect(EvalPlanSchema.safeParse({ ...valid, suggestedCodeWeight: -0.1 }).success).toBe(false);
  });

  it("rejects focus keys that are not in angles", () => {
    const bad = {
      ...valid,
      inspectionPlan: {
        angles: ["top"],
        focus: { bottom: "stranger" },
      },
    };
    expect(EvalPlanSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty angles array", () => {
    expect(EvalPlanSchema.safeParse({ ...valid, inspectionPlan: { angles: [] } }).success).toBe(false);
  });
});

describe("parseEvalPlan", () => {
  it("returns the parsed plan when input is valid", () => {
    const plan = parseEvalPlan({
      systemPrompt: "x".repeat(50),
      inspectionPlan: { angles: ["front"] },
      suggestedCodeWeight: 0.5,
    });
    expect(plan).not.toBeNull();
    expect(plan?.suggestedCodeWeight).toBe(0.5);
  });

  it("returns null on invalid input (fail-open)", () => {
    expect(parseEvalPlan(null)).toBeNull();
    expect(parseEvalPlan(undefined)).toBeNull();
    expect(parseEvalPlan({})).toBeNull();
    expect(parseEvalPlan({ systemPrompt: "" })).toBeNull();
    expect(parseEvalPlan("garbage")).toBeNull();
  });
});

describe("RENDER_ANGLE_NAMES", () => {
  it("has exactly the 10 stored angles", () => {
    expect(new Set(RENDER_ANGLE_NAMES)).toEqual(new Set([
      "front", "back", "left", "right",
      "top", "bottom", "ortho_45", "ortho_45_bottom",
      "isometric", "isometric_back",
    ]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/eval-plan.test.ts
```

Expected: FAIL — `Cannot find module '../utils/eval-plan.js'`.

---

## Task 3: EvalPlan type + Zod schema — minimal implementation

**Files:**
- Create: `packages/backend/src/utils/eval-plan.ts`

- [ ] **Step 1: Write the implementation**

Create `packages/backend/src/utils/eval-plan.ts`:

```ts
/**
 * EvalPlan: the per-prompt evaluation directive emitted by the spec LLM and
 * consumed by the VLM prompt builder, image selector, and composite weight
 * resolver. Stored as JSONB on workbench_example_prompts.eval_plan.
 */
import { z } from "zod";

export const RENDER_ANGLE_NAMES = [
  "front", "back", "left", "right",
  "top", "bottom", "ortho_45", "ortho_45_bottom",
  "isometric", "isometric_back",
] as const;

export type RenderAngleName = (typeof RENDER_ANGLE_NAMES)[number];

const AngleEnum = z.enum(RENDER_ANGLE_NAMES);

export const EvalPlanSchema = z
  .object({
    systemPrompt: z.string().min(1, "systemPrompt must be non-empty"),
    inspectionPlan: z.object({
      angles: z.array(AngleEnum).min(1, "angles must be non-empty"),
      focus: z.record(z.string(), z.string()).optional(),
    }),
    suggestedCodeWeight: z.number().min(0).max(1),
  })
  .superRefine((plan, ctx) => {
    if (!plan.inspectionPlan.focus) return;
    const angleSet = new Set<string>(plan.inspectionPlan.angles);
    for (const key of Object.keys(plan.inspectionPlan.focus)) {
      if (!angleSet.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inspectionPlan", "focus", key],
          message: `focus key "${key}" is not listed in inspectionPlan.angles`,
        });
      }
    }
  });

export type EvalPlan = z.infer<typeof EvalPlanSchema>;

/**
 * Best-effort parse. Returns the validated plan or null on any failure.
 * Used at boundaries (JSON parsing from LLM response, DB row → object).
 */
export function parseEvalPlan(input: unknown): EvalPlan | null {
  const result = EvalPlanSchema.safeParse(input);
  return result.success ? result.data : null;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/eval-plan.test.ts
```

Expected: all tests passing.

- [ ] **Step 3: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/utils/eval-plan.ts \
        packages/backend/src/__tests__/eval-plan.test.ts
git commit -m "Add EvalPlan type, Zod schema, and parseEvalPlan helper"
```

---

## Task 4: Extend `SpecResult` and parse `evalPlan` from LLM response

**Files:**
- Modify: `packages/backend/src/services/spec-generation.service.ts`
- Create: `packages/backend/src/__tests__/spec-generation-eval-plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/spec-generation-eval-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSpecResponse } from "../services/spec-generation.service.js";

describe("parseSpecResponse evalPlan", () => {
  it("extracts a valid evalPlan when LLM returns it", () => {
    const json = JSON.stringify({
      interpretation: "x",
      verificationChecklist: [],
      codeAssertions: [],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
      requiresDecomposition: false,
      decompositionReasoning: "",
      evalPlan: {
        systemPrompt: "Verify dimensions visually.",
        inspectionPlan: { angles: ["isometric", "front"] },
        suggestedCodeWeight: 0.7,
      },
    });
    const parsed = parseSpecResponse(json);
    expect(parsed.evalPlan).not.toBeNull();
    expect(parsed.evalPlan?.suggestedCodeWeight).toBe(0.7);
    expect(parsed.evalPlan?.inspectionPlan.angles).toEqual(["isometric", "front"]);
  });

  it("returns null evalPlan when omitted by LLM", () => {
    const json = JSON.stringify({
      interpretation: "x",
      verificationChecklist: [],
      codeAssertions: [],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
      requiresDecomposition: false,
      decompositionReasoning: "",
    });
    const parsed = parseSpecResponse(json);
    expect(parsed.evalPlan).toBeNull();
  });

  it("returns null evalPlan when LLM returns malformed eval_plan (fail-open)", () => {
    const json = JSON.stringify({
      interpretation: "x",
      verificationChecklist: [],
      codeAssertions: [],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
      requiresDecomposition: false,
      decompositionReasoning: "",
      evalPlan: {
        systemPrompt: "",
        inspectionPlan: { angles: [] },
        suggestedCodeWeight: 2.5,
      },
    });
    const parsed = parseSpecResponse(json);
    expect(parsed.evalPlan).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/spec-generation-eval-plan.test.ts
```

Expected: FAIL — `evalPlan` property does not exist on the parse result type.

- [ ] **Step 3: Extend `SpecResult` and `parseSpecResponse`**

Open `packages/backend/src/services/spec-generation.service.ts`.

Add import near the existing utils imports at the top:
```ts
import { type EvalPlan, parseEvalPlan } from "../utils/eval-plan.js";
```

In the `SpecResult` interface (around line 52), add this field after `decompositionReasoning`:
```ts
  /** Per-prompt eval directive (system prompt + inspection plan + weight). Null when LLM omitted or malformed. */
  evalPlan: EvalPlan | null;
```

Find the `ParsedSpec` type (search for `interface ParsedSpec` or `type ParsedSpec`). Add the same field:
```ts
  evalPlan: EvalPlan | null;
```

Find `EMPTY_SPEC` (it's a `const` near the top). Add `evalPlan: null` to its initialisation.

Find `buildSpecFromParsed` (it composes the validated parsed object from a raw blob). Add:
```ts
  const evalPlan = parseEvalPlan((raw as Record<string, unknown>).evalPlan);
```
…and include `evalPlan` in the returned object.

In `parseSpecResponse`, the regex-fallback branch (around line 295-308) constructs a partial spec — add `evalPlan: null` to its returned object so the type stays satisfied.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/spec-generation-eval-plan.test.ts
```

Expected: all 3 passing. Also re-run any existing spec-generation tests to confirm no regressions:
```bash
npx vitest run src/__tests__/ -t "Spec"
```

- [ ] **Step 5: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/services/spec-generation.service.ts \
        packages/backend/src/__tests__/spec-generation-eval-plan.test.ts
git commit -m "Parse and surface evalPlan in SpecResult"
```

---

## Task 5: Extend the spec system prompt to request `evalPlan`

**Files:**
- Modify: `packages/backend/src/services/spec-generation.service.ts`

- [ ] **Step 1: Locate the spec system prompt**

In `packages/backend/src/services/spec-generation.service.ts`, find the `SPEC_SYSTEM_PROMPT` constant. It's a long template literal listing numbered output fields.

- [ ] **Step 2: Append the eval-plan guidance**

Add a new numbered item to the prompt template. Insert it AFTER the existing `decompositionReasoning` item (whatever number that is, append the next sequential number). The text:

```
N. **evalPlan**: A nested object describing how the rendered output should be evaluated.

   - **systemPrompt** (string, 800-2500 chars): A VLM system prompt tailored to THIS object. State what features it must verify visually vs which it should defer to code-eval. Call out occlusions, ambiguous angles, and prompt-specific calibration. Do NOT restate generic score bands or JSON output instructions — the runtime wraps them in. For sealed enclosures, explicitly say to defer interior features (standoffs, internal cutouts, lid-mating geometry) to code-eval. For visually salient features (vents, surface patterns, profiles), instruct the VLM to verify them directly.
   - **inspectionPlan.angles** (array of strings): The smallest sufficient set of render angles, chosen from: front, back, left, right, top, bottom, ortho_45, ortho_45_bottom, isometric, isometric_back. Use 3 angles for simple shapes; up to 8 for complex assemblies. Prefer isometric over orthographic when both could work.
   - **inspectionPlan.focus** (object, optional): Map of angle name → inspection note. Use only when one specific angle has a specific verification job. Example: { "isometric_back": "verify port cutouts on the +Y wall" }. Keys MUST be a subset of inspectionPlan.angles.
   - **suggestedCodeWeight** (number in [0,1]): How much the composite score should weight code-eval relative to VLM-eval. Use 0.2-0.4 when most checklist items are visual (vents, surface patterns, profiles). 0.5-0.7 for balanced prompts (dimensions + visual features). 0.8-0.95 for prompts where most features are dimensional, hidden, or inside the object (sealed enclosures, threaded bores, internal standoffs).

   Example for a sealed PCB enclosure:
   ```json
   {
     "systemPrompt": "Evaluate a 90×65×25mm sealed PCB enclosure with port cutouts on one short wall and four M2.5 standoffs inside. Verify visually: overall outer footprint, lid-vs-case dimensional parity, side-by-side display orientation. DEFER to code-eval: standoff positions, port cutout dimensions, interior wall thickness — all interior features are occluded in 7 of 8 outer views. Do not penalise the VLM for missing standoff details — they are not visible.",
     "inspectionPlan": {
       "angles": ["isometric", "isometric_back", "front", "top"],
       "focus": {
         "isometric_back": "verify the port-side wall and that all stated cutouts are visible"
       }
     },
     "suggestedCodeWeight": 0.85
   }
   ```

   Example for a simple primitive (block with hole):
   ```json
   {
     "systemPrompt": "Verify a rectangular block with one through-hole. Visually check the overall block proportions, the hole's position on the top face, and the hole's circularity. Dimensions are checked separately via code-eval.",
     "inspectionPlan": { "angles": ["isometric", "front", "top"] },
     "suggestedCodeWeight": 0.4
   }
   ```
```

Renumber any items that come after if needed (the existing template has a fixed numbering; adjust accordingly).

- [ ] **Step 3: Sanity-check the prompt renders correctly**

There's no automated test for prompt text; eyeball the file:
```bash
grep -A 60 "evalPlan" packages/backend/src/services/spec-generation.service.ts | head -80
```

Expected: the new section appears once, properly indented, with both example blocks intact.

- [ ] **Step 4: Run the existing spec-generation test suite to ensure nothing broke**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/ -t "spec"
```

Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/services/spec-generation.service.ts
git commit -m "Ask the spec LLM to emit an evalPlan per prompt"
```

---

## Task 6: Persist `evalPlan` in `persistSpecToPrompt`

**Files:**
- Modify: `packages/backend/src/services/workbench-spec-persist.service.ts`
- Create: `packages/backend/src/__tests__/workbench-spec-persist-eval-plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/workbench-spec-persist-eval-plan.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../db/prisma.js";
import { persistSpecToPrompt } from "../services/workbench-spec-persist.service.js";
import type { SpecResult } from "../services/spec-generation.service.js";
import type { EvalPlan } from "../utils/eval-plan.js";

describe("persistSpecToPrompt evalPlan", () => {
  let categoryId: string;
  let promptId: string;

  beforeEach(async () => {
    const nextRank = ((await prisma.workbenchCategory.aggregate({ _max: { rank: true } }))._max.rank ?? 0) + 1;
    const cat = await prisma.workbenchCategory.create({
      data: { name: `evalplan-persist-${Date.now()}-${nextRank}`, description: "", complexity: 1, rank: nextRank },
    });
    categoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({
      data: { categoryId, index: 1, prompt: "p" },
    });
    promptId = prompt.id;
  });

  function makeSpec(plan: EvalPlan | null): SpecResult {
    return {
      interpretation: "x",
      verificationChecklist: [],
      codeAssertions: [],
      disambiguationNeeded: false,
      disambiguationQuestions: [],
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
      requiresDecomposition: false,
      decompositionReasoning: "",
      complexity: "simple",
      promptTokens: 0,
      completionTokens: 0,
      evalPlan: plan,
    };
  }

  it("persists evalPlan as JSONB when present", async () => {
    const plan: EvalPlan = {
      systemPrompt: "test prompt",
      inspectionPlan: { angles: ["isometric"] },
      suggestedCodeWeight: 0.65,
    };
    await persistSpecToPrompt({
      promptId,
      specResult: makeSpec(plan),
      specCameFromNullDecompositionCache: false,
    });
    const row = await prisma.workbenchExamplePrompt.findUnique({ where: { id: promptId } });
    expect(row?.evalPlan).toEqual(plan as unknown);
  });

  it("persists null evalPlan when spec result has none", async () => {
    await persistSpecToPrompt({
      promptId,
      specResult: makeSpec(null),
      specCameFromNullDecompositionCache: false,
    });
    const row = await prisma.workbenchExamplePrompt.findUnique({ where: { id: promptId } });
    expect(row?.evalPlan).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/workbench-spec-persist-eval-plan.test.ts
```

Expected: FAIL — the update payload does not yet include `evalPlan`.

- [ ] **Step 3: Add `evalPlan` to the update payload**

Open `packages/backend/src/services/workbench-spec-persist.service.ts`. Inside the `data` block of the `prisma.workbenchExamplePrompt.update` call (around line 48), add a new line after `decompositionReasoning`:

```ts
        evalPlan: (specResult.evalPlan as unknown as undefined) ?? undefined,
```

Why the cast: Prisma's `Json?` field accepts `JsonValue`, but a typed `EvalPlan` object isn't recognised as such directly. `undefined` means "don't touch this field" which is what we want when the spec result has `null` — except we DO want `null` to override existing rows. So instead use:

```ts
        evalPlan: specResult.evalPlan === null
          ? null
          : (specResult.evalPlan as unknown as undefined),
```

This writes `null` when explicitly null and the actual object when present.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/workbench-spec-persist-eval-plan.test.ts
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/services/workbench-spec-persist.service.ts \
        packages/backend/src/__tests__/workbench-spec-persist-eval-plan.test.ts
git commit -m "Persist evalPlan on workbench_example_prompts"
```

---

## Task 7: Refactor `buildEvaluationSystemPrompt` to support a dynamic branch

**Files:**
- Modify: `packages/backend/src/services/visual-eval-prompt.service.ts`
- Create: `packages/backend/src/__tests__/visual-eval-prompt-evalplan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/visual-eval-prompt-evalplan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildEvaluationSystemPrompt } from "../services/visual-eval-prompt.service.js";
import type { EvalPlan } from "../utils/eval-plan.js";

const fakeChecklist = ["Does the block have a hole?"];
const fakeAngles = ["front", "top", "isometric"];

describe("buildEvaluationSystemPrompt", () => {
  it("uses legacy template when evalPlan is null", () => {
    const text = buildEvaluationSystemPrompt({
      userPrompt: "A block with a hole",
      categoryName: "Primitives",
      complexity: 1,
      checklist: fakeChecklist,
      hasZoomTool: false,
      providedAngles: fakeAngles,
      constructionSpec: "",
      evalPreamble: "",
      evalPlan: null,
    });
    // Legacy template mentions the category name in the rubric line
    expect(text).toContain("Category: Primitives");
  });

  it("uses dynamic block when evalPlan.systemPrompt is set", () => {
    const plan: EvalPlan = {
      systemPrompt: "DYNAMIC_MARKER_XYZ verify the block.",
      inspectionPlan: { angles: ["front"] },
      suggestedCodeWeight: 0.5,
    };
    const text = buildEvaluationSystemPrompt({
      userPrompt: "A block with a hole",
      categoryName: "Primitives",
      complexity: 1,
      checklist: fakeChecklist,
      hasZoomTool: false,
      providedAngles: fakeAngles,
      constructionSpec: "",
      evalPreamble: "",
      evalPlan: plan,
    });
    expect(text).toContain("DYNAMIC_MARKER_XYZ");
    // Static scaffolds still appear
    expect(text).toMatch(/score|rubric/i); // score band scaffold
    expect(text).toContain("JSON"); // JSON output scaffold
    // Legacy category line should NOT appear in dynamic mode
    expect(text).not.toContain("Category: Primitives");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/visual-eval-prompt-evalplan.test.ts
```

Expected: FAIL — `evalPlan` is not a known argument of `buildEvaluationSystemPrompt`.

- [ ] **Step 3: Refactor the prompt builder**

Open `packages/backend/src/services/visual-eval-prompt.service.ts`.

Convert the existing `buildEvaluationSystemPrompt(positional args)` to accept a single options object. Define the options type at the top of the file:

```ts
import type { EvalPlan } from "../utils/eval-plan.js";

export interface BuildEvalPromptOptions {
  userPrompt: string;
  categoryName: string;
  complexity: number;
  checklist: string[];
  hasZoomTool: boolean;
  providedAngles: string[];
  constructionSpec: string;
  evalPreamble: string;
  evalPlan: EvalPlan | null;
}
```

Update the export signature:
```ts
export function buildEvaluationSystemPrompt(opts: BuildEvalPromptOptions): string {
  if (opts.evalPlan?.systemPrompt) {
    return [
      buildStaticHeader(opts),
      opts.evalPlan.systemPrompt,
      buildStaticFooter(opts),
    ].join("\n\n");
  }
  return buildLegacyPrompt(opts);
}
```

Add two private helpers extracted from the existing body. They contain whatever the existing function currently produces split at the seams between "header (role + image preamble + anti-hallucination)", "middle (rubric, occlusion warnings, score bands)", and "footer (JSON output schema, zoom-tool affordance)":

```ts
function buildStaticHeader(opts: BuildEvalPromptOptions): string {
  // Role definition, image-list preamble, anti-hallucination guard, cross-view evidence instruction.
  // Copy verbatim from the existing function's first paragraph(s).
  return [
    `You are a visual evaluator inspecting rendered 3D-model screenshots.`,
    `You will be shown ${opts.providedAngles.length} angle(s): ${opts.providedAngles.join(", ")}.`,
    `Do not hallucinate features that are not visible. Use evidence from multiple views when claims are ambiguous.`,
  ].join("\n");
}

function buildStaticFooter(opts: BuildEvalPromptOptions): string {
  // Score bands (5 levels), JSON output schema, zoom-tool affordance.
  // Copy verbatim from the existing function's tail.
  const scoreBands = [
    `Score 1-3: failed render or wrong object.`,
    `Score 4-5: recognisable shape but major features missing or wrong.`,
    `Score 6-7: most features present, minor visual issues.`,
    `Score 8-9: clean render, all stated features visible and correct.`,
    `Score 10: perfect.`,
  ].join("\n");
  const zoomLine = opts.hasZoomTool
    ? "If any single criterion is uncertain, call the zoom tool for a closer look before scoring."
    : "";
  const jsonSchema = [
    `Respond with JSON:`,
    `{`,
    `  "overallScore": <1-10>,`,
    `  "perCriterion": [{ "question": "...", "answer": "yes" | "no" | "uncertain", "evidence": "..." }],`,
    `  "issues": ["..."],`,
    `  "suggestions": ["..."]`,
    `}`,
  ].join("\n");
  return [scoreBands, zoomLine, jsonSchema].filter(Boolean).join("\n\n");
}

function buildLegacyPrompt(opts: BuildEvalPromptOptions): string {
  // The existing monolithic prompt body, copied verbatim from the current function.
  // Includes: header, "Category: X" line, complexity, checklist enumeration,
  // generic occlusion warnings, score bands, JSON schema, zoom-tool note.
  // (For the engineer: open the current file, copy the full body of the
  // existing buildEvaluationSystemPrompt into this function, only renaming
  // any references from positional args to opts.*.)
  // ...
}
```

Update every caller of `buildEvaluationSystemPrompt` to pass an options object instead of positional args. Find them via:

```bash
grep -rn "buildEvaluationSystemPrompt" packages/backend/src --include="*.ts"
```

Each call site adds `evalPlan: <plan or null>` to the args. For now, every call site passes `null` (we'll thread the actual value through in Task 9).

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/visual-eval-prompt-evalplan.test.ts
npx vitest run
```

Expected: the 2 new tests pass; all existing tests still pass (other call sites of `buildEvaluationSystemPrompt` now use the options-object API).

- [ ] **Step 5: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/services/visual-eval-prompt.service.ts \
        packages/backend/src/__tests__/visual-eval-prompt-evalplan.test.ts
# Plus any other files where call sites were updated:
git add packages/backend/src/services/eval-orchestrator.service.ts || true
git add packages/backend/src/services/visual-eval.service.ts || true
git commit -m "Add dynamic-prompt branch and options object to buildEvaluationSystemPrompt"
```

---

## Task 8: Inspection-plan angle filter + per-angle focus labels

**Files:**
- Modify: `packages/backend/src/services/eval-orchestrator.service.ts`

- [ ] **Step 1: Locate the image-selection block**

Open `packages/backend/src/services/eval-orchestrator.service.ts`. Find lines 310-326 (the block that filters images via `criticalAngles` returned by the code reviewer).

- [ ] **Step 2: Add the inspection-plan precondition filter**

Replace the existing image-selection logic with:

```ts
import { RENDER_ANGLE_NAMES, type EvalPlan } from "../utils/eval-plan.js";

// ...

const allAngles: string[] = [...RENDER_ANGLE_NAMES];
const candidateAngles = evalPlan?.inspectionPlan?.angles ?? allAngles;

const filteredAngles =
  criticalAngles && criticalAngles.length > 0
    ? candidateAngles.filter((a) => criticalAngles.includes(a))
    : candidateAngles;

// Defensive: if the intersection is empty (shouldn't happen) fall back to the spec's set.
const finalAngles = filteredAngles.length > 0 ? filteredAngles : candidateAngles;

// Build per-angle labels: prepend focus note when set
const focus = evalPlan?.inspectionPlan?.focus ?? {};
const labelledAngles = finalAngles.map((angle) => ({
  angle,
  label: focus[angle] ? `[${angle}] ${focus[angle]}` : `[${angle}]`,
}));
```

`labelledAngles` replaces wherever the existing code used a flat `string[]` of angle names. Where the screenshots are turned into VLM `image_url` parts, pull the `label` into the part's `text` adjacent to it.

- [ ] **Step 3: Wire `evalPlan` through to this block**

The orchestrator needs to know the prompt's `evalPlan`. Read it from `workbench_example_prompts.eval_plan` near where the existing code reads the prompt's checklist or criteria. Add:

```ts
import { parseEvalPlan } from "../utils/eval-plan.js";

// Near where prompt fields are loaded:
const promptRow = await prisma.workbenchExamplePrompt.findUnique({
  where: { id: promptId },
  select: {
    // ... existing fields ...
    evalPlan: true,
  },
});
const evalPlan = parseEvalPlan(promptRow?.evalPlan ?? null);
```

Pass `evalPlan` into `buildEvaluationSystemPrompt({ ..., evalPlan })` and into the image-selection block above.

- [ ] **Step 4: Add an integration test**

The orchestrator has existing tests. Add to `packages/backend/src/__tests__/eval-orchestrator.test.ts` (or its existing analog if differently named) a case where `evalPlan` filters to a 2-angle subset:

```ts
it("filters images to the inspection plans angles when evalPlan is set", async () => {
  const plan = {
    systemPrompt: "test",
    inspectionPlan: { angles: ["isometric", "front"] },
    suggestedCodeWeight: 0.6,
  };
  // ... mock setup that asserts the VLM call received exactly 2 images
});
```

If no orchestrator test file exists, skip this step — the dynamic-prompt test in Task 7 covers the boundary. Note that as DONE_WITH_CONCERNS.

- [ ] **Step 5: Run the full backend suite**

Run:
```bash
cd packages/backend
npx vitest run
```

Expected: no regressions; new orchestrator test (if added) passes.

- [ ] **Step 6: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/services/eval-orchestrator.service.ts \
        packages/backend/src/__tests__/eval-orchestrator.test.ts 2>/dev/null || true
git commit -m "Filter VLM images by evalPlan.inspectionPlan; prepend focus labels"
```

---

## Task 9: Composite weight resolver — failing test

**Files:**
- Create: `packages/backend/src/__tests__/composite-eval-plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/__tests__/composite-eval-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  resolveCodeEvalWeight,
  computeCompositeScore,
} from "../services/code-eval-composite.service.js";
import type { EvalPlan } from "../utils/eval-plan.js";

describe("resolveCodeEvalWeight", () => {
  const annotatedCriteria = null;

  it("returns evalPlan.suggestedCodeWeight when present", () => {
    const plan: EvalPlan = {
      systemPrompt: "x",
      inspectionPlan: { angles: ["front"] },
      suggestedCodeWeight: 0.85,
    };
    const r = resolveCodeEvalWeight({
      globalDefault: 0.4,
      evalPlan: plan,
      annotatedCriteria,
      adaptiveWeightRange: 0.2,
    });
    expect(r.weight).toBe(0.85);
    expect(r.source).toBe("eval_plan");
  });

  it("clamps suggestedCodeWeight to [0, 1]", () => {
    const plan: EvalPlan = {
      systemPrompt: "x",
      inspectionPlan: { angles: ["front"] },
      // @ts-expect-error - intentionally testing runtime clamp
      suggestedCodeWeight: 1.7,
    };
    expect(resolveCodeEvalWeight({ globalDefault: 0.4, evalPlan: plan, annotatedCriteria, adaptiveWeightRange: 0.2 }).weight).toBe(1);
  });

  it("falls back to adaptive when evalPlan is null and criteria are annotated", () => {
    const criteria = [{ description: "x", visibility: "code" as const }];
    const r = resolveCodeEvalWeight({
      globalDefault: 0.4,
      evalPlan: null,
      annotatedCriteria: criteria,
      adaptiveWeightRange: 0.2,
    });
    expect(r.source).toBe("adaptive");
  });

  it("falls back to global when both evalPlan and annotated criteria are null", () => {
    const r = resolveCodeEvalWeight({
      globalDefault: 0.4,
      evalPlan: null,
      annotatedCriteria: null,
      adaptiveWeightRange: 0.2,
    });
    expect(r.weight).toBe(0.4);
    expect(r.source).toBe("global");
  });
});

describe("computeCompositeScore clamp gating", () => {
  it("applies the ±4 clamp at low effective weight", () => {
    // visual=8, code=2: |gap| >= 4 → clamp at min+1 = 3
    const r = computeCompositeScore(8, 2, null, 0.4 /* low */);
    expect(r.compositeScore).toBeLessThanOrEqual(3);
  });

  it("does NOT apply the ±4 clamp when effective weight >= 0.75", () => {
    // visual=8, code=2, code-weight=0.8 → weighted = 8*0.2 + 2*0.8 = 3.2; clamp would force ≤3
    const r = computeCompositeScore(8, 2, null, 0.8);
    expect(r.compositeScore).toBeCloseTo(3.2, 1);
  });

  it("still applies the clamp at code-weight exactly below threshold (0.74)", () => {
    const r = computeCompositeScore(8, 2, null, 0.74);
    expect(r.compositeScore).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/composite-eval-plan.test.ts
```

Expected: FAIL — `resolveCodeEvalWeight` is not exported.

---

## Task 10: Composite weight resolver — minimal implementation

**Files:**
- Modify: `packages/backend/src/services/code-eval-composite.service.ts`

- [ ] **Step 1: Add the resolver**

Open `packages/backend/src/services/code-eval-composite.service.ts`. Add near the top:

```ts
import type { EvalPlan } from "../utils/eval-plan.js";

export const HIGH_CODE_WEIGHT_THRESHOLD = 0.75;

export interface ResolvedWeight {
  weight: number;
  source: "eval_plan" | "adaptive" | "global";
}

export interface ResolveCodeEvalWeightArgs {
  globalDefault: number;
  evalPlan: EvalPlan | null;
  annotatedCriteria: AnnotatedCriterion[] | null;
  adaptiveWeightRange: number;
}

export function resolveCodeEvalWeight(args: ResolveCodeEvalWeightArgs): ResolvedWeight {
  if (args.evalPlan && typeof args.evalPlan.suggestedCodeWeight === "number") {
    const clamped = Math.max(0, Math.min(1, args.evalPlan.suggestedCodeWeight));
    return { weight: clamped, source: "eval_plan" };
  }
  if (args.annotatedCriteria && args.annotatedCriteria.length > 0) {
    return {
      weight: computeAdaptiveWeight(
        args.globalDefault,
        args.adaptiveWeightRange,
        args.annotatedCriteria,
      ),
      source: "adaptive",
    };
  }
  return { weight: args.globalDefault, source: "global" };
}
```

- [ ] **Step 2: Gate the ±4 clamp on effective weight in `computeCompositeScore`**

Find the existing clamp logic (around line 114-117):
```ts
// If visual and code strongly disagree, take the lower score
if (Math.abs(visualScore! - codeScore!) >= 4) {
  const lower = Math.min(visualScore!, codeScore!);
  composite = Math.min(composite, round1(lower + 1));
}
```

Wrap it in the threshold check:
```ts
if (effectiveWeight < HIGH_CODE_WEIGHT_THRESHOLD && Math.abs(visualScore! - codeScore!) >= 4) {
  const lower = Math.min(visualScore!, codeScore!);
  composite = Math.min(composite, round1(lower + 1));
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/composite-eval-plan.test.ts
npx vitest run src/__tests__/code-eval-composite.service.test.ts
```

Expected: the new tests pass; existing composite tests still pass (the clamp still fires at the legacy 0.4 weight which is < 0.75).

- [ ] **Step 4: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/services/code-eval-composite.service.ts \
        packages/backend/src/__tests__/composite-eval-plan.test.ts
git commit -m "Add resolveCodeEvalWeight and gate ±4 clamp on effective weight"
```

---

## Task 11: Wire the weight resolver and persist `compositeWeightSource`

**Files:**
- Modify: `packages/backend/src/services/eval-orchestrator.service.ts`
- Modify: `packages/backend/src/services/workbench-persist.service.ts`
- Modify: `packages/backend/src/services/workbench-codegen.service.ts`

- [ ] **Step 1: Update the orchestrator's weight call**

In `packages/backend/src/services/eval-orchestrator.service.ts`, find where `getCodeEvalWeight(pipeline)` is currently called (line 44 and any other call sites). Replace with:

```ts
import { resolveCodeEvalWeight, type ResolvedWeight } from "./code-eval-composite.service.js";

const globalDefault = await getCodeEvalWeight(pipeline);
const resolved: ResolvedWeight = resolveCodeEvalWeight({
  globalDefault,
  evalPlan,                    // from Task 8
  annotatedCriteria,           // already loaded
  adaptiveWeightRange: 0.2,    // existing constant
});
```

Then pass `resolved.weight` into `computeCompositeScore(...)` where the existing code passed the per-pipeline weight, and carry `resolved.source` through to wherever the orchestrator returns its result.

- [ ] **Step 2: Surface `compositeWeightSource` on the orchestrator's return**

The orchestrator already returns a result object containing `source` (the visual/code/composite kind) at line 117/442 etc. Add another field:

```ts
return {
  // ... existing fields ...
  source: result.source,
  compositeWeightSource: resolved.source,
};
```

Update the return type (search for the result interface near the top of the file) to include `compositeWeightSource: "eval_plan" | "adaptive" | "global" | null`.

- [ ] **Step 3: Extend `insertExample` with the new field**

In `packages/backend/src/services/workbench-persist.service.ts`, find the `insertExample` data type (around line 16). Add:

```ts
  compositeWeightSource?: string | null;
```

In both the `create` and `update` blocks of the upsert, add (right after `evalSource: data.evalSource ?? null,`):

```ts
      compositeWeightSource: data.compositeWeightSource ?? null,
```

- [ ] **Step 4: Wire the orchestrator's return through to `insertExample`**

In `packages/backend/src/services/workbench-codegen.service.ts`, find the `insertExample({...})` call (it was extended for `renderErrorCategory` in the prior PR). Add `compositeWeightSource` from the orchestrator's return:

```ts
    compositeWeightSource: agFullEval?.compositeWeightSource ?? fixEval?.compositeWeightSource ?? null,
```

The exact field name from the orchestrator's return is whatever Step 2 defines; use the same name.

- [ ] **Step 5: Add a persistence test**

Create `packages/backend/src/__tests__/workbench-persist-composite-source.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../db/prisma.js";
import { insertExample } from "../services/workbench-persist.service.js";

describe("insertExample compositeWeightSource", () => {
  let promptId: string;
  let categoryId: string;
  let id: string;

  beforeEach(async () => {
    const nextRank = ((await prisma.workbenchCategory.aggregate({ _max: { rank: true } }))._max.rank ?? 0) + 1;
    const cat = await prisma.workbenchCategory.create({
      data: { name: `cws-test-${Date.now()}-${nextRank}`, description: "", complexity: 1, rank: nextRank },
    });
    categoryId = cat.id;
    const prompt = await prisma.workbenchExamplePrompt.create({ data: { categoryId, index: 1, prompt: "p" } });
    promptId = prompt.id;
    id = crypto.randomUUID();
  });

  it("persists compositeWeightSource when provided", async () => {
    await insertExample({
      id, promptId, iteration: 1, code: "x",
      renderStatus: "success", renderError: null,
      compositeWeightSource: "eval_plan",
      stlPath: null, stepPath: null, threemfPath: null,
      screenshotFront: null, screenshotBack: null, screenshotLeft: null, screenshotRight: null,
      screenshotTop: null, screenshotBottom: null, screenshotOrtho45: null,
      screenshotOrtho45Bottom: null, screenshotIso: null, screenshotIsoBack: null,
      evalScore: 8, evalIssues: null, evalSuggestions: null, evalChecklistResults: null,
      approvalStatus: "auto_approved",
      llmModel: "m", vlmModel: null,
      promptTokens: 0, completionTokens: 0,
    });
    const row = await prisma.workbenchExample.findUnique({ where: { id } });
    expect(row?.compositeWeightSource).toBe("eval_plan");
  });
});
```

- [ ] **Step 6: Run tests + full suite**

Run:
```bash
cd packages/backend
npx vitest run src/__tests__/workbench-persist-composite-source.test.ts
npx vitest run
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/src/services/eval-orchestrator.service.ts \
        packages/backend/src/services/workbench-persist.service.ts \
        packages/backend/src/services/workbench-codegen.service.ts \
        packages/backend/src/__tests__/workbench-persist-composite-source.test.ts
git commit -m "Persist compositeWeightSource per example via insertExample"
```

---

## Task 12: Pick the A/B test set

**Files:**
- Create: `packages/backend/scripts/eval-plan-test-set.ts`
- Create: `docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt`

- [ ] **Step 1: Write the selection script**

Create `packages/backend/scripts/eval-plan-test-set.ts`:

```ts
/**
 * One-shot script: picks ~30 prompt IDs spanning the dimensions defined in the
 * spec's A/B test methodology section. Writes the IDs (one per line) to
 * docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt.
 *
 * Run with: npx tsx scripts/eval-plan-test-set.ts
 */
import { prisma } from "../src/db/prisma.js";
import { writeFileSync } from "fs";
import { resolve } from "path";

interface Bucket {
  categoryNameLike: string;
  count: number;
}

const BUCKETS: Bucket[] = [
  { categoryNameLike: "PCB", count: 8 },
  { categoryNameLike: "Primitives", count: 4 },
  { categoryNameLike: "Boolean Operations", count: 4 },
  { categoryNameLike: "Hinges", count: 4 },
  { categoryNameLike: "Generic Enclosures", count: 4 },
  { categoryNameLike: "bd_warehouse", count: 3 },
  { categoryNameLike: "Extrusions", count: 3 },
];

async function pickPromptsForBucket(b: Bucket): Promise<string[]> {
  const rows = await prisma.workbenchExamplePrompt.findMany({
    where: {
      category: { name: { contains: b.categoryNameLike, mode: "insensitive" } },
      examples: { some: { renderStatus: "success" } },
    },
    select: {
      id: true,
      examples: { select: { approvalStatus: true } },
    },
    orderBy: { id: "asc" },
  });

  // Mix approval statuses: pick some auto_approved, some pending, some rejected.
  const statusOf = (r: typeof rows[number]) => {
    const has = (s: string) => r.examples.some((e) => e.approvalStatus === s);
    if (has("rejected")) return "rejected";
    if (has("auto_approved")) return "auto_approved";
    return "pending";
  };

  const grouped: Record<string, string[]> = { auto_approved: [], pending: [], rejected: [] };
  for (const r of rows) grouped[statusOf(r)].push(r.id);

  const out: string[] = [];
  const order = ["pending", "auto_approved", "rejected"];
  let i = 0;
  while (out.length < b.count && order.some((s) => grouped[s].length > 0)) {
    const s = order[i % order.length];
    const next = grouped[s].shift();
    if (next) out.push(next);
    i++;
  }
  return out;
}

async function main() {
  const allIds: string[] = [];
  for (const b of BUCKETS) {
    const ids = await pickPromptsForBucket(b);
    console.log(`${b.categoryNameLike}: picked ${ids.length}/${b.count}`);
    allIds.push(...ids);
  }
  const outPath = resolve(__dirname, "../../../docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt");
  writeFileSync(outPath, allIds.join("\n") + "\n", "utf-8");
  console.log(`Wrote ${allIds.length} IDs to ${outPath}`);
  await prisma.$disconnect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 2: Run the script**

```bash
cd packages/backend
npx tsx scripts/eval-plan-test-set.ts
```

Expected: console output showing per-bucket counts; file written with ~30 lines.

- [ ] **Step 3: Verify the file**

```bash
wc -l /Users/daniel/src/github/kreuzhofer/chat3d-app/docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt
```

Expected: roughly 30 (could be slightly less if some buckets had fewer matching prompts).

- [ ] **Step 4: Commit**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/scripts/eval-plan-test-set.ts \
        docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt
git commit -m "Pick ~30 prompts for the eval-plan A/B test set"
```

---

## Task 13: Regenerate specs + re-evaluate the test set

**Files:** (operational; no code changes)

- [ ] **Step 1: Capture baseline metrics**

```bash
docker compose exec -T postgres psql -U chat3d -d chat3d -A -t <<'SQL' > /tmp/eval-plan-baseline.tsv
SELECT
  we.prompt_id,
  we.eval_score,
  we.visual_score,
  we.code_eval_score,
  we.eval_source,
  we.composite_weight_source
FROM workbench_examples we
WHERE we.id IN (
  SELECT DISTINCT ON (prompt_id) id
  FROM workbench_examples
  WHERE prompt_id = ANY ($1::uuid[])
  ORDER BY prompt_id, eval_score DESC NULLS LAST
)
SQL
```

(adjust to read the prompt-id list from the test-set file)

- [ ] **Step 2: Regenerate spec for each test prompt**

Loop the IDs and call the spec-regeneration admin endpoint that already exists (it was used during the improve-category runs). Find it via:
```bash
grep -rn "regenerate.*spec\|spec.*regenerate\|specRegenerate" packages/backend/src/routes 2>/dev/null
```

If a single-prompt regen endpoint isn't directly exposed, use the batch endpoint with a single-prompt filter, or write a small one-shot driver script in `packages/backend/scripts/eval-plan-regen-specs.ts`:

```ts
// One-shot: regenerate spec for each prompt in the test-set file.
// Each regen overwrites the prompt's spec fields, including the new evalPlan.
import { readFileSync } from "fs";
import { prisma } from "../src/db/prisma.js";
import { generateSpec } from "../src/services/spec-generation.service.js";
import { persistSpecToPrompt } from "../src/services/workbench-spec-persist.service.js";

async function main() {
  const ids = readFileSync(process.argv[2], "utf-8")
    .split("\n").map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    const prompt = await prisma.workbenchExamplePrompt.findUnique({ where: { id } });
    if (!prompt) continue;
    const spec = await generateSpec(prompt.prompt);
    await persistSpecToPrompt({ promptId: id, specResult: spec, specCameFromNullDecompositionCache: false });
    console.log(`Regenerated: ${id}  evalPlan=${spec.evalPlan ? "yes" : "no"}`);
  }
  await prisma.$disconnect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
```

Run:
```bash
cd packages/backend
npx tsx scripts/eval-plan-regen-specs.ts ../../docs/superpowers/specs/2026-06-05-eval-plan-test-set.txt
```

Expected: ~30 lines of output, most showing `evalPlan=yes`. If most show `no`, the spec LLM template guidance needs tightening — flag as DONE_WITH_CONCERNS.

- [ ] **Step 3: Re-evaluate the best example for each prompt**

Use the existing `re-evaluate/batch` endpoint or a one-shot script that calls `evaluateExample(exampleId)`. For each prompt in the set, look up the best existing example and re-evaluate it. The score will be recomputed with the new dynamic prompt + per-prompt weight + clamp gating.

Run via either the admin API or a script. Either way, expect ~30 re-evals, each ~30s, total ~15 min wall time, ~$0.90 cost.

- [ ] **Step 4: Capture after metrics**

Same SQL as Step 1, redirected to `/tmp/eval-plan-after.tsv`.

- [ ] **Step 5: No commit yet — proceed to the report task**

---

## Task 14: Generate the A/B report

**Files:**
- Create: `packages/backend/scripts/eval-plan-ab-report.ts`
- Create: `docs/superpowers/specs/2026-06-05-eval-plan-test-results.md`

- [ ] **Step 1: Write the report script**

Create `packages/backend/scripts/eval-plan-ab-report.ts`:

```ts
/**
 * Reads /tmp/eval-plan-baseline.tsv and /tmp/eval-plan-after.tsv, joins on
 * prompt_id, and writes a markdown report.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

interface Row {
  promptId: string;
  evalScore: number | null;
  visualScore: number | null;
  codeScore: number | null;
  evalSource: string | null;
  weightSource: string | null;
}

function parseTsv(path: string): Map<string, Row> {
  const lines = readFileSync(path, "utf-8").trim().split("\n");
  const map = new Map<string, Row>();
  for (const line of lines) {
    const [pid, es, vs, cs, src, ws] = line.split("|");
    map.set(pid, {
      promptId: pid,
      evalScore: es ? Number(es) : null,
      visualScore: vs ? Number(vs) : null,
      codeScore: cs ? Number(cs) : null,
      evalSource: src || null,
      weightSource: ws || null,
    });
  }
  return map;
}

function gap(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.abs(a - b);
}

const before = parseTsv("/tmp/eval-plan-baseline.tsv");
const after = parseTsv("/tmp/eval-plan-after.tsv");

const rows: string[] = [];
rows.push("| Prompt | Before composite | After composite | Δ | Before |v-c| | After |v-c| | Weight source |");
rows.push("|---|---|---|---|---|---|---|");
let totalDelta = 0;
let countDelta = 0;
for (const [pid, b] of before) {
  const a = after.get(pid);
  if (!a) continue;
  const d = (a.evalScore ?? 0) - (b.evalScore ?? 0);
  totalDelta += d;
  countDelta++;
  rows.push(
    `| \`${pid.slice(0, 8)}\` | ${b.evalScore ?? "-"} | ${a.evalScore ?? "-"} | ${d.toFixed(2)} ` +
    `| ${gap(b.visualScore, b.codeScore) ?? "-"} | ${gap(a.visualScore, a.codeScore) ?? "-"} ` +
    `| ${a.weightSource ?? "-"} |`
  );
}
rows.push(`\nMean composite Δ: ${(totalDelta / countDelta).toFixed(2)}`);

const outPath = resolve(__dirname, "../../../docs/superpowers/specs/2026-06-05-eval-plan-test-results.md");
writeFileSync(
  outPath,
  `# Per-Prompt Eval Plan — A/B Test Results\n\nGenerated: ${new Date().toISOString()}\n\n${rows.join("\n")}\n`,
  "utf-8",
);
console.log(`Wrote ${outPath}`);
```

- [ ] **Step 2: Run the report**

```bash
cd packages/backend
npx tsx scripts/eval-plan-ab-report.ts
```

Expected: writes the markdown file.

- [ ] **Step 3: Eyeball the report and add narrative analysis**

Open `docs/superpowers/specs/2026-06-05-eval-plan-test-results.md`. Above the table, add a short narrative section:
- Mean composite Δ for PCB Cases sub-bucket vs primitives sub-bucket
- Whether the success criteria from the spec (§7) were met
- Any surprises (e.g., a primitive prompt's score regressed)
- A one-line decision: ship-as-is / iterate on spec template / further investigation

Edit by hand. No code change.

- [ ] **Step 4: Commit the report**

```bash
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
git add packages/backend/scripts/eval-plan-ab-report.ts \
        docs/superpowers/specs/2026-06-05-eval-plan-test-results.md \
        packages/backend/scripts/eval-plan-regen-specs.ts
git commit -m "A/B test results for per-prompt eval plan"
```

---

## Self-Review

### Spec coverage

| Spec section | Task(s) |
|---|---|
| Architecture / data flow | Tasks 1–11 (whole pipeline) |
| Schema (eval_plan + composite_weight_source) | Task 1 |
| Spec generator extension (SpecResult + parse) | Tasks 4–5 |
| Spec system-prompt extension | Task 5 |
| Persistence on prompts table | Task 6 |
| VLM dynamic prompt branch + scaffold split | Task 7 |
| Inspection plan filter + focus labels | Task 8 |
| Composite weight resolver | Tasks 9–10 |
| ±4 clamp gating on effective weight | Task 10 |
| compositeWeightSource persistence on examples | Task 11 |
| A/B test set selection | Task 12 |
| Regenerate + re-evaluate operational steps | Task 13 |
| A/B report | Task 14 |
| Non-goals (no render changes, no backfill, no section views) | Honored — no task adds them |
| Backwards compat (null eval_plan = legacy path) | Verified by tests in Tasks 4, 7, 9 |

### Placeholder scan

No `TBD`/`TODO`/`fill in details` strings. The two operational steps in Task 13 (capturing baseline TSV, calling the regen endpoint) include the exact commands and a fallback driver script. Task 11 Step 4 references "fixEval?.compositeWeightSource ?? null" — the existing codegen file already destructures `agFullEval` and `fixEval` so the engineer can mirror the pattern.

### Type consistency

- `EvalPlan` type defined in Task 3 is used by every later task (4, 6, 7, 9, 10) with the same field names.
- `RENDER_ANGLE_NAMES` exported from `utils/eval-plan.ts` (Task 3) is the single source of truth for the 10 angles; both the Zod schema (Task 3) and the orchestrator (Task 8) use it.
- `ResolvedWeight = { weight: number; source: "eval_plan" | "adaptive" | "global" }` from Task 10 matches the CHECK constraint values in the migration (Task 1).
- `BuildEvalPromptOptions` type from Task 7 is used by every call site after that task; the legacy positional API is removed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-05-per-prompt-eval-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
