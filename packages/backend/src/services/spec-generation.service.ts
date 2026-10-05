/**
 * Spec Generation Service
 *
 * Lightweight LLM pre-check that analyzes a prompt before codegen to:
 * 1. Produce an interpretation of the requested model
 * 2. Generate a verification checklist for VLM evaluation
 * 3. Flag critically ambiguous prompts that need disambiguation
 *
 * Design: fail-open (LLM errors → disambiguationNeeded: false) so transient
 * failures never block the codegen pipeline.
 */

import { trackedStreamText } from "./tracked-llm.service.js";
import { isProviderQuotaError } from "../utils/llm-errors.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  buildGenerateOptions,
  maxOutputWithThinking,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { createLogger } from "../utils/logger.js";
import { screenAtoms, type AtomsFailureReason } from "./requirement-atoms.js";
import { SPEC_SYSTEM_PROMPT } from "../prompts/spec-generation-system-prompt.js";
import type { EvalPlan } from "../utils/eval-plan.js";
import { parseSpecResponse, EMPTY_SPEC, type ParsedSpec } from "./spec-response-parse.js";
import type { ComplexityTriggerReason } from "@chat3d/shared";

const logger = createLogger("spec-gen");

// ── Types ────────────────────────────────────────────────────────────

export type SpecComplexity = "simple" | "medium" | "complex";

export interface CodeAssertion {
  /** Expected variable name in generated code (e.g., "diameter", "height") */
  parameter: string;
  /** Alternate variable names the code might use */
  aliases: string[];
  /** Comparison operator */
  operator: "==" | ">=" | "<=" | "approx";
  /** Expected numeric value */
  value: number;
  /** Human-readable description of what this checks */
  description: string;
}

/**
 * An atom's role (#136, ADR 0001's 2026-10-05 amendment): "structural" = the
 * count and separation of named parts, their connections and the overall
 * shape; "feature" = everything else. The Gate cascades on it.
 */
export type AtomRole = "structural" | "feature";

/** Verification criterion with visibility annotation for eval routing. */
export interface AnnotatedCriterion {
  text: string;
  /** "visual" = clearly visible at standard resolution, "code" = too small/internal, "both" = borderline */
  visibility: "visual" | "code" | "both";
  /** Always set by the generator since #136; absent on criteria stored before it. */
  role?: AtomRole;
}

export interface SpecResult {
  interpretation: string;
  verificationChecklist: string[];
  codeAssertions: CodeAssertion[];
  disambiguationNeeded: boolean;
  disambiguationQuestions: string[];
  complexity: SpecComplexity;
  promptTokens: number;
  completionTokens: number;
  /** What the thing IS — domain/object type, no dimensions. For RAG search only. */
  semanticContext: string;
  /** Precise geometric blueprint — dimensions, operations, positions. For codegen agent. */
  constructionSpec: string;
  /** Objective structural checks with visibility annotations for eval routing. */
  verificationCriteria: AnnotatedCriterion[];
  /** Separate solid bodies the request implies (#136); null on a refused, failed or pre-#136 spec. */
  expectedBodyCount: number | null;
  /** Spec LLM's verdict — true means route to multi-agent codegen. */
  requiresDecomposition: boolean;
  /** One-sentence rationale for the requiresDecomposition decision. */
  decompositionReasoning: string;
  /** Per-prompt eval directive (system prompt + inspection plan + weight). Null when LLM omitted or malformed. */
  evalPlan: EvalPlan | null;
  /** How the reply was read: as JSON, by regex over a reply that was not JSON, or not at all. Absent on a cached spec. */
  parseLevel?: "json" | "regex" | "none";
  /**
   * Why `verificationCriteria` is empty when it is (ADR 0002, #106): the reply
   * did not meet the atoms contract on any attempt. Never normalised away.
   */
  criteriaFailure?: { attempts: number; reasons: AtomsFailureReason[] };
  rawResponse?: string;
  reasoning?: string;
  systemPrompt?: string;
}

// ── System prompt ───────────────────────────────────────────────────

