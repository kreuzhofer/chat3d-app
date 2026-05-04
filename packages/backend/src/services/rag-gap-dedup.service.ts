/**
 * Embedding-based dedup for the Missing Examples category. Stronger than
 * the prefix-substring check used previously: catches near-paraphrases.
 */

import { createLogger } from "../utils/logger.js";
import { embedPromptTextWithUsage } from "./workbench-embeddings.service.js";

const logger = createLogger("rag-gap-dedup");

/** Cosine-similarity threshold above which two prompts are treated as the same gap. */
const SEMANTIC_DUP_THRESHOLD = 0.93;

/**
 * Returns true if the candidate prompt is semantically near-identical to an
 * existing prompt in the given category. Failures (embedding service down,
 * etc.) return false so we don't block writes when dedup is unavailable.
 */
export async function isSemanticDuplicateInCategory(
  candidatePrompt: string,
  categoryId: string,
): Promise<boolean> {
  try {
    const { prisma } = await import("../db/prisma.js");
    const { embedding } = await embedPromptTextWithUsage(candidatePrompt);
    const pgVector = `[${embedding.join(",")}]`;

    const rows = await prisma.$queryRaw<{ similarity: number }[]>`
      SELECT 1 - (p.embedding <=> ${pgVector}::vector) AS similarity
        FROM workbench_example_prompts p
       WHERE p.category_id = ${categoryId}::uuid
         AND p.embedding IS NOT NULL
       ORDER BY p.embedding <=> ${pgVector}::vector ASC
       LIMIT 1
    `;

    if (rows.length === 0) return false;
    const top = rows[0].similarity;
    if (top >= SEMANTIC_DUP_THRESHOLD) {
      logger.debug({ similarity: top.toFixed(3), threshold: SEMANTIC_DUP_THRESHOLD }, "semantic duplicate detected");
      return true;
    }
    return false;
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, "semantic dedup check failed — allowing insert");
    return false;
  }
}
