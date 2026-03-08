/**
 * Data Migration Runner
 *
 * Runs non-SQL data migrations (file moves, path rewrites) that can't
 * be expressed in Prisma migration SQL files.
 *
 * Called from Dockerfile CMD between `prisma migrate deploy` and `npm run dev`.
 * Each migration is tracked in the `data_migrations` table and only runs once.
 */

import { prisma } from "../db/prisma.js";
import { runFileRestructureMigration } from "./migrate-storage-files.js";

interface DataMigrationDef {
  name: string;
  run: () => Promise<void>;
}

const MIGRATIONS: DataMigrationDef[] = [
  {
    name: "v2_file_restructure",
    run: async () => {
      const stats = await runFileRestructureMigration();
      if (stats.errors.length > 0) {
        console.warn(`[data-migrations] v2_file_restructure completed with ${stats.errors.length} errors`);
      }
    },
  },
];

async function main(): Promise<void> {
  console.log("[data-migrations] checking for pending data migrations...");

  try {
    // Check which migrations have already been executed
    const executed = await prisma.dataMigration.findMany({
      select: { name: true },
    });
    const executedNames = new Set(executed.map((r) => r.name));

    const pending = MIGRATIONS.filter((m) => !executedNames.has(m.name));

    if (pending.length === 0) {
      console.log("[data-migrations] all data migrations already executed, skipping");
      return;
    }

    for (const migration of pending) {
      console.log(`[data-migrations] running: ${migration.name}`);
      const start = Date.now();

      await migration.run();

      // Mark as executed
      await prisma.dataMigration.create({
        data: { name: migration.name },
      });

      const elapsed = Date.now() - start;
      console.log(`[data-migrations] completed: ${migration.name} (${elapsed}ms)`);
    }

    console.log(`[data-migrations] ${pending.length} migration(s) executed successfully`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[data-migrations] fatal error:", err);
  process.exit(1);
});
