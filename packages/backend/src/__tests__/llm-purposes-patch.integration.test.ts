/**
 * PATCH /api/admin/llm-purposes/:purpose (issue #26).
 *
 * updatePurposeAssignment() opened with `if (!patch.modelId) return null`, and
 * the route maps null to 404 — so a patch changing only an override was
 * rejected as "purpose not found" for a purpose that plainly exists. That made
 * the per-purpose overrides effectively API-only-with-a-ritual: every caller
 * had to resend the unchanged model id, which is also why no UI could edit an
 * override on its own.
 *
 * These tests operate on `tag_suggest`, a curation purpose the generation
 * pipeline does not use. The suite runs against its own database (#90), so
 * the fixture is self-contained: a keyless provider, two models of its own
 * and the purpose row itself, created if absent and removed afterwards. If
 * the row already exists (a database shared with a live run), it is
 * snapshotted and restored exactly.
 */
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { prisma } from "../db/prisma.js";
import { getModelForPurpose } from "../services/llm-config.service.js";

const PURPOSE = "tag_suggest";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const adminEmail = `llm-purpose-admin-${suffix}@example.test`;
const providerName = `purpose-patch-${suffix}`.slice(0, 50);
const password = "S3curePass!123";

describe("PATCH /api/admin/llm-purposes/:purpose", () => {
  const app = createApp();
  let adminId = "";
  let token = "";
  let originalRow: { modelId: string; overrideThinkingEffort: string | null; overrideMaxOutputTokens: number | null } | null = null;
  let modelId = "";
  let otherModelId = "";
  let modelDefaultEffort: string | null = null;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      create: { email: adminEmail, passwordHash, displayName: "Purpose Admin", role: "admin", status: "active" },
      update: { passwordHash, role: "admin", status: "active", updatedAt: new Date() },
      select: { id: true },
    });
    adminId = admin.id;
    const login = await request(app).post("/api/auth/login").send({ email: adminEmail, password });
    token = (login.body as { token: string }).token;

    // Our own provider and models: an openai-compatible provider resolves
    // keyless, so getModelForPurpose() works without any secret in the test.
    await prisma.llmProvider.create({
      data: { name: providerName, providerType: "openai-compatible", displayName: "Purpose Patch", endpointUrl: "http://localhost:1/v1" },
    });
    const own = await prisma.llmModel.create({
      data: {
        provider: providerName,
        modelName: `purpose-patch-${suffix}`,
        displayName: `Purpose Patch ${suffix}`,
        costPer1mInput: 0,
        costPer1mOutput: 0,
        defaultThinkingEffort: "medium",
      },
      select: { id: true, defaultThinkingEffort: true },
    });
    // A second model, so the model-only case cannot pass vacuously.
    const other = await prisma.llmModel.create({
      data: {
        provider: providerName,
        modelName: `purpose-patch-target-${suffix}`,
        displayName: `Purpose Patch Target ${suffix}`,
        costPer1mInput: 0,
        costPer1mOutput: 0,
      },
      select: { id: true },
    });
    otherModelId = other.id;

    // Snapshot whatever this purpose currently points at, so afterAll restores
    // it exactly; on the suite's own database there is nothing, and the row is ours.
    const row = await prisma.llmPurposeMap.findUnique({ where: { purpose: PURPOSE } });
    if (row) {
      originalRow = {
        modelId: row.modelId,
        overrideThinkingEffort: row.overrideThinkingEffort,
        overrideMaxOutputTokens: row.overrideMaxOutputTokens,
      };
      await prisma.llmPurposeMap.update({
        where: { purpose: PURPOSE },
        data: { modelId: own.id, overrideThinkingEffort: null, overrideMaxOutputTokens: null, updatedAt: new Date() },
      });
    } else {
      await prisma.llmPurposeMap.create({ data: { purpose: PURPOSE, modelId: own.id } });
    }
    modelId = own.id;
    modelDefaultEffort = own.defaultThinkingEffort;
    expect(otherModelId).not.toBe(modelId);
  });

  // Reset after every test, not just at the end: an interrupted run must not
  // leave the purpose row pointing at the wrong model with overrides set.
  afterEach(async () => {
    await prisma.llmPurposeMap.update({
      where: { purpose: PURPOSE },
      data: { modelId, overrideThinkingEffort: null, overrideMaxOutputTokens: null, updatedAt: new Date() },
    });
  });

  afterAll(async () => {
    if (originalRow) {
      await prisma.llmPurposeMap.update({ where: { purpose: PURPOSE }, data: { ...originalRow, updatedAt: new Date() } });
    } else {
      await prisma.llmPurposeMap.deleteMany({ where: { purpose: PURPOSE, modelId: { in: [modelId, otherModelId] } } });
    }
    await prisma.llmModel.deleteMany({ where: { provider: providerName } });
    await prisma.llmProvider.deleteMany({ where: { name: providerName } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  });

  const patch = (purpose: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/admin/llm-purposes/${purpose}`).set("Authorization", `Bearer ${token}`).send(body);

  async function row() {
    return prisma.llmPurposeMap.findUnique({ where: { purpose: PURPOSE } });
  }

  it("applies an override-only patch and leaves the assigned model unchanged", async () => {
    await prisma.llmPurposeMap.update({ where: { purpose: PURPOSE }, data: { modelId, overrideThinkingEffort: null } });

    const res = await patch(PURPOSE, { overrideThinkingEffort: "low" });

    expect(res.status).toBe(200);
    const after = await row();
    expect(after?.overrideThinkingEffort).toBe("low");
    expect(after?.modelId).toBe(modelId);
  });

  it("applies a max-output override on its own", async () => {
    const res = await patch(PURPOSE, { overrideMaxOutputTokens: 8192 });

    expect(res.status).toBe(200);
    const after = await row();
    expect(after?.overrideMaxOutputTokens).toBe(8192);
    expect(after?.modelId).toBe(modelId);
  });

  it("clears an override so the purpose falls back to the model default", async () => {
    await prisma.llmPurposeMap.update({ where: { purpose: PURPOSE }, data: { overrideThinkingEffort: "low" } });
    expect((await getModelForPurpose(PURPOSE)).thinkingEffort).toBe("low");

    const res = await patch(PURPOSE, { overrideThinkingEffort: null });

    expect(res.status).toBe(200);
    expect((await row())?.overrideThinkingEffort).toBeNull();
    // The resolution rule is `override ?? modelDefault`, so clearing must fall back.
    expect((await getModelForPurpose(PURPOSE)).thinkingEffort).toBe(modelDefaultEffort);
  });

  it("still applies a model-only patch", async () => {
    const res = await patch(PURPOSE, { modelId: otherModelId });

    expect(res.status).toBe(200);
    expect((await row())?.modelId).toBe(otherModelId);
  });

  it("rejects a patch with no updatable fields", async () => {
    const res = await patch(PURPOSE, {});
    expect(res.status).toBe(400);
  });

  it("clears a max-output override", async () => {
    await prisma.llmPurposeMap.update({ where: { purpose: PURPOSE }, data: { overrideMaxOutputTokens: 8192 } });

    const res = await patch(PURPOSE, { overrideMaxOutputTokens: null });

    expect(res.status).toBe(200);
    expect((await row())?.overrideMaxOutputTokens).toBeNull();
  });

  it("rejects an effort outside the shared vocabulary", async () => {
    const res = await patch(PURPOSE, { overrideThinkingEffort: "enthusiastic" });

    expect(res.status).toBe(400);
    expect((await row())?.overrideThinkingEffort).toBeNull();
  });

  it("rejects a fractional max-output, which the integer column cannot hold", async () => {
    const res = await patch(PURPOSE, { overrideMaxOutputTokens: 8192.5 });
    expect(res.status).toBe(400);
  });

  it("rejects a blank modelId rather than failing the foreign key", async () => {
    // The model select's "not assigned" option sends "".
    const res = await patch(PURPOSE, { modelId: "" });

    expect(res.status).toBe(400);
    expect((await row())?.modelId).toBe(modelId);
  });

  it("rejects an unknown modelId as a bad request, not a server error", async () => {
    const res = await patch(PURPOSE, { modelId: "00000000-0000-4000-8000-000000000000" });
    expect(res.status).toBe(400);
  });

  it("returns 404 only for a purpose that does not exist", async () => {
    const res = await patch("not_a_real_purpose", { overrideThinkingEffort: "low" });
    expect(res.status).toBe(404);
  });
});
