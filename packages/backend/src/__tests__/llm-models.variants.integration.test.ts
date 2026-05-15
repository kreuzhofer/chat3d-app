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
