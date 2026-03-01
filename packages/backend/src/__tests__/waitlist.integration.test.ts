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
const adminEmail = `m4-admin-${suffix}@example.test`;
const password = "S3curePass!123";
const pendingEmail = `m4-pending-${suffix}@example.test`;
const approvedEmail = `m4-approved-${suffix}@example.test`;
const rejectedEmail = `m4-rejected-${suffix}@example.test`;
const statusEmail = `m4-status-${suffix}@example.test`;

async function insertAdmin(email: string): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      displayName: "Milestone 4 Admin",
      role: "admin",
      status: "active",
    },
    update: {
      passwordHash,
      role: "admin",
      status: "active",
      updatedAt: new Date(),
    },
  });
}

function extractTokenFromText(text: string): string {
  const match = text.match(/token=([A-Za-z0-9._-]+)/);
  if (!match) {
    throw new Error(`Expected token in email text: ${text}`);
  }
  return match[1];
}

async function joinWaitlistAndConfirm(
  app: ReturnType<typeof createApp>,
  email: string,
): Promise<{ entryId: string; confirmToken: string }> {
  emailService.clearSentEmailsForTest();

  const joinResponse = await request(app).post("/api/waitlist/join").send({
    email,
    marketingConsent: true,
  });

  expect(joinResponse.status).toBe(202);
  expect(joinResponse.body.status).toBe("pending_email_confirmation");

  const sentAfterJoin = emailService.getSentEmailsForTest();
  expect(sentAfterJoin.length).toBeGreaterThan(0);
  const confirmationEmail = sentAfterJoin[sentAfterJoin.length - 1];
  expect(confirmationEmail.to).toBe(email);
  expect(confirmationEmail.subject).toContain("Confirm");

  const confirmToken = extractTokenFromText(confirmationEmail.text);

  const confirmResponse = await request(app).post("/api/waitlist/confirm").send({
    token: confirmToken,
  });

  expect(confirmResponse.status).toBe(200);
  expect(confirmResponse.body.status).toBe("pending_admin_approval");

  const entry = await prisma.waitlistEntry.findUnique({
    where: { email },
    select: { id: true, status: true },
  });

  expect(entry).toBeTruthy();
  expect(entry!.status).toBe("pending_admin_approval");

  return {
    entryId: entry!.id,
    confirmToken,
  };
}

