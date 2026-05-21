/**
 * Workbench Spec Persistence
 *
 * Writes generated spec fields back to workbench_example_prompts.
 *
 * Called eagerly right after generateSpec() returns so a later pipeline abort
 * (timeout, render failure, etc.) cannot drop the freshly-generated spec.
 * That regression was visible as drifting data-quality "specs missing" coverage
 * after large category re-generation runs: spec tokens were spent, then thrown
 * away when the agent timed out and the pipeline early-exited before reaching
 * the post-insertExample persistence block.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import type { SpecResult } from "./spec-generation.service.js";
import type { EnrichmentResult } from "./spec-enrichment.service.js";

const logger = createLogger("workbench");

export interface PersistSpecOpts {
  promptId: string;
  specResult: SpecResult;
  /**
   * True when the spec was read from a cached row whose requires_decomposition
   * was NULL (pre-N1 cache). Leave requires_decomposition NULL in that case so
   * the backfill script can populate it later — overwriting with the default
   * `false` would silently lock the prompt out of the multi-agent route.
   */
  specCameFromNullDecompositionCache: boolean;
  /** Enrichment data, if the enrichment phase ran successfully. */
  enrichmentResult?: EnrichmentResult | null;
}

/**
 * Idempotent — safe to call multiple times. Typical call sites:
 *   1. immediately after generateSpec() returns (enrichmentResult omitted)
 *   2. after a successful enrichment pass (enrichmentResult set, with refined
 *      constructionSpec/verificationCriteria already merged into specResult)
 */
export async function persistSpecToPrompt({
  promptId,
  specResult,
  specCameFromNullDecompositionCache,
  enrichmentResult,
}: PersistSpecOpts): Promise<void> {
  try {
    await prisma.workbenchExamplePrompt.update({
      where: { id: promptId },
      data: {
        specInterpretation: specResult.interpretation,
        codeAssertions: specResult.codeAssertions as unknown as undefined,
        verificationChecklist: specResult.verificationChecklist,
        verificationCriteria: specResult.verificationCriteria as unknown as undefined,
        constructionSpec: specResult.constructionSpec || null,
        specRawResponse: specResult.rawResponse ?? null,
        specSystemPrompt: specResult.systemPrompt ?? null,
        ...(specCameFromNullDecompositionCache ? {} : {
          requiresDecomposition: specResult.requiresDecomposition,
          decompositionReasoning: specResult.decompositionReasoning,
        }),
        ...(enrichmentResult ? {
          enrichmentRawResponse: enrichmentResult.rawResponse ?? null,
          enrichmentSystemPrompt: enrichmentResult.systemPrompt ?? null,
          enrichmentUserMessage: enrichmentResult.userMessage ?? null,
        } : {}),
      },
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), promptId },
      "failed to persist spec fields (non-fatal)",
    );
  }
}
