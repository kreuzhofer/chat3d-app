# LLM Model Variants — Same Provider+Model, Different Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple `llm_models` rows for the same `(provider, model_name)` pair, distinguished by a required, unique `display_name`. This lets admins register, e.g., `qwen3.6-27b-thinking-low` and `qwen3.6-27b-thinking-high` against the same underlying model with different settings.

**Architecture:**
- Swap the uniqueness constraint on `llm_models` from `(provider, model_name)` → `(provider, display_name)`.
- Make `display_name` NOT NULL. Backfill existing NULLs from `model_name`.
- `model_name` keeps its meaning (API model identifier sent to the provider). `display_name` becomes the primary admin/UI label and is required at create time.
- All existing lookups go through `id` (UUID) — no callers reference the old compound unique, so the constraint swap is internal.

**Tech Stack:** Postgres 16, Prisma 5, Express + TypeScript backend, React 18 + Vite frontend, vitest, Tailwind.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/backend/prisma/migrations/20260515000000_llm_models_display_name_unique/migration.sql` | Create | Backfill NULL `display_name`, drop `(provider,model_name)` unique, set NOT NULL, add `(provider,display_name)` unique |
| `packages/backend/prisma/schema.prisma` | Modify (lines ~688–713) | Mirror migration in Prisma schema |
| `packages/backend/src/services/llm-config.service.ts` | Modify (lines ~777–810, type defs ~38–80) | `createModel`: require `displayName`; map duplicate-display-name errors to a typed 409 |
| `packages/backend/src/routes/admin.routes.ts` | Modify (lines ~474–501) | Require `displayName` in POST body; translate 409 from service |
| `packages/backend/src/__tests__/llm-models.variants.integration.test.ts` | Create | Integration test: two models with same `(provider,model_name)` and different `display_name` succeed; same `display_name` collision returns 409 |
| `packages/frontend/src/components/admin/ModelFormDialog.tsx` | Modify (lines ~14, 34–50, 70–178) | Mark `displayName` required; client-side validation; helper text |
| `packages/frontend/src/components/admin/ModelsTab.tsx` | Modify (only if it shows the model identity label) | Show `display_name` as the primary label, `provider/model_name` as the secondary line |
| `packages/frontend/src/api/admin.api.ts` | Read-only | Confirm row type already exposes `display_name` (it does; no edit needed) |

No deletions. Existing fallback `model.displayName ?? \`${provider}/${modelName}\`` stays as defensive code but post-migration `displayName` is always set.

---

## Task 1: Database migration — uniqueness swap

**Files:**
- Create: `packages/backend/prisma/migrations/20260515000000_llm_models_display_name_unique/migration.sql`

- [ ] **Step 1: Write the migration SQL**

Create `packages/backend/prisma/migrations/20260515000000_llm_models_display_name_unique/migration.sql`:

```sql
-- Backfill NULL display_name from model_name so the NOT NULL + unique addition is safe.
UPDATE llm_models
SET display_name = model_name
WHERE display_name IS NULL;

-- The previous uniqueness on (provider, model_name) made (provider, display_name) post-backfill
-- collision-impossible: every row's (provider, display_name) is either user-set (and the user
-- could only set distinct values since model_name was unique per provider) or equals
-- (provider, model_name) which was itself unique. So no de-dup pass is needed.

-- Drop the old compound unique.
ALTER TABLE llm_models DROP CONSTRAINT IF EXISTS "llm_models_provider_model_name_key";

-- Tighten display_name.
ALTER TABLE llm_models ALTER COLUMN display_name SET NOT NULL;

-- Add the new compound unique on (provider, display_name).
ALTER TABLE llm_models
  ADD CONSTRAINT "llm_models_provider_display_name_key" UNIQUE (provider, display_name);
```

- [ ] **Step 2: Pre-flight sanity check — confirm constraint name**

Run against the dev DB to confirm the current constraint name before applying:

```bash
docker compose exec postgres psql -U chat3d -d chat3d -c "\
SELECT conname FROM pg_constraint \
WHERE conrelid = 'llm_models'::regclass AND contype = 'u';"
```

Expected: a row containing `llm_models_provider_model_name_key`. If the name differs (e.g. older snake/camel quirk), update the `DROP CONSTRAINT` line in `migration.sql` to match.

