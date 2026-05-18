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

// ── System prompt (BUMP DECIDER_VERSION above when editing this) ────────

export const DECIDER_SYSTEM_PROMPT = `You decide whether a 3D CAD prompt should be routed to a multi-agent decomposition pipeline or a single-agent codegen pipeline. Multi-agent breaks the model into 2-6 sub-parts that are designed independently and then assembled. It's more expensive (~2-3× tokens) but helps when a model would otherwise fail to produce coherent geometry in one pass.

You will receive:
- the user's prompt
- the target model's TIER ∈ { frontier, mid, small }
- (optionally) the spec LLM's interpretation of the prompt

Decision rules — calibrated PER TIER:

FRONTIER (Claude Sonnet/Opus, GPT-4+, etc.):
  Decompose ONLY when the prompt has clearly multiple independently-designable assembled parts with mating geometry (snap-fit lid, hinged door, separate body+arm with interface points). These models handle complex single-piece geometry solo. Lathe profiles, organic shapes, dense feature counts on one body → single-agent.

MID (mid-tier OSS, larger fine-tunes that aren't tool-trained):
  Decompose for:
  - Clear multi-part objects with mating geometry
  - Single-piece prompts with ≥4 distinct geometric operations (revolved profile + grooves + fillets + holes, etc.)
  Otherwise single-agent.

SMALL (small fine-tunes like chat3d-build123d-02-synthetic-16k:ma, 27B-and-under):
  Decompose more eagerly. Decompose for:
  - Clear multi-part objects
  - Single-piece prompts with revolved/lathe profiles + surface features (grooves, knurling)
  - Organic/sculpted shapes
  - Dense polar or linear arrays (≥6 repeats) — these often fail in one shot
  - Any prompt with ≥3 distinct geometric features beyond a primitive

Return ONLY a JSON object:
  { "decompose": boolean, "reasoning": "one sentence, max 20 words" }`;

// ── Response parser ────────────────────────────────────────────────────

export interface ParsedDeciderResponse {
  decompose: boolean;
  reasoning: string;
}

/**
 * Parse the decider LLM's JSON response. Tolerant of markdown code fences
 * (Claude sometimes wraps JSON in ```json ... ```). Throws on hard
 * failure so the caller (decideDecomposition) can fall back to single-agent
 * via the router's catch block.
 */
export function parseDeciderResponse(raw: string): ParsedDeciderResponse {
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`decider response is not valid JSON: ${stripped.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("decider response is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.decompose !== "boolean") {
    throw new Error("decider response missing or invalid 'decompose' boolean");
  }
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.trim() : "";
  return { decompose: obj.decompose, reasoning };
}

// NOTE: `logger` and the `ModelTier` import above are referenced by the
// decideDecomposition orchestrator added in task 6c.
