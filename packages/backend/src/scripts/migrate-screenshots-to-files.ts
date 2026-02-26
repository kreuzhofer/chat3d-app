/**
 * One-time migration: move workbench example screenshots from DB base64 blobs
 * to domain-scoped files on disk.
 *
 * Usage:  npx tsx src/scripts/migrate-screenshots-to-files.ts
 *
 * Safe to run multiple times — already-migrated rows (value starts with "workbench/")
 * are skipped.
 */

import { pool } from "../db/connection.js";
import { writeStorageFile } from "../services/file-storage.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("migrate-screenshots");

const BATCH_SIZE = 50;

interface ExampleRow {
  id: string;
  category_id: string;
  screenshot_front: string | null;
  screenshot_top: string | null;
  screenshot_iso: string | null;
  screenshot_iso_back: string | null;
}

const ANGLES = [
  { column: "screenshot_front", angle: "front" },
  { column: "screenshot_top", angle: "top" },
  { column: "screenshot_iso", angle: "isometric" },
  { column: "screenshot_iso_back", angle: "isometric_back" },
] as const;

function isBase64(value: string | null): boolean {
  if (!value) return false;
  // File paths start with "workbench/"; base64 data does not
  return !value.startsWith("workbench/");
}

async function migrateScreenshots(): Promise<void> {
  // Fetch all examples that still have base64 screenshots
  const result = await pool.query<ExampleRow>(`
    SELECT e.id, p.category_id,
           e.screenshot_front, e.screenshot_top, e.screenshot_iso, e.screenshot_iso_back
    FROM workbench_examples e
    JOIN workbench_example_prompts p ON p.id = e.prompt_id
    WHERE e.screenshot_front IS NOT NULL
       OR e.screenshot_top IS NOT NULL
       OR e.screenshot_iso IS NOT NULL
       OR e.screenshot_iso_back IS NOT NULL
    ORDER BY e.created_at ASC
  `);

  const rows = result.rows;
  logger.info({ total: rows.length }, "found examples with screenshot data");

  let migrated = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const updates: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;
      let hasWork = false;

      for (const { column, angle } of ANGLES) {
        const value = row[column as keyof ExampleRow] as string | null;
        if (isBase64(value)) {
          const filePath = `workbench/${row.category_id}/${row.id}-screenshot-${angle}.png`;
          await writeStorageFile({ relativePath: filePath, contentBase64: value! });
          updates.push(`${column} = $${paramIdx++}`);
          params.push(filePath);
          hasWork = true;
        }
      }

      if (hasWork) {
        params.push(row.id);
        await pool.query(
          `UPDATE workbench_examples SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
          params,
        );
        migrated++;
      } else {
        skipped++;
      }
    }

    logger.info({ processed: i + batch.length, total: rows.length, migrated, skipped }, "batch progress");
  }

  logger.info({ migrated, skipped, total: rows.length }, "screenshot migration complete");
}

migrateScreenshots()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, "screenshot migration failed");
    await pool.end();
    process.exit(1);
  });
