import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, query } from "../db/connection.js";
import { runAccountDeletionSweep } from "../workers/account-deletion.worker.js";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const expiredEmail = `m7-expired-${suffix}@example.test`;
const futureEmail = `m7-future-${suffix}@example.test`;
const password = "S3curePass!123";

async function insertDeactivatedUser(email: string, deactivatedUntilExpression: string): Promise<string> {
  const hash = await bcrypt.hash(password, 12);
  const result = await query<{ id: string }>(
    `
    INSERT INTO users (email, password_hash, display_name, role, status, deactivated_until)
    VALUES ($1, $2, 'Deletion Worker User', 'user', 'deactivated', ${deactivatedUntilExpression})
    RETURNING id;
    `,
    [email, hash],
  );
  return result.rows[0].id;
}

describe("account deletion worker", () => {
  let expiredUserId = "";
  let futureUserId = "";

  beforeAll(async () => {
    await query(`DELETE FROM users WHERE email = ANY($1::text[]);`, [[expiredEmail, futureEmail]]);
    expiredUserId = await insertDeactivatedUser(expiredEmail, "NOW() - INTERVAL '1 day'");
    futureUserId = await insertDeactivatedUser(futureEmail, "NOW() + INTERVAL '10 days'");
  });

  afterAll(async () => {
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[]);`, [[expiredUserId, futureUserId]]);
    await pool.end();
  });

  it("deletes users whose deactivation window has expired", async () => {
    const result = await runAccountDeletionSweep(10);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedUsers.some((item) => item.id === expiredUserId)).toBe(true);

    const expiredCheck = await query<{ id: string }>(`SELECT id FROM users WHERE id = $1;`, [expiredUserId]);
    expect(expiredCheck.rows).toHaveLength(0);

    const futureCheck = await query<{ id: string }>(`SELECT id FROM users WHERE id = $1;`, [futureUserId]);
    expect(futureCheck.rows).toHaveLength(1);
  });
});