describe("Milestone 4 waitlist and registration token flow", () => {
  const app = createApp();
  let adminToken = "";

  beforeAll(async () => {
    const allEmails = [adminEmail, pendingEmail, approvedEmail, rejectedEmail];
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });

    const waitlistEmails = [pendingEmail, approvedEmail, rejectedEmail, statusEmail];
    await prisma.waitlistEntry.deleteMany({ where: { email: { in: waitlistEmails } } });
    await prisma.registrationToken.deleteMany({ where: { email: { in: waitlistEmails } } });

    await insertAdmin(adminEmail);

    await prisma.appSettings.upsert({
      where: { id: true },
      create: {
        id: true,
        waitlistEnabled: true,
        invitationsEnabled: true,
        invitationWaitlistRequired: false,
        invitationQuotaPerUser: 3,
        updatedAt: new Date(),
      },
      update: {
        waitlistEnabled: true,
        updatedAt: new Date(),
      },
    });

    const adminLogin = await request(app).post("/api/auth/login").send({
      email: adminEmail,
      password,
    });

    expect(adminLogin.status).toBe(200);
    adminToken = (adminLogin.body as LoginResponse).token;
  });

  afterAll(async () => {
    await prisma.appSettings.updateMany({
      where: { id: true },
      data: { waitlistEnabled: false, updatedAt: new Date() },
    });

    const waitlistEmails = [pendingEmail, approvedEmail, rejectedEmail, statusEmail];
    await prisma.registrationToken.deleteMany({ where: { email: { in: waitlistEmails } } });
    await prisma.waitlistEntry.deleteMany({ where: { email: { in: waitlistEmails } } });

    const allEmails = [adminEmail, pendingEmail, approvedEmail, rejectedEmail, statusEmail];
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });

    await prisma.$disconnect();
  });

  it("blocks waitlisted users from registering before admin approval", async () => {
    await joinWaitlistAndConfirm(app, pendingEmail);

    const registerResponse = await request(app).post("/api/auth/register").send({
      email: pendingEmail,
      password,
      displayName: "Pending user",
    });

    expect(registerResponse.status).toBe(403);
    expect(registerResponse.body.error).toContain("registration token");
  });

  it("supports canonical GET confirmation and waitlist status checks", async () => {
    emailService.clearSentEmailsForTest();

    const joinResponse = await request(app).post("/api/waitlist/join").send({
      email: statusEmail,
      marketingConsent: true,
    });

    expect(joinResponse.status).toBe(202);

    const sentAfterJoin = emailService.getSentEmailsForTest();
    const confirmationEmail = sentAfterJoin[sentAfterJoin.length - 1];
    const confirmToken = extractTokenFromText(confirmationEmail.text);

    const statusByEmailBefore = await request(app).get(`/api/waitlist/status?email=${encodeURIComponent(statusEmail)}`);
    expect(statusByEmailBefore.status).toBe(200);
    expect(statusByEmailBefore.body.status).toBe("pending_email_confirmation");

    const statusByTokenBefore = await request(app).get(`/api/waitlist/status?token=${encodeURIComponent(confirmToken)}`);
    expect(statusByTokenBefore.status).toBe(200);
    expect(statusByTokenBefore.body.status).toBe("pending_email_confirmation");

    const confirmViaGet = await request(app).get(`/api/waitlist/confirm-email?token=${encodeURIComponent(confirmToken)}`);
    expect(confirmViaGet.status).toBe(200);
    expect(confirmViaGet.body.status).toBe("pending_admin_approval");

    const statusByEmailAfter = await request(app).get(`/api/waitlist/status?email=${encodeURIComponent(statusEmail)}`);
    expect(statusByEmailAfter.status).toBe(200);
    expect(statusByEmailAfter.body.status).toBe("pending_admin_approval");
  });

  it("allows admin to reject waitlist entries", async () => {
    const { entryId } = await joinWaitlistAndConfirm(app, rejectedEmail);

    const rejectResponse = await request(app)
      .post(`/api/admin/waitlist/${entryId}/reject`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(rejectResponse.status).toBe(200);
    expect(rejectResponse.body.status).toBe("rejected");
  });

  it("approves waitlist entries and allows exactly one registration with token", async () => {
    const { entryId } = await joinWaitlistAndConfirm(app, approvedEmail);

    emailService.clearSentEmailsForTest();

    const approveResponse = await request(app)
      .post(`/api/admin/waitlist/${entryId}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(approveResponse.status).toBe(200);
    expect(approveResponse.body.status).toBe("approved");

    const sentAfterApproval = emailService.getSentEmailsForTest();
    expect(sentAfterApproval.length).toBeGreaterThan(0);
    const approvalEmail = sentAfterApproval[sentAfterApproval.length - 1];
    expect(approvalEmail.to).toBe(approvedEmail);
    expect(approvalEmail.subject).toContain("Registration");

    const registrationToken = extractTokenFromText(approvalEmail.text);

    const firstRegisterResponse = await request(app).post("/api/auth/register").send({
      email: approvedEmail,
      password,
      displayName: "Approved user",
      registrationToken,
    });

    expect(firstRegisterResponse.status).toBe(201);

    await prisma.user.deleteMany({ where: { email: approvedEmail } });

    const secondRegisterResponse = await request(app).post("/api/auth/register").send({
      email: approvedEmail,
      password,
      displayName: "Approved user again",
      registrationToken,
    });

    expect(secondRegisterResponse.status).toBe(403);
    expect(secondRegisterResponse.body.error).toMatch(/registration token/i);
  });
});
