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

interface InvitationRow {
  id: string;
  inviterUserId: string;
  inviteeEmail: string;
  status: "pending" | "waitlisted" | "registration_sent" | "accepted" | "expired" | "revoked";
  registrationTokenId: string | null;
}

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const inviterEmail = `m5-inviter-${suffix}@example.test`;
const password = "S3curePass!123";
const inviteEmailA = `m5-a-${suffix}@example.test`;
const inviteEmailB = `m5-b-${suffix}@example.test`;
const inviteEmailC = `m5-c-${suffix}@example.test`;
const inviteEmailD = `m5-d-${suffix}@example.test`;
const inviteEmailE = `m5-e-${suffix}@example.test`;

const allInviteEmails = [inviteEmailA, inviteEmailB, inviteEmailC, inviteEmailD, inviteEmailE];

async function insertUser(email: string): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      displayName: "Milestone 5 Inviter",
      role: "user",
      status: "active",
    },
    update: {
      passwordHash,
      status: "active",
      updatedAt: new Date(),
    },
    select: { id: true },
  });

  return user.id;
}

async function setInvitationSettings(input: {
  enabled: boolean;
  quota: number;
  waitlistRequired: boolean;
  waitlistEnabled?: boolean;
}) {
  await prisma.appSettings.upsert({
    where: { id: true },
    create: {
      id: true,
      waitlistEnabled: input.waitlistEnabled ?? false,
      invitationsEnabled: input.enabled,
      invitationWaitlistRequired: input.waitlistRequired,
      invitationQuotaPerUser: input.quota,
      updatedAt: new Date(),
    },
    update: {
      waitlistEnabled: input.waitlistEnabled ?? false,
      invitationsEnabled: input.enabled,
      invitationWaitlistRequired: input.waitlistRequired,
      invitationQuotaPerUser: input.quota,
      updatedAt: new Date(),
    },
  });
}

