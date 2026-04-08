/**
 * Spec Embedding Backfill Service
 *
 * Re-embeds construction specs that are missing or stale (wrong model).
 * Does NOT generate specs — that's a separate process triggered per-category.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { storeSpecAndEmbedding, resolveEmbeddingConfig } from "./workbench-embeddings.service.js";

const logger = createLogger("remix-backfill");

export interface SpecBackfillResult {
  embedded: number;
  skipped: number;
  errors: number;
}

/**
 * Backfill spec embeddings for approved workbench prompts.
 * Finds prompts that have a construction_spec but missing or stale spec_embedding.
 */
export async function backfillSpecEmbeddings(): Promise<SpecBackfillResult> {
  const result: SpecBackfillResult = { embedded: 0, skipped: 0, errors: 0 };

  let currentModel = "unknown";
  try {
    const { config } = await resolveEmbeddingConfig();
    currentModel = config.modelName;
  } catch {
    logger.warn("no embedding model configured, skipping spec backfill");
    return result;
  }

  const promptsNeedingEmbedding = await prisma.$queryRaw<{ id: string; construction_spec: string }[]>`
    SELECT DISTINCT p.id, p.construction_spec
    FROM workbench_example_prompts p
    JOIN workbench_examples e ON e.prompt_id = p.id
    WHERE e.approval_status IN ('auto_approved', 'human_approved')
      AND e.experiment_run_id IS NULL
      AND p.construction_spec IS NOT NULL
      AND (p.spec_embedding IS NULL
           OR p.spec_embedding_model IS NULL
           OR p.spec_embedding_model != ${currentModel})
    ORDER BY p.id
  `;

  logger.info({ count: promptsNeedingEmbedding.length, model: currentModel }, "backfilling spec embeddings");

  for (const row of promptsNeedingEmbedding) {
    try {
      await storeSpecAndEmbedding(row.id, row.construction_spec);
      result.embedded++;
    } catch (err) {
      result.errors++;
      logger.warn({ err: err instanceof Error ? err.message : String(err), promptId: row.id }, "spec embedding failed");
    }
  }

  logger.info(result, "spec embedding backfill complete");
  return result;
}
