/**
 * Unified multi-agent routing decision shared by workbench codegen, chat
 * codegen, and any future generation surface. Replaces the per-call inline
 * `resolveComplexityFromSpec()`-based routing that used to live in
 * `workbench-codegen.service.ts` and `query.service.ts`.
 *
 * Decision precedence:
 *   1. Per-run routing_override (force_decompose / force_single) → bypass
 *      decider entirely. Trigger reason: forced_override.
 *   2. Multi-part regex safety net (cheap, deterministic). Trigger reason:
 *      multi_part_pattern.
 *   3. Live decomposition decider call (with version-stamped cache).
 *      Trigger reason: live_decider | live_decider_cached.
 *   4. Decider error → fallback to single-agent. Trigger reason:
 *      spec_unavailable.
 *
 * Design doc: docs/superpowers/specs/2026-05-18-multi-agent-routing-redesign-design.md
 */

import { createLogger } from "../utils/logger.js";
import type { ComplexityTriggerReason, ModelTier, RoutingOverride } from "@chat3d/shared";
import { decideDecomposition } from "./decomposition-decision.service.js";
import { MULTI_PART_PATTERN } from "./spec-generation.service.js";

const logger = createLogger("routing");

export interface RouteGenerationInput {
  promptId: string | null;
  promptText: string;
  modelId: string;
  modelTier: ModelTier | null;
  /** Defaults to "auto" if omitted. */
  routingOverride?: RoutingOverride;
  /** Optional cached spec interpretation, passed through to the decider as a hint. */
  specInterpretation?: string;
}

export interface RouteGenerationResult {
  useMultiAgent: boolean;
  triggerReason: ComplexityTriggerReason;
  /** Present only when the decider returned reasoning (live_decider / live_decider_cached). */
  reasoning?: string;
}

export async function routeGeneration(input: RouteGenerationInput): Promise<RouteGenerationResult> {
  const override = input.routingOverride ?? "auto";

  // 1. Per-run override
  if (override === "force_decompose") {
    logger.info({ promptId: input.promptId }, "routing: force_decompose override");
    return { useMultiAgent: true, triggerReason: "forced_override", reasoning: undefined };
  }
  if (override === "force_single") {
    logger.info({ promptId: input.promptId }, "routing: force_single override");
    return { useMultiAgent: false, triggerReason: "forced_override", reasoning: undefined };
  }

  // 2. Multi-part regex safety net — cheap, deterministic, no API cost.
  const combinedText = input.specInterpretation
    ? `${input.promptText} ${input.specInterpretation}`
    : input.promptText;
  if (MULTI_PART_PATTERN.test(combinedText)) {
    logger.info({ promptId: input.promptId }, "routing: multi_part_pattern matched");
    return { useMultiAgent: true, triggerReason: "multi_part_pattern", reasoning: undefined };
  }

  // 3. Live decider with version-stamped cache
  try {
    const decision = await decideDecomposition({
      promptId: input.promptId,
      promptText: input.promptText,
      modelId: input.modelId,
      modelTier: input.modelTier,
      specInterpretation: input.specInterpretation,
    });
    return {
      useMultiAgent: decision.decompose,
      triggerReason: decision.triggerReason,
      reasoning: decision.reasoning,
    };
  } catch (err) {
    // 4. Fallback: decider unavailable → single-agent (regex already ruled out)
    logger.warn(
      { err, promptId: input.promptId, modelId: input.modelId },
      "decomposition decider failed; falling back to single-agent",
    );
    return { useMultiAgent: false, triggerReason: "spec_unavailable", reasoning: undefined };
  }
}