- [ ] **Step 3: Apply the migration**

```bash
cd packages/backend && npx prisma migrate deploy
```

Expected: `Applying migration 20260515000000_llm_models_display_name_unique`; no error.

- [ ] **Step 4: Verify schema state**

```bash
docker compose exec postgres psql -U chat3d -d chat3d -c "\
SELECT column_name, is_nullable FROM information_schema.columns \
WHERE table_name = 'llm_models' AND column_name = 'display_name'; \
SELECT conname FROM pg_constraint \
WHERE conrelid = 'llm_models'::regclass AND contype = 'u';"
```

Expected: `display_name | NO` and a single unique constraint `llm_models_provider_display_name_key`.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/prisma/migrations/20260515000000_llm_models_display_name_unique/migration.sql
git commit -m "Swap llm_models unique key from (provider,model_name) to (provider,display_name)"
```

---

## Task 2: Mirror the change in Prisma schema

**Files:**
- Modify: `packages/backend/prisma/schema.prisma:688-713`

- [ ] **Step 1: Update the LlmModel Prisma model**

In `packages/backend/prisma/schema.prisma`, replace:

```prisma
  displayName           String?  @map("display_name") @db.VarChar(255)
```

with:

```prisma
  displayName           String   @map("display_name") @db.VarChar(255)
```

And replace:

```prisma
  @@unique([provider, modelName])
```

with:

```prisma
  @@unique([provider, displayName])