// The system prompt lives in prompts/spec-generation-system-prompt.ts (#106).

// Response parsing lives in spec-response-parse.ts (split for #136).
export { parseSpecResponse } from "./spec-response-parse.js";

// ── Model resolution ────────────────────────────────────────────────

async function resolveSpecModel(): Promise<{ model: ReturnType<typeof createProviderModelFromConfig>; label: string; config: LlmModelConfig }> {
  let config: LlmModelConfig;
  try {
    config = await getModelForPurpose("spec_generation");
  } catch {
    // Fall back to conversation model if spec_generation not configured
    logger.info("spec_generation purpose not configured, falling back to conversation model");
    config = await getModelForPurpose("conversation");
  }
  return {
    model: createProviderModelFromConfig(config),
    label: config.label,
    config,
  };
}

// ── Complexity derivation ────────────────────────────────────────────

/** Patterns that indicate the model has multiple distinct parts requiring assembly.
 *  Cheap regex safety net — fires before any LLM cost. */
export const MULTI_PART_PATTERN = /\b(two[- ]parts?|multi[- ]parts?|separate\s+parts?|top\s+and\s+bottom|base\s+and\s+(cover|lid|top)|lid\s+and\s+base|snap[- ]fit|hinge[ds]?\s+(lid|cover)|mating\s+parts?|interlocking|dovetail\s+joint|assembly|two[- ]piece|two[- ]halves?|upper\s+and\s+lower|clamshell)\b/i;

interface ResolveComplexityArgs {
  promptText: string;
  interpretation?: string;
  /** If undefined, only the regex path can fire complex. */
  requiresDecomposition?: boolean;
}

export interface ComplexityResolution {
  complexity: SpecComplexity;
  reason: ComplexityTriggerReason;
}

/**
 * Authoritative routing decision. Order of precedence:
 *   1. requiresDecomposition === true        → complex / spec_llm_decision
 *   2. MULTI_PART_PATTERN matches text       → complex / multi_part_pattern
 *   3. otherwise                              → simple / single_agent_default
 *
 * Notes:
 *  - "medium" is no longer used as a routing signal. The complexity field
 *    keeps its three-value type for backward compatibility with downstream
 *    consumers (system-prompt tiering, etc.) but only "simple" and "complex"
 *    matter for multi-agent routing.
 *  - Operation-count thresholds are retired — the production data showed
 *    avg detected ops 2.2–3.4 across all categories, well below the old
 *    6+ threshold (see docs/codegen-harness-audit.md §6.4.5 N1).
 */
export function resolveComplexityFromSpec(args: ResolveComplexityArgs): ComplexityResolution {
  if (args.requiresDecomposition === true) {
    return { complexity: "complex", reason: "spec_llm_decision" };
  }
  const combined = args.interpretation ? `${args.promptText} ${args.interpretation}` : args.promptText;
  if (MULTI_PART_PATTERN.test(combined)) {
    return { complexity: "complex", reason: "multi_part_pattern" };
  }
  return { complexity: "simple", reason: "single_agent_default" };
}

/**
 * Legacy synchronous form. Existing callers that just want a SpecComplexity
 * still work; they get the regex-only fallback (no LLM signal available).
 * New code should prefer `resolveComplexityFromSpec` which returns the reason.
 */
export function deriveComplexity(promptText: string, interpretation?: string): SpecComplexity {
  return resolveComplexityFromSpec({ promptText, interpretation, requiresDecomposition: false }).complexity;
}

// ── Main function ────────────────────────────────────────────────────

