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

interface WaitlistEntryRow {
  id: string;
  status: "pending_email_confirmation" | "pending_admin_approval" | "approved" | "rejected";
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
  await query(
    `
    INSERT INTO users (email, password_hash, display_name, role, status)
    VALUES ($1, $2, 'Milestone 4 Admin', 'admin', 'active')
    ON CONFLICT (email)
    DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      role = 'admin',
      status = 'active',
      updated_at = NOW();
    `,
    [email, passwordHash],
  );
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

  const entryResult = await query<WaitlistEntryRow>(
    `
    SELECT id, status
    FROM waitlist_entries
    WHERE email = $1;
    `,
    [email],
  );

  const entry = entryResult.rows[0];
  expect(entry).toBeTruthy();
  expect(entry.status).toBe("pending_admin_approval");

  return {
    entryId: entry.id,
    confirmToken,
  };
}

describe("Milestone 4 waitlist and registration token flow", () => {
  const app = createApp();
  let adminToken = "";

  beforeAll(async () => {
    await query(
      `
      DELETE FROM users
      WHERE email = ANY($1::text[]);
      `,
      [[adminEmail, pendingEmail, approvedEmail, rejectedEmail]],
    );

    await query(
      `
      DELETE FROM waitlist_entries
      WHERE email = ANY($1::text[]);
      `,
      [[pendingEmail, approvedEmail, rejectedEmail, statusEmail]],
    );

    await query(
      `
      DELETE FROM registration_tokens
      WHERE email = ANY($1::text[]);
      `,
      [[pendingEmail, approvedEmail, rejectedEmail, statusEmail]],
    );

    await insertAdmin(adminEmail);

    await query(
      `
      INSERT INTO app_settings (id, waitlist_enabled, invitations_enabled, invitation_waitlist_required, invitation_quota_per_user, updated_at)
      VALUES (TRUE, TRUE, TRUE, FALSE, 3, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        waitlist_enabled = TRUE,
        updated_at = NOW();
      `,
    );

    const adminLogin = await request(app).post("/api/auth/login").send({
      email: adminEmail,
      password,
    });

    expect(adminLogin.status).toBe(200);
    adminToken = (adminLogin.body as LoginResponse).token;
  });

  afterAll(async () => {
    await query(
      `
      UPDATE app_settings
      SET waitlist_enabled = FALSE,
          updated_at = NOW()
      WHERE id = TRUE;
      `,
    );

    await query(
      `
      DELETE FROM registration_tokens
      WHERE email = ANY($1::text[]);
      `,
      [[pendingEmail, approvedEmail, rejectedEmail, statusEmail]],
    );

    await query(
      `
      DELETE FROM waitlist_entries
      WHERE email = ANY($1::text[]);
      `,
      [[pendingEmail, approvedEmail, rejectedEmail, statusEmail]],
    );

    await query(
      `
      DELETE FROM users
      WHERE email = ANY($1::text[]);
      `,
      [[adminEmail, pendingEmail, approvedEmail, rejectedEmail, statusEmail]],
    );

    await pool.end();
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

    await query(`DELETE FROM users WHERE email = $1;`, [approvedEmail]);

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