```

- [ ] **Step 2: Regenerate Prisma client**

```bash
cd packages/backend && npx prisma generate
```

Expected: `Generated Prisma Client` success line; no schema drift error.

- [ ] **Step 3: Verify no drift between schema and DB**

```bash
cd packages/backend && npx prisma migrate status
```

Expected: `Database schema is up to date!`

- [ ] **Step 4: Commit**

```bash
git add packages/backend/prisma/schema.prisma
git commit -m "Reflect llm_models display_name uniqueness in Prisma schema"
```

---

## Task 3: Backend — require `displayName` in `createModel`

**Files:**
- Modify: `packages/backend/src/services/llm-config.service.ts:777-810`

- [ ] **Step 1: Tighten `createModel` signature**

In `packages/backend/src/services/llm-config.service.ts`, change the `createModel` function declaration. Replace the existing signature and body (lines ~777–810):

```typescript
export async function createModel(input: {
  provider: string;
  modelName: string;
  displayName?: string;
  costPer1mInput?: number;
  // ...rest unchanged
```

with the required-displayName variant:

```typescript
export async function createModel(input: {
  provider: string;
  modelName: string;
  displayName: string;            // now required
  costPer1mInput?: number;
  costPer1mOutput?: number;
  maxOutputTokens?: number | null;
  maxContextTokens?: number | null;
  supportsThinking?: boolean;
  defaultThinkingEffort?: string | null;
  supportsVision?: boolean;
  supportsEmbeddings?: boolean;
  streamingEnabled?: boolean;
  vlmEvalPreamble?: string | null;
}): Promise<LlmModelRow> {
  const displayName = input.displayName.trim();
  if (!displayName) {
    const err = new Error("displayName is required");
    (err as Error & { statusCode: number }).statusCode = 400;
    throw err;
  }

  try {
    const row = await prisma.llmModel.create({
      data: {
        provider: input.provider,
        modelName: input.modelName,
        displayName,
        costPer1mInput: input.costPer1mInput ?? 0,
        costPer1mOutput: input.costPer1mOutput ?? 0,
        maxOutputTokens: input.maxOutputTokens ?? null,
        maxContextTokens: input.maxContextTokens ?? null,
        supportsThinking: input.supportsThinking ?? false,
        defaultThinkingEffort: input.defaultThinkingEffort ?? null,
        supportsVision: input.supportsVision ?? false,
        supportsEmbeddings: input.supportsEmbeddings ?? false,
        streamingEnabled: input.streamingEnabled ?? true,
        vlmEvalPreamble: input.vlmEvalPreamble ?? null,
      },
    });
    return toModelRow(row);
  } catch (error) {
    // Prisma unique-constraint violation → 409 Conflict
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      const err = new Error(
        `A model with display name "${displayName}" already exists for provider "${input.provider}"`,
      );
      (err as Error & { statusCode: number }).statusCode = 409;
      throw err;
    }
    throw error;
  }
}
```

- [ ] **Step 2: Verify backend type-checks**

```bash
cd packages/backend && npm run build
```

Expected: `tsc` exits 0. If there are call-site type errors elsewhere, fix them — they will all be admin route handlers that already check `displayName` was provided.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/llm-config.service.ts
git commit -m "Require displayName on createModel and map duplicates to 409"
```

---

## Task 4: Backend — update the `POST /admin/llm-models` route

**Files:**
- Modify: `packages/backend/src/routes/admin.routes.ts:474-501`

- [ ] **Step 1: Require `displayName` in the request body**

In `packages/backend/src/routes/admin.routes.ts`, replace the `POST /llm-models` handler (lines ~474–501) with:

```typescript
adminRouter.post("/llm-models", async (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  if (
    !body ||
    typeof body.provider !== "string" ||
    typeof body.modelName !== "string" ||
    typeof body.displayName !== "string" ||
    body.displayName.trim() === ""
  ) {
    res.status(400).json({ error: "provider, modelName, and displayName are required" });
    return;
  }

  try {
    const model = await createModel({
      provider: body.provider,
      modelName: body.modelName,
      displayName: body.displayName,
      costPer1mInput: typeof body.costPer1mInput === "number" ? body.costPer1mInput : undefined,
      costPer1mOutput: typeof body.costPer1mOutput === "number" ? body.costPer1mOutput : undefined,
      maxOutputTokens: typeof body.maxOutputTokens === "number" ? body.maxOutputTokens : (body.maxOutputTokens === null ? null : undefined),
      maxContextTokens: typeof body.maxContextTokens === "number" ? body.maxContextTokens : (body.maxContextTokens === null ? null : undefined),
      supportsThinking: typeof body.supportsThinking === "boolean" ? body.supportsThinking : undefined,
      defaultThinkingEffort: typeof body.defaultThinkingEffort === "string" ? body.defaultThinkingEffort : (body.defaultThinkingEffort === null ? null : undefined),
      supportsVision: typeof body.supportsVision === "boolean" ? body.supportsVision : undefined,
      supportsEmbeddings: typeof body.supportsEmbeddings === "boolean" ? body.supportsEmbeddings : undefined,
      streamingEnabled: typeof body.streamingEnabled === "boolean" ? body.streamingEnabled : undefined,
      vlmEvalPreamble: typeof body.vlmEvalPreamble === "string" ? body.vlmEvalPreamble : (body.vlmEvalPreamble === null ? null : undefined),
    });
    res.status(201).json(model);
  } catch (error) {
    sendKnownError(res, error, "Failed to create LLM model");
  }
});
```

(`sendKnownError` already forwards `statusCode` from thrown errors, so the new 409 path will surface correctly.)

- [ ] **Step 2: Verify backend type-checks**

```bash
cd packages/backend && npm run build
```

Expected: `tsc` exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/routes/admin.routes.ts
git commit -m "Require displayName on POST /admin/llm-models"
```

---

## Task 5: Backend integration test — variants succeed, duplicates conflict

**Files:**
- Create: `packages/backend/src/__tests__/llm-models.variants.integration.test.ts`

- [ ] **Step 1: Write the variants test**

Create `packages/backend/src/__tests__/llm-models.variants.integration.test.ts`. This mirrors the setup used by `admin.integration.test.ts` (admin user → `/api/auth/login` → bearer token; no shared test-app helper exists in this repo):

```typescript
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { prisma } from "../db/prisma.js";

interface LoginResponse {
  token: string;
}

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const adminEmail = `llm-variants-admin-${suffix}@example.test`;
const password = "S3curePass!123";
const providerName = `test-prov-${suffix}`;

describe("POST /api/admin/llm-models — variants", () => {
  const app = createApp();
  let adminId = "";
  let token = "";

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      create: {
        email: adminEmail,
        passwordHash,
        displayName: "LLM Variants Admin",
        role: "admin",
        status: "active",
      },
      update: { passwordHash, role: "admin", status: "active", updatedAt: new Date() },
      select: { id: true },
    });
    adminId = admin.id;

    const login = await request(app).post("/api/auth/login").send({ email: adminEmail, password });
    expect(login.status).toBe(200);
    token = (login.body as LoginResponse).token;

    // Seed a provider this test owns.
    await prisma.llmProvider.upsert({
      where: { name: providerName },
      create: { name: providerName, displayName: "Variants Test Provider", isActive: true },
      update: { isActive: true },
    });
  });

  afterAll(async () => {
    await prisma.llmModel.deleteMany({ where: { provider: providerName } });
    await prisma.llmProvider.deleteMany({ where: { name: providerName } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  });

  it("creates two models with same (provider, modelName) but different displayName", async () => {
    const res1 = await request(app)
      .post("/api/admin/llm-models")
      .set("Authorization", `Bearer ${token}`)
      .send({
        provider: providerName,
        modelName: "qwen3-27b",
        displayName: `qwen3-27b-thinking-low-${suffix}`,
        supportsThinking: true,
        defaultThinkingEffort: "low",
        maxOutputTokens: 16384,
      });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post("/api/admin/llm-models")
      .set("Authorization", `Bearer ${token}`)
      .send({
        provider: providerName,
        modelName: "qwen3-27b",
        displayName: `qwen3-27b-thinking-high-${suffix}`,
        supportsThinking: true,
        defaultThinkingEffort: "high",
        maxOutputTokens: 32768,
      });
    expect(res2.status).toBe(201);
    expect(res2.body.id).not.toBe(res1.body.id);
    expect(res2.body.model_name).toBe(res1.body.model_name);
  });

  it("rejects duplicate displayName for same provider with 409", async () => {
    const display = `dup-display-${suffix}`;

    const first = await request(app)
      .post("/api/admin/llm-models")
      .set("Authorization", `Bearer ${token}`)
      .send({ provider: providerName, modelName: "qwen3-27b", displayName: display });
    expect(first.status).toBe(201);

    const dup = await request(app)
      .post("/api/admin/llm-models")
      .set("Authorization", `Bearer ${token}`)
      .send({ provider: providerName, modelName: "qwen3-27b-base", displayName: display });
    expect(dup.status).toBe(409);
  });

  it("rejects missing displayName with 400", async () => {
    const res = await request(app)
      .post("/api/admin/llm-models")
      .set("Authorization", `Bearer ${token}`)
      .send({ provider: providerName, modelName: "qwen3-27b" });
    expect(res.status).toBe(400);
  });
});
```

Note the use of `suffix` in display names: this lets the file be re-run without manual DB cleanup, and the `afterAll` block tidies up rows this run created.

- [ ] **Step 2: Run only this test file and watch it pass**

```bash
cd packages/backend && npx vitest run src/__tests__/llm-models.variants.integration.test.ts
```

Expected: all three test cases PASS.

- [ ] **Step 3: Run the full backend test suite to catch regressions**

```bash
cd packages/backend && npm test
```

Expected: all tests PASS. If a different test fails with a Prisma "Unique constraint failed on the fields: (`provider`,`display_name`)" error or a 400 "displayName is required" error, that test was relying on the old (provider, model_name) uniqueness — fix the seed to set a distinct `displayName` (or any non-empty `displayName` if it was previously omitted). Do not move on while red tests remain.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/__tests__/llm-models.variants.integration.test.ts
git commit -m "Test: llm_models variants by displayName"
```

