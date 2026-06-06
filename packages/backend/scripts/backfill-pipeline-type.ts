/**
 * Backfill pipeline_type column from JSONB trace for historical rows.
 *
 * Many historical rows have pipeline_type = 'single_agent' because finalizeTrace
 * did not update the column. This script reads trace->>'pipelineType' and writes
 * it back to the column where the two values differ.
 *
 * Usage:
 *   npx tsx scripts/backfill-pipeline-type.ts           # dry-run (no writes)
 *   npx tsx scripts/backfill-pipeline-type.ts --commit  # apply updates
 */

import { prisma } from "../src/db/prisma.js";
import { createLogger } from "../src/utils/logger.js";

const logger = createLogger("backfill-pipeline-type");

interface CandidateRow {
  id: string;
  old_type: string;
  new_type: string;
}

interface BackfillReport {
  candidateCount: number;
  updatedCount: number;
  sample: { id: string; oldType: string; newType: string }[];
}

export async function backfillPipelineType(commit: boolean): Promise<BackfillReport> {
  const candidates = await prisma.$queryRawUnsafe<CandidateRow[]>(`
    SELECT id, pipeline_type AS old_type, trace->>'pipelineType' AS new_type
    FROM generation_traces
    WHERE trace->>'pipelineType' IS NOT NULL
      AND pipeline_type != trace->>'pipelineType'
    ORDER BY created_at DESC
  `);

  logger.info({ count: candidates.length }, "found rows needing backfill");

  if (!commit) {
    return {
      candidateCount: candidates.length,
      updatedCount: 0,
      sample: candidates.slice(0, 5).map((c) => ({
        id: c.id,
        oldType: c.old_type,
        newType: c.new_type,
      })),
    };
  }

  const updateResult = await prisma.$executeRawUnsafe(`
    UPDATE generation_traces
    SET pipeline_type = trace->>'pipelineType'
    WHERE trace->>'pipelineType' IS NOT NULL
      AND pipeline_type != trace->>'pipelineType'
  `);

  logger.info({ updatedCount: updateResult }, "backfilled pipeline_type");

  return {
    candidateCount: candidates.length,
    updatedCount: Number(updateResult),
    sample: candidates.slice(0, 5).map((c) => ({
      id: c.id,
      oldType: c.old_type,
      newType: c.new_type,
    })),
  };
}

async function main() {
  const commit = process.argv.includes("--commit");
  if (!commit) {
    logger.warn("dry-run mode — pass --commit to apply updates");
  }

  const report = await backfillPipelineType(commit);
  logger.info(report, "backfill-pipeline-type report");

  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, "backfill-pipeline-type failed");
  process.exit(1);
});
