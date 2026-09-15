/**
 * Create the test suite's database if it does not exist (issue #90), on the
 * same Postgres the app uses, before `prisma migrate deploy` runs against
 * it. Prints the name it prepared. Never touches the app's database: the
 * name is resolved through the same guard the suite's setup applies.
 *
 *   npx tsx scripts/ensure-test-db.ts
 */
import pg from "pg";
import { resolveTestDatabaseName } from "../src/utils/test-database.js";

async function main(): Promise<void> {
  const name = resolveTestDatabaseName(process.env);
  const client = new pg.Client({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "chat3d",
    password: process.env.DB_PASSWORD || "chat3d_dev",
    database: "postgres",
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (rowCount === 0) {
      // Identifier, not a value: validated by the guard's *_test shape and quoted here.
      await client.query(`create database "${name.replace(/"/g, '""')}"`);
      console.log(`created test database ${name}`);
    } else {
      console.log(`test database ${name} exists`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
