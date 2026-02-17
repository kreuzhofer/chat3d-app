import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { pool, query } from "../db/connection.js";
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
  inviter_user_id: string;
  invitee_email: string;
  status: "pending" | "waitlisted" | "registration_sent" | "accepted" | "expired" | "revoked";
  registration_token_id: string | null;
}

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const inviterEmail = `m5-inviter-${suffix}@example.test`;
const password = "S3curePass!123";
const inviteEmailA = `m5-a-${suffix}@example.test`;
const inviteEmailB = `m5-b-${suffix}@example.test`;
const inviteEmailC = `m5-c-${suffix}@example.test`;
const inviteEmailD = `m5-d-${suffix}@example.test`;
const inviteEmailE = `m5-e-${suffix}@example.test`;

async function insertUser(email: string): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await query<{ id: string }>(
    `
    INSERT INTO users (email, password_hash, display_name, role, status)
    VALUES ($1, $2, 'Milestone 5 Inviter', 'user', 'active')
    ON CONFLICT (email)
    DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      status = 'active',
      updated_at = NOW()
    RETURNING id;
    `,
    [email, passwordHash],
  );

  return result.rows[0].id;
}

async function setInvitationSettings(input: {
  enabled: boolean;
  quota: number;
  waitlistRequired: boolean;
  waitlistEnabled?: boolean;
}) {
  await query(
    `
    INSERT INTO app_settings (
      id,
      waitlist_enabled,
      invitations_enabled,
      invitation_waitlist_required,
      invitation_quota_per_user,
      updated_at
    )
    VALUES (TRUE, $1, $2, $3, $4, NOW())
    ON CONFLICT (id)
    DO UPDATE SET
      waitlist_enabled = EXCLUDED.waitlist_enabled,
      invitations_enabled = EXCLUDED.invitations_enabled,
      invitation_waitlist_required = EXCLUDED.invitation_waitlist_required,
      invitation_quota_per_user = EXCLUDED.invitation_quota_per_user,
      updated_at = NOW();
    `,
    [input.waitlistEnabled ?? false, input.enabled, input.waitlistRequired, input.quota],
  );
}

describe("Milestone 5 invitations and policy controls", () => {
  const app = createApp();
  let inviterUserId = "";
  let inviterToken = "";

  beforeAll(async () => {
    await query(`DELETE FROM invitations WHERE invitee_email = ANY($1::text[]);`, [
      [inviteEmailA, inviteEmailB, inviteEmailC, inviteEmailD, inviteEmailE],
    ]);
    await query(`DELETE FROM registration_tokens WHERE email = ANY($1::text[]);`, [
      [inviteEmailA, inviteEmailB, inviteEmailC, inviteEmailD, inviteEmailE],
    ]);
    await query(`DELETE FROM waitlist_entries WHERE email = ANY($1::text[]);`, [
      [inviteEmailA, inviteEmailB, inviteEmailC, inviteEmailD, inviteEmailE],
    ]);
    await query(`DELETE FROM users WHERE email = $1;`, [inviterEmail]);

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

    await query(`DELETE FROM invitations WHERE invitee_email = ANY($1::text[]);`, [
      [inviteEmailA, inviteEmailB, inviteEmailC, inviteEmailD, inviteEmailE],
    ]);
    await query(`DELETE FROM registration_tokens WHERE email = ANY($1::text[]);`, [
      [inviteEmailA, inviteEmailB, inviteEmailC, inviteEmailD, inviteEmailE],
    ]);
    await query(`DELETE FROM waitlist_entries WHERE email = ANY($1::text[]);`, [
      [inviteEmailA, inviteEmailB, inviteEmailC, inviteEmailD, inviteEmailE],
    ]);
    await query(`DELETE FROM notifications WHERE user_id = $1;`, [inviterUserId]);
    await query(`DELETE FROM users WHERE id = $1;`, [inviterUserId]);

    await pool.end();
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
    await query(`DELETE FROM invitations WHERE inviter_user_id = $1;`, [inviterUserId]);
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
    await query(`DELETE FROM invitations WHERE inviter_user_id = $1;`, [inviterUserId]);
    await query(`DELETE FROM notifications WHERE user_id = $1;`, [inviterUserId]);
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

    const tokenRows = await query<{ id: string }>(
      `
      SELECT id
      FROM registration_tokens
      WHERE email = $1
        AND source = 'user_invite'
        AND invited_by_user_id = $2;
      `,
      [inviteEmailC, inviterUserId],
    );

    expect(tokenRows.rows.length).toBe(1);

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
    await query(`DELETE FROM invitations WHERE inviter_user_id = $1;`, [inviterUserId]);
    await query(`DELETE FROM waitlist_entries WHERE email = $1;`, [inviteEmailD]);
    await query(`DELETE FROM registration_tokens WHERE email = $1;`, [inviteEmailD]);

    await setInvitationSettings({ enabled: true, quota: 5, waitlistRequired: true });
    emailService.clearSentEmailsForTest();

    const createResponse = await request(app)
      .post("/api/invitations")
      .set("Authorization", `Bearer ${inviterToken}`)
      .send({ emails: [inviteEmailD] });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.invitations[0].status).toBe("waitlisted");

    const waitlistRows = await query<{ status: string }>(
      `
      SELECT status
      FROM waitlist_entries
      WHERE email = $1;
      `,
      [inviteEmailD],
    );

    expect(waitlistRows.rows[0]?.status).toBe("pending_admin_approval");

    const tokenRows = await query<{ id: string }>(
      `
      SELECT id
      FROM registration_tokens
      WHERE email = $1
        AND source = 'user_invite';
      `,
      [inviteEmailD],
    );

    expect(tokenRows.rows.length).toBe(0);

    const sentEmails = emailService.getSentEmailsForTest();
    expect(sentEmails.length).toBeGreaterThan(0);
    expect(sentEmails[sentEmails.length - 1].text).toMatch(/waitlist/i);
  });

  it("lists and revokes inviter-owned invitations", async () => {
    await query(`DELETE FROM invitations WHERE inviter_user_id = $1;`, [inviterUserId]);
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