describe("Milestone 5 invitations and policy controls", () => {
  const app = createApp();
  let inviterUserId = "";
  let inviterToken = "";

  beforeAll(async () => {
    await prisma.invitation.deleteMany({ where: { inviteeEmail: { in: allInviteEmails } } });
    await prisma.registrationToken.deleteMany({ where: { email: { in: allInviteEmails } } });
    await prisma.waitlistEntry.deleteMany({ where: { email: { in: allInviteEmails } } });
    await prisma.user.deleteMany({ where: { email: inviterEmail } });

    inviterUserId = await insertUser(inviterEmail);

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: inviterEmail,
      password,
    });

    expect(loginResponse.status).toBe(200);
    inviterToken = (loginResponse.body as LoginResponse).token;
  });

  afterAll(async () => {
    await setInvitationSettings({ enabled: true, quota: 3, waitlistRequired: false, waitlistEnabled: false });

    await prisma.invitation.deleteMany({ where: { inviteeEmail: { in: allInviteEmails } } });
    await prisma.registrationToken.deleteMany({ where: { email: { in: allInviteEmails } } });
    await prisma.waitlistEntry.deleteMany({ where: { email: { in: allInviteEmails } } });
    await prisma.notification.deleteMany({ where: { userId: inviterUserId } });
    await prisma.user.deleteMany({ where: { id: inviterUserId } });

    await prisma.$disconnect();
  });

  it("blocks invitation creation when invitations feature is disabled", async () => {
    await setInvitationSettings({ enabled: false, quota: 10, waitlistRequired: false });

    const response = await request(app)
      .post("/api/invitations")
      .set("Authorization", `Bearer ${inviterToken}`)
      .send({ emails: [inviteEmailA] });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/disabled/i);
  });

  it("enforces per-user invitation quota", async () => {
    await prisma.invitation.deleteMany({ where: { inviterUserId } });
    await setInvitationSettings({ enabled: true, quota: 1, waitlistRequired: false, waitlistEnabled: true });

    const first = await request(app)
      .post("/api/invitations")
      .set("Authorization", `Bearer ${inviterToken}`)
      .send({ emails: [inviteEmailA] });

    expect(first.status).toBe(201);
    expect(first.body.invitations[0].status).toBe("registration_sent");

    const second = await request(app)
      .post("/api/invitations")
      .set("Authorization", `Bearer ${inviterToken}`)
      .send({ emails: [inviteEmailB] });

    expect(second.status).toBe(403);
    expect(second.body.error).toMatch(/quota/i);
  });

  it("sends direct registration invitation email and emits invitation notification", async () => {
    await prisma.invitation.deleteMany({ where: { inviterUserId } });
    await prisma.notification.deleteMany({ where: { userId: inviterUserId } });
    await setInvitationSettings({ enabled: true, quota: 5, waitlistRequired: false, waitlistEnabled: true });
    emailService.clearSentEmailsForTest();

    const createResponse = await request(app)
      .post("/api/invitations")
      .set("Authorization", `Bearer ${inviterToken}`)
      .send({ emails: [inviteEmailC] });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.invitations[0].status).toBe("registration_sent");

    const sentEmails = emailService.getSentEmailsForTest();
    expect(sentEmails.length).toBeGreaterThan(0);
    const invitationEmail = sentEmails[sentEmails.length - 1];
    expect(invitationEmail.to).toBe(inviteEmailC);
    expect(invitationEmail.text).toContain("token=");

    const tokenCount = await prisma.registrationToken.count({
      where: {
        email: inviteEmailC,
        source: "user_invite",
        invitedByUserId: inviterUserId,
      },
    });

    expect(tokenCount).toBe(1);

    const replayResponse = await request(app)
      .get("/api/events/replay")
      .set("Authorization", `Bearer ${inviterToken}`);

    expect(replayResponse.status).toBe(200);
    expect(
      replayResponse.body.notifications.some(
        (notification: { payload?: { domain?: string; action?: string; inviteeEmail?: string } }) =>
          notification.payload?.domain === "invitation" &&
          notification.payload?.action === "created" &&
          notification.payload?.inviteeEmail === inviteEmailC,
      ),
    ).toBe(true);
  });

  it("routes invited users into waitlist when invitation waitlist policy is enabled", async () => {
    await prisma.invitation.deleteMany({ where: { inviterUserId } });
    await prisma.waitlistEntry.deleteMany({ where: { email: inviteEmailD } });
    await prisma.registrationToken.deleteMany({ where: { email: inviteEmailD } });

    await setInvitationSettings({ enabled: true, quota: 5, waitlistRequired: true });
    emailService.clearSentEmailsForTest();

    const createResponse = await request(app)
      .post("/api/invitations")
      .set("Authorization", `Bearer ${inviterToken}`)
      .send({ emails: [inviteEmailD] });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.invitations[0].status).toBe("waitlisted");

    const waitlistEntry = await prisma.waitlistEntry.findUnique({
      where: { email: inviteEmailD },
      select: { status: true },
    });

    expect(waitlistEntry?.status).toBe("pending_admin_approval");

    const tokenCount = await prisma.registrationToken.count({
      where: {
        email: inviteEmailD,
        source: "user_invite",
      },
    });

    expect(tokenCount).toBe(0);

    const sentEmails = emailService.getSentEmailsForTest();
    expect(sentEmails.length).toBeGreaterThan(0);
    expect(sentEmails[sentEmails.length - 1].text).toMatch(/waitlist/i);
  });

  it("lists and revokes inviter-owned invitations", async () => {
    await prisma.invitation.deleteMany({ where: { inviterUserId } });
    await setInvitationSettings({ enabled: true, quota: 5, waitlistRequired: false, waitlistEnabled: true });

    const createResponse = await request(app)
      .post("/api/invitations")
      .set("Authorization", `Bearer ${inviterToken}`)
      .send({ emails: [inviteEmailE] });

    expect(createResponse.status).toBe(201);
    const invitationId = createResponse.body.invitations[0].id;

    const listResponse = await request(app)
      .get("/api/invitations")
      .set("Authorization", `Bearer ${inviterToken}`);

    expect(listResponse.status).toBe(200);
    expect(
      listResponse.body.invitations.some((invitation: InvitationRow) => invitation.id === invitationId),
    ).toBe(true);

    const revokeResponse = await request(app)
      .delete(`/api/invitations/${invitationId}`)
      .set("Authorization", `Bearer ${inviterToken}`);

    expect(revokeResponse.status).toBe(200);
    expect(revokeResponse.body.status).toBe("revoked");
  });
});
