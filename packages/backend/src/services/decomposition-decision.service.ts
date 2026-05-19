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
import { trackedGenerateText } from "./tracked-llm.service.js";
import {
  getModelForPurpose,
  createProviderModel,
  buildGenerateOptions,
  maxOutputWithThinking,
} from "./llm-config.service.js";

const logger = createLogger("decomp-decider");

/**
 * Version stamp for the decider system prompt. BUMP THIS whenever the system
 * prompt below is edited — cache rows with a different version are treated
 * as misses, so the next call refreshes them.
 */
export const DECIDER_VERSION = "v1.0.0";

/** Default tier when the target model's tier is unset/null. */
const DEFAULT_TIER: ModelTier = "mid";

/** Max chars of spec interpretation passed to the decider as a hint. */
const SPEC_INTERPRETATION_MAX_CHARS = 500;

export interface CachedDecision {
  decompose: boolean;
  reasoning: string;
  /**
   * NULL for normal LLM-verdict rows; 'timeout_observed' for sticky override
   * rows written by the harness after a single-agent timeout-abort with
   * stepCount=0. Override rows bypass the DECIDER_VERSION check.
   */
  overrideSource: string | null;
}

/**
 * Return the cached decision iff:
 *   (a) a row exists with `override_source` set (override rows are
 *       authoritative regardless of decider_version), OR
 *   (b) a row exists AND its decider_version matches the current
 *       DECIDER_VERSION.
 * Stale rows without an override are treated as a miss (caller recomputes,
 * then overwrites via ON CONFLICT in upsertDecision).
 */
export async function lookupCachedDecision(
  promptId: string,
  modelId: string,
): Promise<CachedDecision | null> {
  const row = await prisma.decompositionDecision.findUnique({
    where: { promptId_modelId: { promptId, modelId } },
  });
  if (!row) return null;
  if (row.overrideSource === null && row.deciderVersion !== DECIDER_VERSION) return null;
  return {
    decompose: row.decompose,
    reasoning: row.reasoning,
    overrideSource: row.overrideSource,
  };
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

/**
 * Sentinel decider_version for empirical timeout-observed overrides.
 * Lookups treat any row with `override_source != null` as version-independent,
 * but persisting a recognizable sentinel makes ad-hoc DB inspection clearer.
 */
const TIMEOUT_OBSERVED_VERSION = "observed-failure";
const TIMEOUT_OBSERVED_REASONING =
  "Single-agent pipeline previously aborted on timeout with stepCount=0 (over-reasoning hang). Sticky override → multi-agent.";

/**
 * Mark a (prompt, model) pair as "single-agent timed out with no progress".
 * Future routing for this pair will short-circuit to multi-agent via the
 * `timeout_observed` trigger reason, even after `DECIDER_VERSION` bumps.
 *
 * Idempotent: re-marking is a no-op upsert.
 *
 * Errors are logged but do not throw — the calling persist path is already
 * on an abort code path and we must not mask the original failure.
 */
export async function markTimeoutObserved(
  promptId: string,
  modelId: string,
): Promise<void> {
  try {
    await prisma.decompositionDecision.upsert({
      where: { promptId_modelId: { promptId, modelId } },
      create: {
        promptId,
        modelId,
        deciderVersion: TIMEOUT_OBSERVED_VERSION,
        decompose: true,
        reasoning: TIMEOUT_OBSERVED_REASONING,
        overrideSource: "timeout_observed",
      },
      update: {
        deciderVersion: TIMEOUT_OBSERVED_VERSION,
        decompose: true,
        reasoning: TIMEOUT_OBSERVED_REASONING,
        overrideSource: "timeout_observed",
      },
    });
    logger.info(
      { promptId, modelId },
      "marked (prompt, model) as timeout_observed — future routing pinned to multi-agent",
    );
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), promptId, modelId },
      "failed to mark timeout_observed — continuing",
    );
  }
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

/** Scan for the first balanced `{...}` block, respecting string literals. */
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse the decider LLM's JSON response. Tolerant of markdown code fences
 * and trailing commentary (Haiku sometimes emits a JSON block followed by
 * `**Rationale:** ...` Markdown). Extracts the first balanced top-level
 * object and parses that. Throws on hard failure so the caller
 * (decideDecomposition) can fall back to single-agent via the router's
 * catch block.
 */
