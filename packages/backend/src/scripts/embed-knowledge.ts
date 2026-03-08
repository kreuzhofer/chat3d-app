/**
 * Embed validated Build123d knowledge entries.
 *
 * Generates vector embeddings for entries marked as "valid" that don't yet
 * have embeddings (or have stale ones from a different model).
 *
 * Usage:
 *   npx tsx src/scripts/embed-knowledge.ts
 */

import { backfillKnowledgeEmbeddings } from "../services/knowledge.service.js";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("embed-knowledge");

async function main() {
  logger.info("starting knowledge embedding backfill");
  const result = await backfillKnowledgeEmbeddings();
  logger.info(result, "embedding backfill complete");
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, "embedding script failed");
  process.exit(1);
});
