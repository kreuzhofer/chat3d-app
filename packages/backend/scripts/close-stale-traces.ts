/**
 * One-shot hygiene script: close generation_traces rows stuck in
 * finalStatus='running' for more than STALE_THRESHOLD_DAYS days.
 *
 * Codex audit (2026-06-06) found 23 such rows from March 2026 that were
 * never transitioned out of running (likely due to process crashes or
 * container restarts during generation).
 *
 * CLI:
 *   npx tsx scripts/close-stale-traces.ts            # dry-run (default)
 *   npx tsx scripts/close-stale-traces.ts --commit   # apply updates
 */
import { prisma } from "../src/db/prisma.js";
import { createLogger } from "../src/utils/logger.js";

const logger = createLogger("close-stale-traces");

const STALE_THRESHOLD_DAYS = 7;

export interface CloseReport {
  candidateCount: number;
  closedCount: number;
  sample: { id: string; updatedAt: Date }[];
}

export async function closeStaleTraces(commit: boolean): Promise<CloseReport> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.generationTrace.findMany({
    where: { finalStatus: "running", updatedAt: { lt: cutoff } },
    select: { id: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
  });

  logger.info({ count: candidates.length, cutoff }, "found stale running traces");

  if (!commit) {
    return {
      candidateCount: candidates.length,
      closedCount: 0,
      sample: candidates.slice(0, 5),
    };
  }

  const result = await prisma.generationTrace.updateMany({
    where: { finalStatus: "running", updatedAt: { lt: cutoff } },
    data: { finalStatus: "failed" },
  });

  logger.info({ closedCount: result.count }, "closed stale running traces");

  return {
    candidateCount: candidates.length,
    closedCount: result.count,
    sample: candidates.slice(0, 5),
  };
}

async function main() {
  const commit = process.argv.includes("--commit");
  if (!commit) {
    logger.warn("dry-run mode — pass --commit to actually update");
  }
  const report = await closeStaleTraces(commit);
  logger.info(report, "close-stale-traces report");
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, "close-stale-traces failed");
  process.exit(1);
});
