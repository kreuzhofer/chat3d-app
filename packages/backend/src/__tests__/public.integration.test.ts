import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { pool, query } from "../db/connection.js";

describe("public config routes", () => {
  const app = createApp();

  beforeAll(async () => {
    await query(
      `
      INSERT INTO app_settings (id, waitlist_enabled, invitations_enabled, invitation_waitlist_required, invitation_quota_per_user)
      VALUES (TRUE, FALSE, TRUE, FALSE, 3)
      ON CONFLICT (id)
      DO UPDATE SET
        waitlist_enabled = EXCLUDED.waitlist_enabled,
        invitations_enabled = EXCLUDED.invitations_enabled,
        invitation_waitlist_required = EXCLUDED.invitation_waitlist_required,
        invitation_quota_per_user = EXCLUDED.invitation_quota_per_user,
        updated_at = NOW();
      `,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("returns waitlist mode from app settings", async () => {
    await query(`UPDATE app_settings SET waitlist_enabled = FALSE, updated_at = NOW() WHERE id = TRUE;`);
    const disabledResponse = await request(app).get("/api/public/config");
    expect(disabledResponse.status).toBe(200);
    expect(disabledResponse.body.waitlistEnabled).toBe(false);

    await query(`UPDATE app_settings SET waitlist_enabled = TRUE, updated_at = NOW() WHERE id = TRUE;`);
    const enabledResponse = await request(app).get("/api/public/config");
    expect(enabledResponse.status).toBe(200);
    expect(enabledResponse.body.waitlistEnabled).toBe(true);
  });
});
