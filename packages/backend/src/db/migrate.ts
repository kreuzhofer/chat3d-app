import { pool } from "./connection.js";
import { migrations } from "./migrations/index.js";

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
    console.log(`[migrate] Applied ${id}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function migrate() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  for (const migration of migrations) {
    if (!applied.has(migration.id)) {
      await applyMigration(migration.id, migration.up);
    } else {
      console.log(`[migrate] Skipped ${migration.id} (already applied)`);
    }
  }
}

migrate()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error("[migrate] Migration failed", error);
    await pool.end();
    process.exit(1);
  });
