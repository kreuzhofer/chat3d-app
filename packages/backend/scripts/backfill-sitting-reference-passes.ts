/**
 * ADR 0004 amendment (2026-09-25): freeze each sitting's reference pass count
 * (the base of the false-fail floor) for sittings created before the column.
 * Dry run by default; --apply writes. Sittings whose reference run is gone stay NULL.
 */
import { prisma } from "../src/db/prisma.js";
import { loadRun } from "../src/services/qualification-screen-load.service.js";
import { referencePassCount } from "../src/services/adjudication-sitting.service.js";
import { createLogger } from "../src/utils/logger.js";

const logger = createLogger("backfill-ref-passes");
const apply = process.argv.includes("--apply");
const sittings = await prisma.adjudicationSitting.findMany({ where: { referencePasses: null, referenceRunId: { not: null } }, select: { id: true, title: true, referenceRunId: true } });
for (const s of sittings) {
  try {
    const n = referencePassCount(await loadRun(s.referenceRunId!));
    logger.info({ sittingId: s.id, title: s.title.slice(0, 60), referencePasses: n, apply }, "reference passes");
    if (apply) await prisma.adjudicationSitting.update({ where: { id: s.id }, data: { referencePasses: n } });
  } catch (err) { logger.warn({ sittingId: s.id, err: (err as Error).message }, "reference run not loadable; left NULL"); }
}
await prisma.$disconnect(); process.exit(0);
