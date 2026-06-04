import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { prisma } from "../db/prisma.js";

interface LoginResponse {
  token: string;
}

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const adminEmail = `render-errors-admin-${suffix}@example.test`;
const password = "S3curePass!123";

describe("GET /api/admin/render-errors/examples", () => {
  const app = createApp();
  let adminId = "";
  let adminToken = "";
  let categoryId = "";
  let promptId = "";
  const exampleIds: string[] = [];

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      create: {
        email: adminEmail,
        passwordHash,
        displayName: "Render Errors Admin",
        role: "admin",
        status: "active",
      },
      update: {
        passwordHash,
        role: "admin",
        status: "active",
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    adminId = admin.id;

    const loginRes = await request(app).post("/api/auth/login").send({
      email: adminEmail,
      password,
    });
    expect(loginRes.status).toBe(200);
    adminToken = (loginRes.body as LoginResponse).token;

    // Seed workbench category, prompt, and a couple of failed examples
    const nextRank =
      ((await prisma.workbenchCategory.aggregate({ _max: { rank: true } }))._max.rank ?? 0) + 1;
    const cat = await prisma.workbenchCategory.create({
      data: {
        name: `render-errors-routes-${suffix}`,
        description: "",
        complexity: 1,
        rank: nextRank,
      },
    });
    categoryId = cat.id;

    const prompt = await prisma.workbenchExamplePrompt.create({
      data: { categoryId, index: 1, prompt: "drill-down-test prompt" },
    });
    promptId = prompt.id;

    for (let i = 0; i < 2; i++) {
      const ex = await prisma.workbenchExample.create({
        data: {
          promptId,
          iteration: i + 1,
          code: "x",
          renderStatus: "error",
          renderError: "kernel boom",
          renderErrorCategory: "kernel_error",
          approvalStatus: "pending",
        },
      });
      exampleIds.push(ex.id);
    }
    // One in a different category to confirm filtering
    const ex2 = await prisma.workbenchExample.create({
      data: {
        promptId,
        iteration: 99,
        code: "x",
        renderStatus: "error",
        renderError: "geom boom",
        renderErrorCategory: "geometry",
        approvalStatus: "pending",
      },
    });
    exampleIds.push(ex2.id);
  });

  afterAll(async () => {
    await prisma.workbenchExample.deleteMany({ where: { id: { in: exampleIds } } });
    if (promptId) {
      await prisma.workbenchExamplePrompt.deleteMany({ where: { id: promptId } });
    }
    if (categoryId) {
      await prisma.workbenchCategory.deleteMany({ where: { id: categoryId } });
    }
    if (adminId) {
      await prisma.user.deleteMany({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  it("returns 401 when no auth token is supplied", async () => {
    const res = await request(app).get(
      `/api/admin/render-errors/examples?categoryId=${categoryId}&errorCategory=kernel_error`,
    );
    expect(res.status).toBe(401);
  });

  it("returns examples filtered by category and error category", async () => {
    const res = await request(app)
      .get(`/api/admin/render-errors/examples?categoryId=${categoryId}&errorCategory=kernel_error`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("examples");
    expect(res.body).toHaveProperty("total");
    expect(res.body.total).toBe(2);
    expect(Array.isArray(res.body.examples)).toBe(true);
    expect(res.body.examples.length).toBe(2);
    for (const ex of res.body.examples) {
      expect(ex.renderErrorCategory).toBe("kernel_error");
      expect(typeof ex.id).toBe("string");
      expect(typeof ex.promptId).toBe("string");
      expect(typeof ex.promptText).toBe("string");
    }
  });

  it("returns 400 when categoryId or errorCategory query params are missing", async () => {
    const res = await request(app)
      .get(`/api/admin/render-errors/examples?categoryId=${categoryId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("returns 400 for an invalid errorCategory value", async () => {
    const res = await request(app)
      .get(
        `/api/admin/render-errors/examples?categoryId=${categoryId}&errorCategory=not_a_real_category`,
      )
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid errorCategory/);
  });

  it("respects limit query param", async () => {
    const res = await request(app)
      .get(
        `/api/admin/render-errors/examples?categoryId=${categoryId}&errorCategory=kernel_error&limit=1`,
      )
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.examples.length).toBe(1);
    expect(res.body.total).toBe(2);
  });
});
