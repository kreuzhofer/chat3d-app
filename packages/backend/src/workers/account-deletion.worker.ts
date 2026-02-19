import { fileURLToPath } from "node:url";
import { pool, query } from "../db/connection.js";

interface DeletedUserRow {
  id: string;
  email: string;
}

export async function runAccountDeletionSweep(limit = 100): Promise<{
  deletedCount: number;
  deletedUsers: Array<{ id: string; email: string }>;
}> {
  const boundedLimit = Math.max(1, Math.min(limit, 1000));

  const result = await query<DeletedUserRow>(
    `
    WITH expired_users AS (
      SELECT id
      FROM users
      WHERE status = 'deactivated'
        AND deactivated_until IS NOT NULL
        AND deactivated_until < NOW()
      ORDER BY deactivated_until ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM users u
    USING expired_users e
    WHERE u.id = e.id
    RETURNING u.id, u.email;
    `,
    [boundedLimit],
  );

  return {
    deletedCount: result.rows.length,
    deletedUsers: result.rows.map((row) => ({ id: row.id, email: row.email })),
  };
}

async function runAsScript() {
  try {
    const limitRaw = process.env.ACCOUNT_DELETION_SWEEP_LIMIT;
    const parsedLimit = limitRaw ? Number(limitRaw) : undefined;
    const limit = Number.isFinite(parsedLimit) ? Number(parsedLimit) : undefined;
    const result = await runAccountDeletionSweep(limit);
    console.log(`[account-deletion-worker] deleted=${result.deletedCount}`);
  } catch (error) {
    console.error("[account-deletion-worker] failed", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runAsScript();
}
