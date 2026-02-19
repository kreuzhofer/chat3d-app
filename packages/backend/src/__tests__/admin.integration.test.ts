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

  const result = await query<{ id: string }>(
    `
    INSERT INTO users (email, password_hash, display_name, role, status)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (email)
    DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      display_name = EXCLUDED.display_name,
      role = EXCLUDED.role,
      status = EXCLUDED.status,
      updated_at = NOW()
    RETURNING id;
    `,
    [input.email, passwordHash, input.displayName, input.role, input.status ?? "active"],
  );

  return result.rows[0].id;
}

describe("Milestone 6 admin APIs", () => {
  const app = createApp();
  let adminId = "";
  let userId = "";
  let adminToken = "";
  let userToken = "";

  beforeAll(async () => {
    await query(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]));`, [
      [adminEmail, userEmail],
    ]);
    await query(`DELETE FROM account_actions WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]));`, [
      [adminEmail, userEmail],
    ]);
    await query(`DELETE FROM users WHERE email = ANY($1::text[]);`, [[adminEmail, userEmail]]);

    adminId = await upsertUser({ email: adminEmail, role: "admin", displayName: "Admin M6" });
    userId = await upsertUser({ email: userEmail, role: "user", displayName: "User SearchTarget" });

    await query(
      `
      INSERT INTO app_settings (
        id,
        waitlist_enabled,
        invitations_enabled,
        invitation_waitlist_required,
        invitation_quota_per_user,
        updated_by,
        updated_at
      )
      VALUES (TRUE, FALSE, TRUE, FALSE, 3, $1, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        waitlist_enabled = FALSE,
        invitations_enabled = TRUE,
        invitation_waitlist_required = FALSE,
        invitation_quota_per_user = 3,
        updated_by = $1,
        updated_at = NOW();
      `,
      [adminId],
    );

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
    await query(`UPDATE app_settings SET updated_by = NULL WHERE updated_by IN ($1, $2);`, [adminId, userId]);
    await query(`DELETE FROM notifications WHERE user_id IN ($1, $2);`, [adminId, userId]);
    await query(`DELETE FROM account_actions WHERE user_id IN ($1, $2);`, [adminId, userId]);
    await query(`DELETE FROM admin_audit_logs WHERE admin_user_id = $1 OR target_user_id = $2;`, [adminId, userId]);
    await query(`DELETE FROM users WHERE id IN ($1, $2);`, [adminId, userId]);

    await pool.end();
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

    const statusEventRows = await query<{ event_type: string; payload: { action?: string } }>(
      `
      SELECT event_type, payload
      FROM notifications
      WHERE user_id = $1
      ORDER BY id DESC;
      `,
      [userId],
    );

    expect(
      statusEventRows.rows.some((row) => row.event_type === "account.status.changed" && row.payload?.action === "deactivated"),
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

    const auditRows = await query<{ action: string }>(
      `
      SELECT action
      FROM admin_audit_logs
      WHERE admin_user_id = $1
        AND target_user_id = $2
      ORDER BY created_at ASC;
      `,
      [adminId, userId],
    );

    expect(auditRows.rows.some((row) => row.action === "user.deactivated")).toBe(true);
    expect(auditRows.rows.some((row) => row.action === "user.activated")).toBe(true);
  });

  it("triggers admin password reset workflow with email", async () => {
    emailService.clearSentEmailsForTest();

    const response = await request(app)
      .post(`/api/admin/users/${userId}/reset-password`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(202);

    const actionRows = await query<{ action_type: string; status: string }>(
      `
      SELECT action_type, status
      FROM account_actions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1;
      `,
      [userId],
    );

    expect(actionRows.rows[0]?.action_type).toBe("password_reset");
    expect(actionRows.rows[0]?.status).toBe("pending");

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
