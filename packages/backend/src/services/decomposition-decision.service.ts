/**
 * Live decomposition decider for multi-agent routing.
 *
 * Replaces the cached `requires_decomposition` read at routing time with a
 * fresh, model-tier-aware LLM call. Results are cached in
 * `decomposition_decisions` keyed by (prompt_id, model_id), version-stamped
 * with DECIDER_VERSION so bumping the system prompt automatically
 * invalidates stale rows (next call overwrites them via ON CONFLICT).
 *
 * Design doc: docs/superpowers/specs/2026-05-18-multi-agent-routing-redesign-design.md
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import type { ModelTier } from "@chat3d/shared";

const logger = createLogger("decomp-decider");

/**
 * Version stamp for the decider system prompt. BUMP THIS whenever the system
 * prompt below is edited — cache rows with a different version are treated
 * as misses, so the next call refreshes them.
 */
export const DECIDER_VERSION = "v1.0.0";

export interface CachedDecision {
  decompose: boolean;
  reasoning: string;
}

/**
 * Return the cached decision iff a row exists AND its decider_version matches
 * the current DECIDER_VERSION. Stale rows are treated as a miss (caller
 * recomputes, then overwrites via ON CONFLICT in upsertDecision).
 */
export async function lookupCachedDecision(
  promptId: string,
  modelId: string,
): Promise<CachedDecision | null> {
  const row = await prisma.decompositionDecision.findUnique({
    where: { promptId_modelId: { promptId, modelId } },
  });
  if (!row) return null;
  if (row.deciderVersion !== DECIDER_VERSION) return null;
  return { decompose: row.decompose, reasoning: row.reasoning };
}

export interface UpsertDecisionInput {
  promptId: string;
  modelId: string;
  decompose: boolean;
  reasoning: string;
}

/**
 * Insert a fresh decision row, or overwrite an existing one (e.g. stale
 * decider_version). Composite unique on (prompt_id, model_id) guarantees
 * at most one row per (prompt, model) pair regardless of how many bumps
 * the version has gone through.
 */
export async function upsertDecision(input: UpsertDecisionInput): Promise<void> {
  await prisma.decompositionDecision.upsert({
    where: {
      promptId_modelId: { promptId: input.promptId, modelId: input.modelId },
    },
    create: {
      promptId: input.promptId,
      modelId: input.modelId,
      deciderVersion: DECIDER_VERSION,
      decompose: input.decompose,
      reasoning: input.reasoning,
    },
    update: {
      deciderVersion: DECIDER_VERSION,
      decompose: input.decompose,
      reasoning: input.reasoning,
    },
  });
}

// NOTE: `logger` and the `ModelTier` import above are referenced by the
// decideDecomposition orchestrator added in task 6c.
