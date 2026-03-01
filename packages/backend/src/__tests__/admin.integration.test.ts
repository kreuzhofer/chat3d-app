import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { prisma } from "../db/prisma.js";
import { emailService } from "../services/email.service.js";

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
const adminEmail = `m6-admin-${suffix}@example.test`;
const userEmail = `m6-user-${suffix}@example.test`;
const password = "S3curePass!123";

async function upsertUser(input: {
  email: string;
  role: "admin" | "user";
  displayName: string;
  status?: "active" | "deactivated" | "pending_registration";
}): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      passwordHash,
      displayName: input.displayName,
      role: input.role,
      status: input.status ?? "active",
    },
    update: {
      passwordHash,
      displayName: input.displayName,
      role: input.role,
      status: input.status ?? "active",
      updatedAt: new Date(),
    },
    select: { id: true },
  });

  return user.id;
}

describe("Milestone 6 admin APIs", () => {
  const app = createApp();
  let adminId = "";
  let userId = "";
  let adminToken = "";
  let userToken = "";

  beforeAll(async () => {
    const emails = [adminEmail, userEmail];
    await prisma.notification.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.accountAction.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });

    adminId = await upsertUser({ email: adminEmail, role: "admin", displayName: "Admin M6" });
    userId = await upsertUser({ email: userEmail, role: "user", displayName: "User SearchTarget" });

    await prisma.appSettings.upsert({
      where: { id: true },
      create: {
        id: true,
        waitlistEnabled: false,
        invitationsEnabled: true,
        invitationWaitlistRequired: false,
        invitationQuotaPerUser: 3,
        updatedBy: adminId,
        updatedAt: new Date(),
      },
      update: {
        waitlistEnabled: false,
        invitationsEnabled: true,
        invitationWaitlistRequired: false,
        invitationQuotaPerUser: 3,
        updatedBy: adminId,
        updatedAt: new Date(),
      },
    });

    const adminLogin = await request(app).post("/api/auth/login").send({
      email: adminEmail,
      password,
    });
    expect(adminLogin.status).toBe(200);
    adminToken = (adminLogin.body as LoginResponse).token;

    const userLogin = await request(app).post("/api/auth/login").send({
      email: userEmail,
      password,
    });
    expect(userLogin.status).toBe(200);
    userToken = (userLogin.body as LoginResponse).token;
  });

  afterAll(async () => {
    await prisma.appSettings.updateMany({ where: { updatedBy: { in: [adminId, userId] } }, data: { updatedBy: null } });
    await prisma.notification.deleteMany({ where: { userId: { in: [adminId, userId] } } });
    await prisma.accountAction.deleteMany({ where: { userId: { in: [adminId, userId] } } });
    await prisma.adminAuditLog.deleteMany({
      where: { OR: [{ adminUserId: adminId }, { targetUserId: userId }] },
    });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });

    await prisma.$disconnect();
  });

  it("lists users and supports search filter", async () => {
    const response = await request(app)
      .get("/api/admin/users?search=SearchTarget")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.users)).toBe(true);
    expect(
      response.body.users.some((user: { id: string; email: string }) => user.id === userId && user.email === userEmail),
    ).toBe(true);
  });

  it("blocks non-admin access to admin users endpoint", async () => {
    const response = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${userToken}`);

    expect(response.status).toBe(403);
  });

  it("deactivates and reactivates a user with audit records and status-change events", async () => {
    const deactivateResponse = await request(app)
      .patch(`/api/admin/users/${userId}/deactivate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "suspicious-activity" });

    expect(deactivateResponse.status).toBe(200);
    expect(deactivateResponse.body.status).toBe("deactivated");

    const loginWhileDeactivated = await request(app).post("/api/auth/login").send({
      email: userEmail,
      password,
    });

    expect(loginWhileDeactivated.status).toBe(403);

    const statusEventRows = await prisma.notification.findMany({
      where: { userId },
      orderBy: { id: "desc" },
      select: { eventType: true, payload: true },
    });

    expect(
      statusEventRows.some((row) => row.eventType === "account.status.changed" && (row.payload as { action?: string })?.action === "deactivated"),
    ).toBe(true);

    const activateResponse = await request(app)
      .patch(`/api/admin/users/${userId}/activate`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(activateResponse.status).toBe(200);
    expect(activateResponse.body.status).toBe("active");

    const loginAfterActivate = await request(app).post("/api/auth/login").send({
      email: userEmail,
      password,
    });

    expect(loginAfterActivate.status).toBe(200);

    const auditRows = await prisma.adminAuditLog.findMany({
      where: { adminUserId: adminId, targetUserId: userId },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });

    expect(auditRows.some((row) => row.action === "user.deactivated")).toBe(true);
    expect(auditRows.some((row) => row.action === "user.activated")).toBe(true);
  });

  it("triggers admin password reset workflow with email", async () => {
    emailService.clearSentEmailsForTest();

    const response = await request(app)
      .post(`/api/admin/users/${userId}/reset-password`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(202);

    const actionRow = await prisma.accountAction.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { actionType: true, status: true },
    });

    expect(actionRow?.actionType).toBe("password_reset");
    expect(actionRow?.status).toBe("pending");

    const emails = emailService.getSentEmailsForTest();
    expect(emails.length).toBeGreaterThan(0);
    expect(emails[emails.length - 1].to).toBe(userEmail);
    expect(emails[emails.length - 1].text).toContain("token=");
  });

  it("reads and updates admin settings and emits settings update event", async () => {
    const getBefore = await request(app)
      .get("/api/admin/settings")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(getBefore.status).toBe(200);
    expect(getBefore.body.invitationsEnabled).toBe(true);

    const patchResponse = await request(app)
      .patch("/api/admin/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        waitlistEnabled: true,
        invitationsEnabled: false,
        invitationWaitlistRequired: true,
        invitationQuotaPerUser: 7,
      });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.waitlistEnabled).toBe(true);
    expect(patchResponse.body.invitationsEnabled).toBe(false);
    expect(patchResponse.body.invitationWaitlistRequired).toBe(true);
    expect(patchResponse.body.invitationQuotaPerUser).toBe(7);

    const replayResponse = await request(app)
      .get("/api/events/replay")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(replayResponse.status).toBe(200);
    expect(
      replayResponse.body.notifications.some(
        (notification: { eventType?: string; payload?: { action?: string } }) =>
          notification.eventType === "admin.settings.updated" && notification.payload?.action === "updated",
      ),
    ).toBe(true);
  });
});