export function parseDeciderResponse(raw: string): ParsedDeciderResponse {
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  const candidate = extractFirstJsonObject(stripped) ?? stripped;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
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

// ── Orchestrator ───────────────────────────────────────────────────────

export interface DecomposeDecisionInput {
  /** Workbench prompt UUID. When null/undefined (chat path), skip cache entirely. */
  promptId: string | null;
  promptText: string;
  modelId: string;
  /** Tier of the **target codegen** model (not the decider's model). `null` → treated as "mid". */
  modelTier: ModelTier | null;
  /** Optional cached spec interpretation as context. Truncated to SPEC_INTERPRETATION_MAX_CHARS chars to keep input small. */
  specInterpretation?: string;
}

export interface DecomposeDecisionResult {
  decompose: boolean;
  reasoning: string;
  triggerReason: "live_decider" | "live_decider_cached";
  deciderVersion: string;
}

function buildUserMessage(
  promptText: string,
  modelTier: ModelTier | null,
  specInterpretation?: string,
): string {
  const tier = modelTier ?? DEFAULT_TIER;
  const parts = [
    `Prompt: ${promptText}`,
    `TIER: ${tier}`,
  ];
  if (specInterpretation && specInterpretation.trim().length > 0) {
    parts.push(`Spec interpretation: ${specInterpretation.slice(0, SPEC_INTERPRETATION_MAX_CHARS)}`);
  }
  return parts.join("\n\n");
}

/**
 * Decide whether to route to multi-agent for the given prompt + target model.
 *
 * Order:
 *  1. Cache hit on (promptId, modelId, DECIDER_VERSION) → return cached.
 *  2. Cache miss → call LLM, parse response, upsert row, return.
 *
 * On LLM error (network, parse failure, etc.): rethrow. The caller (the
 * router) catches and falls back to single-agent with trigger
 * `spec_unavailable`.
 */
export async function decideDecomposition(
  input: DecomposeDecisionInput,
): Promise<DecomposeDecisionResult> {
  if (input.promptId) {
    const cached = await lookupCachedDecision(input.promptId, input.modelId);
    if (cached) {
      logger.debug(
        { promptId: input.promptId, modelId: input.modelId, decompose: cached.decompose },
        "decomposition decision cache hit",
      );
      return {
        decompose: cached.decompose,
        reasoning: cached.reasoning,
        triggerReason: "live_decider_cached",
        deciderVersion: DECIDER_VERSION,
      };
    }
  }

  const config = await getModelForPurpose("decomposition_decision");
  const model = createProviderModel(config);
  const userMessage = buildUserMessage(input.promptText, input.modelTier, input.specInterpretation);

  logger.info(
    { promptId: input.promptId, modelId: input.modelId, modelTier: input.modelTier ?? DEFAULT_TIER, decider: config.label },
    "calling decomposition decider",
  );

  const result = await trackedGenerateText({
    model,
    system: DECIDER_SYSTEM_PROMPT,
    prompt: userMessage,
    ...buildGenerateOptions(config),
    maxOutputTokens: maxOutputWithThinking(256, config),
    temperature: 0,
  }, {
    purpose: "decomposition_decision",
    providerName: config.provider,
    modelId: config.id,
    modelName: config.modelName,
    modelConfig: { costPer1mInput: config.costPer1mInput, costPer1mOutput: config.costPer1mOutput },
  });

  const parsed = parseDeciderResponse(result.text);

  if (input.promptId) {
    await upsertDecision({
      promptId: input.promptId,
      modelId: input.modelId,
      decompose: parsed.decompose,
      reasoning: parsed.reasoning,
    });
  }

  logger.info(
    { promptId: input.promptId, modelId: input.modelId, decompose: parsed.decompose, reasoning: parsed.reasoning },
    "decomposition decider verdict",
  );

  return {
    decompose: parsed.decompose,
    reasoning: parsed.reasoning,
    triggerReason: "live_decider",
    deciderVersion: DECIDER_VERSION,
  };
}
