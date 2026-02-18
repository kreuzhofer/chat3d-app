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

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const initialEmail = `m7-user-${suffix}@example.test`;
const changedEmail = `m7-user-changed-${suffix}@example.test`;
const initialPassword = "S3curePass!123";
const newPassword = "N3wS3curePass!456";

function extractTokenFromText(text: string): string {
  const match = text.match(/token=([A-Za-z0-9._-]+)/);
  if (!match) {
    throw new Error(`Expected token in email text: ${text}`);
  }
  return match[1];
}

async function upsertUser(email: string, password: string): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await query<{ id: string }>(
    `
    INSERT INTO users (email, password_hash, display_name, role, status)
    VALUES ($1, $2, 'Milestone 7 User', 'user', 'active')
    ON CONFLICT (email)
    DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      display_name = EXCLUDED.display_name,
      role = 'user',
      status = 'active',
      deactivated_until = NULL,
      updated_at = NOW()
    RETURNING id;
    `,
    [email, passwordHash],
  );

  return result.rows[0].id;
}

describe("Milestone 7 profile account lifecycle", () => {
  const app = createApp();
  let userId = "";
  let authToken = "";
  let currentEmail = initialEmail;
  let currentPassword = initialPassword;

  beforeAll(async () => {
    await query(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]));`, [
      [initialEmail, changedEmail],
    ]);
    await query(`DELETE FROM account_actions WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]));`, [
      [initialEmail, changedEmail],
    ]);
    await query(`DELETE FROM users WHERE email = ANY($1::text[]);`, [[initialEmail, changedEmail]]);

    userId = await upsertUser(initialEmail, initialPassword);

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: currentEmail,
      password: currentPassword,
    });

    expect(loginResponse.status).toBe(200);
    authToken = (loginResponse.body as LoginResponse).token;
  });

  afterAll(async () => {
    await query(`DELETE FROM notifications WHERE user_id = $1;`, [userId]);
    await query(`DELETE FROM account_actions WHERE user_id = $1;`, [userId]);
    await query(`DELETE FROM users WHERE id = $1 OR email = ANY($2::text[]);`, [userId, [initialEmail, changedEmail]]);
    await pool.end();
  });

  it("resets password via email-confirmed action", async () => {
    emailService.clearSentEmailsForTest();

    const requestResponse = await request(app)
      .post("/api/profile/reset-password/request")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ newPassword });

    expect(requestResponse.status).toBe(202);

    const email = emailService.getSentEmailsForTest().at(-1);
    expect(email?.to).toBe(currentEmail);
    const token = extractTokenFromText(email?.text ?? "");

    const confirmResponse = await request(app).get(`/api/profile/actions/confirm?token=${token}`);
    expect(confirmResponse.status).toBe(200);
    expect(confirmResponse.body.actionType).toBe("password_reset");

    const oldLogin = await request(app).post("/api/auth/login").send({
      email: currentEmail,
      password: currentPassword,
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post("/api/auth/login").send({
      email: currentEmail,
      password: newPassword,
    });
    expect(newLogin.status).toBe(200);

    currentPassword = newPassword;
    authToken = (newLogin.body as LoginResponse).token;
  });

  it("changes email via confirmation token", async () => {
    emailService.clearSentEmailsForTest();

    const requestResponse = await request(app)
      .post("/api/profile/change-email/request")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ newEmail: changedEmail });

    expect(requestResponse.status).toBe(202);

    const email = emailService.getSentEmailsForTest().at(-1);
    expect(email?.to).toBe(changedEmail);
    const token = extractTokenFromText(email?.text ?? "");

    const confirmResponse = await request(app).get(`/api/profile/actions/confirm?token=${token}`);
    expect(confirmResponse.status).toBe(200);
    expect(confirmResponse.body.actionType).toBe("email_change");

    const oldEmailLogin = await request(app).post("/api/auth/login").send({
      email: initialEmail,
      password: currentPassword,
    });
    expect(oldEmailLogin.status).toBe(401);

    const newEmailLogin = await request(app).post("/api/auth/login").send({
      email: changedEmail,
      password: currentPassword,
    });
    expect(newEmailLogin.status).toBe(200);

    currentEmail = changedEmail;
    authToken = (newEmailLogin.body as LoginResponse).token;
  });

  it("creates export action and sends export payload email on confirm", async () => {
    emailService.clearSentEmailsForTest();

    const requestResponse = await request(app)
      .post("/api/profile/export-data/request")
      .set("Authorization", `Bearer ${authToken}`)
      .send({});

    expect(requestResponse.status).toBe(202);
    const requestEmail = emailService.getSentEmailsForTest().at(-1);
    expect(requestEmail?.to).toBe(currentEmail);
    const token = extractTokenFromText(requestEmail?.text ?? "");

    const confirmResponse = await request(app).get(`/api/profile/actions/confirm?token=${token}`);
    expect(confirmResponse.status).toBe(200);
    expect(confirmResponse.body.actionType).toBe("data_export");

    const exportEmail = emailService.getSentEmailsForTest().at(-1);
    expect(exportEmail?.subject).toMatch(/data export/i);
    expect(exportEmail?.to).toBe(currentEmail);
    expect(exportEmail?.text).toContain("chatContexts");
    expect(exportEmail?.text).toContain("chatItems");
  });

  it("deactivates account for 30 days after delete confirmation and allows self-reactivation", async () => {
    emailService.clearSentEmailsForTest();

    const deleteRequest = await request(app)
      .post("/api/profile/delete-account/request")
      .set("Authorization", `Bearer ${authToken}`)
      .send({});
    expect(deleteRequest.status).toBe(202);

    const deleteEmail = emailService.getSentEmailsForTest().at(-1);
    expect(deleteEmail?.to).toBe(currentEmail);
    const deleteToken = extractTokenFromText(deleteEmail?.text ?? "");

    const deleteConfirm = await request(app).get(`/api/profile/actions/confirm?token=${deleteToken}`);
    expect(deleteConfirm.status).toBe(200);
    expect(deleteConfirm.body.actionType).toBe("account_delete");

    const userResult = await query<{ status: string; deactivated_until: string | null }>(
      `
      SELECT status, deactivated_until::text
      FROM users
      WHERE id = $1;
      `,
      [userId],
    );

    expect(userResult.rows[0]?.status).toBe("deactivated");
    expect(userResult.rows[0]?.deactivated_until).not.toBeNull();

    const blockedLogin = await request(app).post("/api/auth/login").send({
      email: currentEmail,
      password: currentPassword,
    });
    expect(blockedLogin.status).toBe(403);

    emailService.clearSentEmailsForTest();

    const reactivateRequest = await request(app).post("/api/profile/reactivate/request").send({
      email: currentEmail,
    });
    expect(reactivateRequest.status).toBe(202);

    const reactivateEmail = emailService.getSentEmailsForTest().at(-1);
    expect(reactivateEmail?.to).toBe(currentEmail);
    const reactivateToken = extractTokenFromText(reactivateEmail?.text ?? "");

    const reactivateConfirm = await request(app).get(`/api/profile/actions/confirm?token=${reactivateToken}`);
    expect(reactivateConfirm.status).toBe(200);
    expect(reactivateConfirm.body.actionType).toBe("account_reactivate");

    const activeLogin = await request(app).post("/api/auth/login").send({
      email: currentEmail,
      password: currentPassword,
    });
    expect(activeLogin.status).toBe(200);
    authToken = (activeLogin.body as LoginResponse).token;
  });
});
