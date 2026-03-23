/**
 * RAG Gap Collector — records component descriptions that had no similar
 * workbench examples, so they can be reviewed and filled later.
 *
 * Gaps are stored as prompts in the "Missing Examples" workbench category.
 * Deduplicates against in-memory recent set + existing DB entries.
 */

import { createLogger } from "../utils/logger.js";

const logger = createLogger("rag-gap");

const MISSING_EXAMPLES_CATEGORY = "Missing Examples";

/** In-memory dedup: track recently collected gap descriptions within this process. */
const recentGaps = new Set<string>();

/**
 * Collect a RAG gap into the "Missing Examples" workbench category.
 * Fire-and-forget: errors are logged but never thrown.
 */
export async function collectMissingExample(componentName: string, description: string): Promise<void> {
  // In-memory dedup (same process / same batch)
  const key = description.trim().toLowerCase().slice(0, 200);
  if (recentGaps.has(key)) return;
  recentGaps.add(key);

  try {
    const { prisma } = await import("../db/prisma.js");

    // Find or skip if "Missing Examples" category doesn't exist
    const category = await prisma.workbenchCategory.findFirst({
      where: { name: MISSING_EXAMPLES_CATEGORY },
      select: { id: true },
    });
    if (!category) {
      logger.debug("Missing Examples category not found — skipping gap collection");
      return;
    }

    // DB dedup: check if a similar prompt already exists in this category
    const existing = await prisma.workbenchExamplePrompt.findFirst({
      where: {
        categoryId: category.id,
        prompt: { contains: description.slice(0, 50), mode: "insensitive" },
      },
      select: { id: true },
    });
    if (existing) return;

    // Use timestamp-based index to avoid race conditions on parallel inserts
    const nextIndex = Date.now() % 1_000_000;

    await prisma.workbenchExamplePrompt.create({
      data: {
        categoryId: category.id,
        index: nextIndex,
        prompt: `[${componentName}] ${description}`,
      },
    });

    logger.info({ component: componentName, categoryId: category.id }, "collected missing example gap");
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, "gap collection failed");
  }
}

/**
 * Collect a technique-level RAG gap. Records both a concrete prompt
 * (for future generation) and a description (the technique it teaches).
 */
export async function collectMissingTechnique(technique: string, query: string): Promise<void> {
  const key = technique.trim().toLowerCase().slice(0, 200);
  if (recentGaps.has(key)) return;
  recentGaps.add(key);

  try {
    const { prisma } = await import("../db/prisma.js");

    const category = await prisma.workbenchCategory.findFirst({
      where: { name: MISSING_EXAMPLES_CATEGORY },
      select: { id: true },
    });
    if (!category) return;

    // Dedup: check if a similar technique was already recorded
    const existing = await prisma.workbenchExamplePrompt.findFirst({
      where: {
        categoryId: category.id,
        prompt: { contains: technique.slice(0, 40), mode: "insensitive" },
      },
      select: { id: true },
    });
    if (existing) return;

    const nextIndex = Date.now() % 1_000_000;

    await prisma.workbenchExamplePrompt.create({
      data: {
        categoryId: category.id,
        index: nextIndex,
        prompt: `[technique] ${technique}`,
        description: `Demonstrates Build123d technique: ${technique}. Search query: ${query}`,
      },
    });

    logger.info({ technique, categoryId: category.id }, "collected missing technique gap");
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, "technique gap collection failed");
  }
}
