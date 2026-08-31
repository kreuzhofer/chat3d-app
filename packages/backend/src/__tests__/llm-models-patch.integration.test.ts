/**
 * PATCH /api/admin/llm-models/:id (issue #24).
 *
 * updateModel() dropped unrecognised patch keys with a bare `continue`, and
 * returned the unchanged row when nothing matched — which the route served as
 * 200 with the model in it, indistinguishable from a real update. Because GET
 * returns snake_case while ALLOWED_KEYS holds only camelCase, the natural
 * GET -> edit -> PATCH round-trip silently did nothing. That is how a model
 * price stayed at 0 while the API reported success.
 */
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { prisma } from "../db/prisma.js";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const adminEmail = `llm-patch-admin-${suffix}@example.test`;
const password = "S3curePass!123";
const providerName = `patch-prov-${suffix}`;

describe("PATCH /api/admin/llm-models/:id", () => {
  const app = createApp();
  let adminId = "";
  let token = "";
  let modelId = "";

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      create: { email: adminEmail, passwordHash, displayName: "LLM Patch Admin", role: "admin", status: "active" },
      update: { passwordHash, role: "admin", status: "active", updatedAt: new Date() },
      select: { id: true },
    });
    adminId = admin.id;

    const login = await request(app).post("/api/auth/login").send({ email: adminEmail, password });
    token = (login.body as { token: string }).token;

    await prisma.llmProvider.upsert({
      where: { name: providerName },
      create: { name: providerName, displayName: "Patch Test Provider", isActive: true },
      update: { isActive: true },
    });
  });

  afterAll(async () => {
    await prisma.llmModel.deleteMany({ where: { provider: providerName } });
    await prisma.llmProvider.deleteMany({ where: { name: providerName } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  });

  /** Fresh model per test so cases cannot bleed into each other. */
  async function seedModel(): Promise<string> {
    // (provider, displayName) is unique, so every seed needs its own name.
    const unique = Math.random().toString(16).slice(2);
    const res = await request(app)
      .post("/api/admin/llm-models")
      .set("Authorization", `Bearer ${token}`)
      .send({
        provider: providerName,
        modelName: `patch-target-${unique}`,
        displayName: `Patch Target ${unique}`,
        costPer1mInput: 0,
        costPer1mOutput: 0,
      });
    expect(res.status).toBe(201);
    modelId = (res.body as { id: string }).id;
    return modelId;
  }

  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/admin/llm-models/${id}`).set("Authorization", `Bearer ${token}`).send(body);

  async function priceOf(id: string) {
    const row = await prisma.llmModel.findUnique({
      where: { id },
      select: { costPer1mInput: true, costPer1mOutput: true },
    });
    return {
      input: Number(row?.costPer1mInput ?? -1),
      output: Number(row?.costPer1mOutput ?? -1),
    };
  }

  it("applies a camelCase price update", async () => {
    const id = await seedModel();
    const res = await patch(id, { costPer1mInput: 0.0412, costPer1mOutput: 2.4329 });

    expect(res.status).toBe(200);
    expect(await priceOf(id)).toEqual({ input: 0.0412, output: 2.4329 });
  });

  it("does not answer 200 when the body contains no recognised field", async () => {
    const id = await seedModel();
    const res = await patch(id, { not_a_field: 1, alsoBogus: "x" });

    // The failure this pins: a discarded update used to come back 200 with the
    // unchanged row, so callers could not tell it had been ignored.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await priceOf(id)).toEqual({ input: 0, output: 0 });
  });

  it("accepts the snake_case shape that GET returns, so a round-trip is not a silent no-op", async () => {
    const id = await seedModel();
    const res = await patch(id, { cost_per_1m_input: 0.0412, cost_per_1m_output: 2.4329 });

    expect(res.status).toBe(200);
    expect(await priceOf(id)).toEqual({ input: 0.0412, output: 2.4329 });
  });

  it("rejects a wrong-typed value as 400, not 404 'Model not found'", async () => {
    const id = await seedModel();
    const res = await patch(id, { costPer1mInput: "not-a-number" });

    expect(res.status).toBe(400);
    expect(String((res.body as { error?: string }).error)).toMatch(/costPer1mInput|cost_per_1m_input/);
    expect(await priceOf(id)).toEqual({ input: 0, output: 0 });
  });

  it("still 404s for a model that genuinely does not exist", async () => {
    const res = await patch("00000000-0000-4000-8000-000000000000", { costPer1mInput: 1 });
    expect(res.status).toBe(404);
  });
});