export async function generateSpec(promptText: string): Promise<SpecResult> {
  let modelConfig: LlmModelConfig | null = null;

  try {
    const { model, label, config } = await resolveSpecModel();
    modelConfig = config;

    logger.debug({ prompt: promptText, model: label }, "generating spec");

    const semaphore = getLlmSemaphore(config.provider, config.maxConcurrent);
    const messages: SpecMessage[] = [{ role: "user", content: promptText }];
    let promptTokens = 0;
    let completionTokens = 0;
    let responseText = "";
    let reasoning = "";
    let parsed: ParsedSpec = EMPTY_SPEC;
    const refusals: AtomsFailureReason[] = [];

    // ADR 0002: a reply that is not atoms — bare strings, a bundled atom, or a
    // reply cut off before the criteria — is a failed attempt, retried once
    // with the defect named, then surfaced. Never normalised.
    for (let attempt = 1; attempt <= SPEC_ATTEMPTS; attempt++) {
      const reply = await semaphore.run(() => callSpecModel(model, config, messages));
      promptTokens += reply.promptTokens;
      completionTokens += reply.completionTokens;
      responseText = reply.text;
      reasoning = reply.reasoning;
      parsed = parseSpecResponse(reply.text);

      const truncated = reply.finishReason === "length";
      const reason: AtomsFailureReason | null =
        truncated || parsed.parseLevel !== "json" ? "unparseable" : parsed.criteriaRefused?.reason ?? null;
      if (!reason) break;
      refusals.push(reason);
      logger.warn(
        { attempt, reason, truncated, parseLevel: parsed.parseLevel, offending: parsed.criteriaRefused?.offending, completionTokens: reply.completionTokens },
        "spec reply refused: criteria are not requirement atoms",
      );
      if (attempt < SPEC_ATTEMPTS) {
        messages.push({ role: "assistant", content: reply.text });
        messages.push({ role: "user", content: specRetryMessage(reason, truncated) });
      }
    }
    // #113: drop orientation/colour atoms the request does not support, route
    // comparisons and fine features to code — the wrong-question classes.
    if (parsed.verificationCriteria.length > 0) {
      const screen = screenAtoms(parsed.verificationCriteria, promptText);
      if (screen.dropped.length > 0 || screen.routed.length > 0) {
        logger.info({ dropped: screen.dropped.map((d) => ({ reason: d.reason, word: d.word, text: d.atom.text.slice(0, 80) })), routed: screen.routed.length }, "spec atoms screened");
      }
      parsed = { ...parsed, verificationCriteria: screen.kept };
    }
    const criteriaFailure = parsed.verificationCriteria.length > 0 ? undefined : refusals.length > 0 ? { attempts: refusals.length, reasons: refusals } : undefined;
    if (criteriaFailure) {
      logger.warn({ ...criteriaFailure, prompt: promptText.slice(0, 120) }, "spec has no criteria after the retry: a generation failure, surfaced");
    }

    const { complexity } = resolveComplexityFromSpec({
      promptText,
      interpretation: parsed.interpretation,
      requiresDecomposition: parsed.requiresDecomposition,
    });

    logger.info(
      {
        disambiguationNeeded: parsed.disambiguationNeeded,
        checklistCount: parsed.verificationChecklist.length,
        assertionCount: parsed.codeAssertions.length,
        questionCount: parsed.disambiguationQuestions.length,
        criteriaCount: parsed.verificationCriteria.length,
        hasConstructionSpec: parsed.constructionSpec.length > 0,
        hasSemanticContext: parsed.semanticContext.length > 0,
        interpretation: parsed.interpretation,
        complexity,
        attempts: refusals.length + (criteriaFailure ? 0 : 1),
      },
      "spec generated",
    );
    if (parsed.codeAssertions.length > 0) {
      logger.debug(
        { assertions: parsed.codeAssertions.map((a) => `${a.parameter}${a.operator}${a.value}`) },
        "extracted code assertions",
      );
    }

    const specResult: SpecResult = {
      ...parsed,
      complexity,
      promptTokens,
      completionTokens,
      ...(criteriaFailure ? { criteriaFailure } : {}),
    };
    specResult.rawResponse = responseText;
    specResult.reasoning = reasoning || undefined;
    specResult.systemPrompt = SPEC_SYSTEM_PROMPT;

    return specResult;
  } catch (error) {
    // Quota exhaustion is NOT transient — abort the pipeline
    if (isProviderQuotaError(error)) {
      logger.error({ err: error }, "provider quota exhausted during spec generation");
      throw error;
    }

    // Fail-open: transient spec generation errors should never block the pipeline
    logger.warn({ err: error }, "spec generation failed, proceeding without spec");
    return {
      ...EMPTY_SPEC,
      complexity: deriveComplexity(promptText),
      promptTokens: 0,
      completionTokens: 0,
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
    };
  }
}

