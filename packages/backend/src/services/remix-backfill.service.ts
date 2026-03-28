/**
 * Remix Backfill Service
 *
 * Two-phase backfill for spec embeddings on existing workbench prompts:
 * Phase 1: Generate construction specs via LLM for prompts that don't have one
 * Phase 2: Embed construction specs that don't have a spec_embedding yet
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { generateSpec } from "./spec-generation.service.js";
import { storeSpecAndEmbedding } from "./workbench-embeddings.service.js";

const logger = createLogger("remix-backfill");

export interface SpecBackfillResult {
  specsGenerated: number;
  specsSkipped: number;
  embeddingsStored: number;
  errors: number;
}

/**
 * Backfill construction specs and spec embeddings for approved workbench prompts.
 *
 * Phase 1: For prompts with approved examples but no construction_spec,
 *          generate the spec via the spec generation LLM.
 * Phase 2: For prompts that have a construction_spec but no spec_embedding,
 *          embed and store the vector.
 */
export async function backfillSpecEmbeddings(): Promise<SpecBackfillResult> {
  const result: SpecBackfillResult = {
    specsGenerated: 0,
    specsSkipped: 0,
    embeddingsStored: 0,
    errors: 0,
  };

  // Phase 1: Generate construction specs for prompts that don't have one
  const promptsNeedingSpec = await prisma.$queryRaw<{ id: string; prompt: string }[]>`
    SELECT DISTINCT p.id, p.prompt
    FROM workbench_example_prompts p
    JOIN workbench_examples e ON e.prompt_id = p.id
    WHERE e.approval_status IN ('auto_approved', 'human_approved')
      AND e.experiment_run_id IS NULL
      AND p.construction_spec IS NULL
    ORDER BY p.id
  `;

  logger.info({ count: promptsNeedingSpec.length }, "phase 1: prompts needing spec generation");

  for (const row of promptsNeedingSpec) {
    try {
      const specResult = await generateSpec(row.prompt);
      if (specResult.constructionSpec) {
        await prisma.workbenchExamplePrompt.update({
          where: { id: row.id },
          data: { constructionSpec: specResult.constructionSpec },
        });
        result.specsGenerated++;
        logger.debug({ promptId: row.id }, "spec generated");
      } else {
        result.specsSkipped++;
        logger.debug({ promptId: row.id }, "spec generation returned empty constructionSpec");
      }
    } catch (err) {
      result.errors++;
      logger.warn({ err: err instanceof Error ? err.message : String(err), promptId: row.id }, "spec generation failed");
    }
  }

  logger.info({ generated: result.specsGenerated, skipped: result.specsSkipped, errors: result.errors }, "phase 1 complete");

  // Phase 2: Embed specs that don't have a spec_embedding yet
  const promptsNeedingEmbedding = await prisma.$queryRaw<{ id: string; construction_spec: string }[]>`
    SELECT p.id, p.construction_spec
    FROM workbench_example_prompts p
    JOIN workbench_examples e ON e.prompt_id = p.id
    WHERE e.approval_status IN ('auto_approved', 'human_approved')
      AND e.experiment_run_id IS NULL
      AND p.construction_spec IS NOT NULL
      AND p.spec_embedding IS NULL
    ORDER BY p.id
  `;

  logger.info({ count: promptsNeedingEmbedding.length }, "phase 2: prompts needing spec embedding");

  for (const row of promptsNeedingEmbedding) {
    try {
      await storeSpecAndEmbedding(row.id, row.construction_spec);
      result.embeddingsStored++;
    } catch (err) {
      result.errors++;
      logger.warn({ err: err instanceof Error ? err.message : String(err), promptId: row.id }, "spec embedding failed");
    }
  }

  logger.info(result, "spec backfill complete");
  return result;
}
