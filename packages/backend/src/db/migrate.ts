import { pool } from "./connection.js";
import { migrations } from "./migrations/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("migrate");

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await pool.query<{ id: string }>(`SELECT id FROM schema_migrations;`);
  return new Set(result.rows.map((row: { id: string }) => row.id));
}

async function applyMigration(id: string, statements: string[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query(`INSERT INTO schema_migrations (id) VALUES ($1);`, [id]);
    await client.query("COMMIT");
    logger.info("Applied %s", id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run all pending migrations. Idempotent — already-applied migrations are skipped.
 * Does NOT close the pool, so it can be called from the server process.
 */
export async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  for (const migration of migrations) {
    if (!applied.has(migration.id)) {
      await applyMigration(migration.id, migration.up);
    }
  }
}

// ── Standalone CLI entry point (`npm run db:migrate`) ────────────────
// When executed directly (not imported), run migrations then close the pool.
const isDirectExecution =
  typeof process.argv[1] === "string" && process.argv[1].includes("migrate");

if (isDirectExecution) {
  runMigrations()
    .then(async () => {
      await pool.end();
    })
    .catch(async (error) => {
      logger.error({ err: error }, "Migration failed");
      await pool.end();
      process.exit(1);
    });
}
