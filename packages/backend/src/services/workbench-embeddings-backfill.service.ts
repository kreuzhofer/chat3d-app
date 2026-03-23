/**
 * One-time migration utility: backfill detected_operations on workbench prompts.
 * Extracted from workbench-embeddings.service.ts to keep that file under 400 lines.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("workbench-backfill");

/**
 * Backfill `detected_operations` on all workbench_example_prompts that
 * have an empty array. This is a one-time migration for existing prompts.
 */
export async function backfillDetectedOperations(): Promise<{ updated: number }> {
  const { detectPromptOperations } = await import("../prompts/system-prompts.js");

  const rows = await prisma.workbenchExamplePrompt.findMany({
    where: { detectedOperations: { isEmpty: true } },
    select: { id: true, prompt: true },
  });

  if (rows.length === 0) {
    logger.info("all prompts already have detected operations");
    return { updated: 0 };
  }

  logger.info({ count: rows.length }, "backfilling detected operations");
  let updated = 0;

  for (const row of rows) {
    const ops = [...detectPromptOperations(row.prompt)];
    await prisma.workbenchExamplePrompt.update({
      where: { id: row.id },
      data: { detectedOperations: ops },
    });
    updated++;
  }

  logger.info({ updated }, "detected operations backfill complete");
  return { updated };
}