type SpecMessage = { role: "user" | "assistant"; content: string };

/** How many times the model is asked before the criteria are declared failed. */
const SPEC_ATTEMPTS = 2;

/**
 * Visible output budget for the spec JSON (thinking is added on top). The
 * old 1,536 was the 95th percentile of what the model writes, and the replies
 * cut off there parsed to a spec with no criteria and no warning (#106).
 */
const SPEC_OUTPUT_TOKENS = 3072;

function specRetryMessage(reason: AtomsFailureReason, truncated: boolean): string {
  if (truncated || reason === "unparseable") {
    return "Your previous reply was cut off or was not valid JSON. Return the complete JSON object only — keep constructionSpec to the essential steps so the whole object fits.";
  }
  const why: Partial<Record<AtomsFailureReason, string>> = {
    "bare-string": 'an entry in verificationCriteria was a bare string; every entry must be {"text", "visibility", "role"}',
    "missing-visibility": 'an entry in verificationCriteria had no valid visibility; use "visual", "code" or "both"',
    "missing-role": 'an entry in verificationCriteria had no valid role; use "structural" or "feature"',
    "missing-body-count": "expectedBodyCount was missing or not an integer of at least 1; state how many separate solid bodies the model consists of (1 when the request names no separate parts)",
    "bundled": 'a "visual" or "both" entry in verificationCriteria contained a measurement; split it — the fact stays visual, the number becomes its own "code" entry',
    "empty": "verificationCriteria was empty; list 3-8 requirement atoms",
    "empty-text": "an entry in verificationCriteria had no text",
    "not-an-array": "verificationCriteria was not a list",
  };
  return `Your previous reply did not meet the criteria contract: ${why[reason] ?? reason}. Return the same JSON again with verificationCriteria as requirement atoms only and expectedBodyCount set.`;
}

/** One streamed call; reasoning goes to a separate channel, so only text deltas are the reply. */
async function callSpecModel(
  model: ReturnType<typeof createProviderModelFromConfig>,
  config: LlmModelConfig,
  messages: SpecMessage[],
): Promise<{ text: string; reasoning: string; promptTokens: number; completionTokens: number; finishReason: string | undefined }> {
  const stream = trackedStreamText({
    model,
    system: SPEC_SYSTEM_PROMPT,
    messages,
    ...buildGenerateOptions(config),
    maxOutputTokens: maxOutputWithThinking(SPEC_OUTPUT_TOKENS, config),
    temperature: 1.0,
  }, {
    purpose: "spec_generation",
    providerName: config.provider,
    modelId: config.id,
    modelName: config.modelName,
    modelConfig: { costPer1mInput: config.costPer1mInput, costPer1mOutput: config.costPer1mOutput },
  });
  let text = "";
  let reasoning = "";
  for await (const part of stream.fullStream) {
    if (part.type === "text-delta") text += part.text;
    else if (part.type === "reasoning-delta") reasoning += (part as { text?: string }).text ?? "";
  }
  const res = await stream;
  const usage = await res.usage;
  const finishReason: string | undefined = await res.finishReason;
  return { text, reasoning, promptTokens: usage?.inputTokens ?? 0, completionTokens: usage?.outputTokens ?? 0, finishReason };
}

// ── Chat disambiguation response formatter ──────────────────────────

export function formatDisambiguationResponse(_conversationText: string, spec: SpecResult): string {
  const questions = spec.disambiguationQuestions
    .map((q, i) => `${i + 1}. ${q}`)
    .join("\n");
  return `I'd like to create this 3D model for you, but I have a few questions first to make sure I get it right:\n\n${questions}\n\nPlease answer these questions and I'll generate the model.`;
}