---

## Task 6: Frontend — make `displayName` required in the form

**Files:**
- Modify: `packages/frontend/src/components/admin/ModelFormDialog.tsx:11-50, 113-114, 171-178`

- [ ] **Step 1: Update the form data type and empty state**

In `packages/frontend/src/components/admin/ModelFormDialog.tsx`, no shape change is needed for `ModelFormData` (it already has `displayName: string`). Update the empty-state helper so it suggests a sensible default:

Replace (around line 34–50):

```typescript
function emptyForm(defaultProvider: string): ModelFormData {
  return {
    provider: defaultProvider,
    modelName: "",
    displayName: "",
    // …
```

with:

```typescript
function emptyForm(defaultProvider: string): ModelFormData {
  return {
    provider: defaultProvider,
    modelName: "",
    displayName: "",      // intentionally empty — user must fill this in
    costPer1mInput: 0,
    costPer1mOutput: 0,
    maxOutputTokens: null,
    maxContextTokens: null,
    supportsThinking: false,
    defaultThinkingEffort: null,
    supportsVision: false,
    supportsEmbeddings: false,
    streamingEnabled: true,
    vlmEvalPreamble: "",
  };
}
```

- [ ] **Step 2: Make displayName a required input and gate submit on it**

Replace the existing display-name `FormField` block (around lines 171–178):

