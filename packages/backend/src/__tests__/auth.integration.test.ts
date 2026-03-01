import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { prisma } from "../db/prisma.js";
import { notificationService } from "../services/notification.service.js";

interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: "admin" | "user";
    status: "active" | "deactivated" | "pending_registration";
    displayName: string | null;
  };
}

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const registeredEmail = `m2-register-${suffix}@example.test`;
const userEmail = `m2-user-${suffix}@example.test`;
const adminEmail = `m2-admin-${suffix}@example.test`;
const deactivatedEmail = `m2-deactivated-${suffix}@example.test`;
const password = "S3curePass!123";
let userId = "";
let adminId = "";
let deactivatedUserId = "";

async function insertUser(
  email: string,
  role: "admin" | "user",
  status: "active" | "deactivated" | "pending_registration",
) {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: `${role} test`,
      role,
      status,
    },
    select: { id: true },
  });
  return user.id;
}

describe("Milestone 2/3 auth and events integration", () => {
  const app = createApp();

  beforeAll(async () => {
    await prisma.appSettings.update({
      where: { id: true },
      data: { waitlistEnabled: false, updatedAt: new Date() },
    });

    const allEmails = [registeredEmail, userEmail, adminEmail, deactivatedEmail];
    await prisma.user.deleteMany({
      where: { email: { in: allEmails } },
    });

    userId = await insertUser(userEmail, "user", "active");
    adminId = await insertUser(adminEmail, "admin", "active");
    deactivatedUserId = await insertUser(deactivatedEmail, "user", "deactivated");

    await prisma.notification.deleteMany({
      where: { userId: { in: [userId, adminId, deactivatedUserId] } },
    });
  });

  afterAll(async () => {
    const allEmails = [registeredEmail, userEmail, adminEmail, deactivatedEmail];
    await prisma.user.deleteMany({
      where: { email: { in: allEmails } },
    });
    await prisma.$disconnect();
  });

  it("registers a user with hashed password and issues a token", async () => {
    const registerResponse = await request(app).post("/api/auth/register").send({
      email: registeredEmail,
      password,
      displayName: "Registered User",
    });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.token).toBeTypeOf("string");
    expect(registerResponse.body.user.email).toBe(registeredEmail);
    expect(registerResponse.body.user.role).toBe("user");
    expect(registerResponse.body.user.status).toBe("active");

    const storedUser = await prisma.user.findFirst({
      where: { email: registeredEmail },
      select: { passwordHash: true },
    });

    const hash = storedUser?.passwordHash;
    expect(hash).toBeTruthy();
    expect(hash).not.toBe(password);
    expect(await bcrypt.compare(password, hash!)).toBe(true);
  });

  it("logs in and returns the authenticated profile on /api/auth/me", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      email: userEmail,
      password,
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.email).toBe(userEmail);

    const token = (loginResponse.body as LoginResponse).token;
    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.email).toBe(userEmail);
    expect(meResponse.body.role).toBe("user");
    expect(meResponse.body.status).toBe("active");
  });

  it("supports /api/auth/logout for authenticated users", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      email: userEmail,
      password,
    });

    expect(loginResponse.status).toBe(200);
    const token = (loginResponse.body as LoginResponse).token;

    const logoutResponse = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`);

    expect(logoutResponse.status).toBe(204);
  });

  it("blocks non-admin access to admin routes and allows admin users", async () => {
    const userLogin = await request(app).post("/api/auth/login").send({
      email: userEmail,
      password,
    });
    const userToken = (userLogin.body as LoginResponse).token;

    const userAdminResponse = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${userToken}`);

    expect(userAdminResponse.status).toBe(403);

    const adminLogin = await request(app).post("/api/auth/login").send({
      email: adminEmail,
      password,
    });
    const adminToken = (adminLogin.body as LoginResponse).token;

    const adminUsersResponse = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(adminUsersResponse.status).toBe(200);
    expect(Array.isArray(adminUsersResponse.body.users)).toBe(true);
    expect(adminUsersResponse.body.users.length).toBeGreaterThan(0);
  });

  it("denies login and authenticated access for deactivated users", async () => {
    const deactivatedLogin = await request(app).post("/api/auth/login").send({
      email: deactivatedEmail,
      password,
    });

    expect(deactivatedLogin.status).toBe(403);

    const activeLogin = await request(app).post("/api/auth/login").send({
      email: userEmail,
      password,
    });
    const token = (activeLogin.body as LoginResponse).token;

    await prisma.user.update({
      where: { email: userEmail },
      data: { status: "deactivated" },
    });

    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(meResponse.status).toBe(403);

    await prisma.user.update({
      where: { email: userEmail },
      data: { status: "active" },
    });
  });

  it("rejects unauthorized SSE stream requests", async () => {
    const response = await request(app).get("/api/events/stream");
    expect(response.status).toBe(401);
  });

  it("returns persisted notifications via replay endpoint", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      email: userEmail,
      password,
    });
    const token = (loginResponse.body as LoginResponse).token;

    const first = await notificationService.publishToUser(userId, "notification.created", {
      step: "first",
    });
    await notificationService.publishToUser(userId, "notification.created", {
      step: "second",
    });

    const replayResponse = await request(app)
      .get(`/api/events/replay?afterId=${first.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(replayResponse.status).toBe(200);
    expect(Array.isArray(replayResponse.body.notifications)).toBe(true);
    expect(
      replayResponse.body.notifications.some(
        (notification: { payload: { step?: string } }) => notification.payload?.step === "second",
      ),
    ).toBe(true);
  });
});
