import { fileURLToPath } from "node:url";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("account-deletion");

interface DeletedUserRow {
  id: string;
  email: string;
}

export async function runAccountDeletionSweep(limit = 100): Promise<{
  deletedCount: number;
  deletedUsers: Array<{ id: string; email: string }>;
}> {
  const boundedLimit = Math.max(1, Math.min(limit, 1000));

  const rows = await prisma.$queryRaw<DeletedUserRow[]>`
    WITH expired_users AS (
      SELECT id
      FROM users
      WHERE status = 'deactivated'
        AND deactivated_until IS NOT NULL
        AND deactivated_until < NOW()
      ORDER BY deactivated_until ASC
      LIMIT ${boundedLimit}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM users u
    USING expired_users e
    WHERE u.id = e.id
    RETURNING u.id, u.email
  `;

  return {
    deletedCount: rows.length,
    deletedUsers: rows.map((row) => ({ id: row.id, email: row.email })),
  };
}

async function runAsScript() {
  try {
    const limitRaw = process.env.ACCOUNT_DELETION_SWEEP_LIMIT;
    const parsedLimit = limitRaw ? Number(limitRaw) : undefined;
    const limit = Number.isFinite(parsedLimit) ? Number(parsedLimit) : undefined;
    const result = await runAccountDeletionSweep(limit);
    logger.info("deleted=%d", result.deletedCount);
  } catch (error) {
    logger.error({ err: error }, "failed");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runAsScript();
}