```tsx
<FormField label="Display Name" htmlFor="model-display-name" helperText="Friendly label for the UI (optional)">
  <Input
    id="model-display-name"
    value={form.displayName}
    placeholder="e.g. GPT-4o Mini"
    onChange={(e) => patch({ displayName: e.target.value })}
  />
</FormField>
```

with the required version:

```tsx
<FormField
  label="Display Name"
  htmlFor="model-display-name"
  required
  helperText="Unique per provider. Use this to register variants of the same model — e.g. qwen3-27b-thinking-low vs qwen3-27b-thinking-high."
>
  <Input
    id="model-display-name"
    value={form.displayName}
    placeholder="e.g. qwen3-27b-thinking-low"
    onChange={(e) => patch({ displayName: e.target.value })}
  />
</FormField>
```

- [ ] **Step 3: Update `canSubmit` to require displayName**

Replace (around line 114):

```typescript
const canSubmit = form.provider.trim() !== "" && form.modelName.trim() !== "";
```

with:

```typescript
const canSubmit =
  form.provider.trim() !== "" &&
  form.modelName.trim() !== "" &&
  form.displayName.trim() !== "";
```

- [ ] **Step 4: Verify frontend type-checks and lint**

```bash
cd packages/frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/admin/ModelFormDialog.tsx
git commit -m "Require unique displayName in admin model form"
```

---

## Task 7: Frontend smoke — verify duplicate displayName surfaces clearly

**Files:**
- Touch nothing; this is a manual verification step.

- [ ] **Step 1: Rebuild and start the frontend**

```bash
docker compose build frontend && docker compose up -d frontend
```

- [ ] **Step 2: Confirm legitimate variants work**

Open the admin → Models tab. Click **Add Model**.
- Create row #1: provider `xai`, model name `grok-4`, display name `grok-4-fast`, max output tokens `8192`.
- Create row #2: provider `xai`, model name `grok-4`, display name `grok-4-slow`, max output tokens `32768`.

Expected: both succeed and both appear in the list with the same `model_name` but distinct `display_name`.

- [ ] **Step 3: Confirm duplicate displayName is rejected**

Click **Add Model** again. Provider `xai`, model name `grok-4-mini`, display name `grok-4-fast` (already used in step 2).

Expected: the request returns 409 and the dialog shows an inline error mentioning that the display name already exists. (The dialog already pipes server errors via the existing error toast/inline-error mechanism in `ModelsTab.tsx` — no change needed there. If the message is unclear, that's polish for a follow-up — not in this plan.)

- [ ] **Step 4: Confirm missing displayName is rejected client-side**

Click **Add Model**. Leave display name blank. **Create Model** must be disabled.

Expected: button disabled until display name is filled.

- [ ] **Step 5: Confirm purpose-map dropdowns show the new label**

Open the **Purposes** subtab (or wherever purposes are assigned). The model dropdowns should show `grok-4-fast` and `grok-4-slow` as separate selectable entries, both pointing to `model_name=grok-4` under the hood. (The list code already uses `displayName ?? \`${provider}/${modelName}\``, so this should work without further edits. If it doesn't, the regression is in that fallback and fixes belong in a follow-up issue.)

- [ ] **Step 6: Final cleanup commit (only if any small UI fix proved necessary in steps 3 or 5)**

If a touch-up was needed:

```bash
git add -p   # stage exactly the polish; reject anything else
git commit -m "Polish: <describe>"
```

Otherwise: nothing to commit; verification done.

---

## Out of scope (deliberate)

- Bulk migration of existing `display_name = NULL` rows to anything richer than `model_name`. The backfill mirrors the previous unique key — admins can rename through the Edit dialog later if they want a friendlier label.
- Per-provider client-side validation of display-name uniqueness. The server is the source of truth; we surface the 409 the same way every other admin-route conflict surfaces.
- A "duplicate this model" button in the Models tab. Useful follow-up once the constraint change is in production.
- Allowing the same `display_name` across different providers (the new unique is `(provider, display_name)`, not global). If global uniqueness becomes desirable, that's a separate, narrower migration.
