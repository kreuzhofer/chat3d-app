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

import { generateText } from "ai";
import { isProviderQuotaError } from "../utils/llm-errors.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { detectPromptOperations } from "../prompts/system-prompts.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("spec-gen");

// ── Types ────────────────────────────────────────────────────────────

export type SpecComplexity = "simple" | "medium" | "complex";

export interface SpecResult {
  interpretation: string;
  verificationChecklist: string[];
  disambiguationNeeded: boolean;
  disambiguationQuestions: string[];
  complexity: SpecComplexity;
  promptTokens: number;
  completionTokens: number;
}

// ── System prompt ───────────────────────────────────────────────────

const SPEC_SYSTEM_PROMPT = `You are a CAD specification analyst for Build123d 3D model generation.

Given a user's prompt describing a 3D model, produce:

1. **interpretation**: A 1-2 sentence description of what you understand the model should look like. Be specific about dimensions, positions, and relationships you'll assume if not stated.

2. **verificationChecklist**: 3-6 binary yes/no questions a visual evaluator can answer by looking at the rendered model. Focus on the key geometric features. Examples:
   - "Does the model have exactly 4 through-holes?"
   - "Is there a fillet on the top edges?"
   - "Is the lid a separate piece sitting on top?"

3. **disambiguationNeeded**: true ONLY if the prompt has critical ambiguities that would lead to significantly different models. Minor ambiguities (exact fillet radius, precise hole placement) are fine — the code generator handles those.

4. **disambiguationQuestions**: If disambiguationNeeded is true, list 1-3 specific questions. Each should offer concrete choices. Example: "Should the handle be a solid bar or a hollow loop? (bar/loop)"

Be LENIENT about disambiguation. Most prompts should NOT need disambiguation. Only flag when multiple fundamentally different interpretations exist (e.g., "container with lid" — is the lid attached with a hinge, threaded, or snap-fit?).

Return JSON only:
{
  "interpretation": "...",
  "verificationChecklist": ["..."],
  "disambiguationNeeded": true|false,
  "disambiguationQuestions": ["..."]
}`;

// ── Response parsing ─────────────────────────────────────────────────

interface ParsedSpec {
  interpretation: string;
  verificationChecklist: string[];
  disambiguationNeeded: boolean;
  disambiguationQuestions: string[];
}

const EMPTY_SPEC: ParsedSpec = {
  interpretation: "",
  verificationChecklist: [],
  disambiguationNeeded: false,
  disambiguationQuestions: [],
};

function buildSpecFromParsed(raw: Partial<ParsedSpec>): ParsedSpec {
  return {
    interpretation: typeof raw.interpretation === "string" ? raw.interpretation : "",
    verificationChecklist: Array.isArray(raw.verificationChecklist)
      ? raw.verificationChecklist.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : [],
    disambiguationNeeded: raw.disambiguationNeeded === true,
    disambiguationQuestions: Array.isArray(raw.disambiguationQuestions)
      ? raw.disambiguationQuestions.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      : [],
  };
}

export function parseSpecResponse(content: string): ParsedSpec {
  if (!content || typeof content !== "string") {
    return EMPTY_SPEC; // fail-open
  }

  // Level 1: Extract JSON from code fence
  let jsonStr = content;
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Level 2: Direct JSON.parse
  try {
    const parsed = JSON.parse(jsonStr) as Partial<ParsedSpec>;
    return buildSpecFromParsed(parsed);
  } catch {
    // fall through
  }

  // Level 3: Regex extraction
  const interpretationMatch = content.match(/["']?interpretation["']?\s*[:=]\s*"([^"]+)"/i);
  const disambiguationMatch = content.match(/["']?disambiguationNeeded["']?\s*[:=]\s*(true|false)/i);

  if (interpretationMatch || disambiguationMatch) {
    return {
      interpretation: interpretationMatch?.[1] ?? "",
      verificationChecklist: [],
      disambiguationNeeded: disambiguationMatch?.[1]?.toLowerCase() === "true",
      disambiguationQuestions: [],
    };
  }

  return EMPTY_SPEC; // fail-open
}

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

export function deriveComplexity(promptText: string, interpretation?: string): SpecComplexity {
  const ops = detectPromptOperations(promptText, interpretation);
  // 3d_ops and 2d_sketch are always added by detectPromptOperations,
  // so subtract those to count only detected specific operations
  const specificOps = ops.size - 2; // subtract always-included 3d_ops and 2d_sketch
  if (specificOps <= 2) return "simple";
  if (specificOps <= 5) return "medium";
  return "complex";
}

// ── Main function ────────────────────────────────────────────────────

export async function generateSpec(promptText: string): Promise<SpecResult> {
  let modelConfig: LlmModelConfig | null = null;

  try {
    const { model, label, config } = await resolveSpecModel();
    modelConfig = config;

    logger.info({ prompt: promptText.slice(0, 80), model: label }, "generating spec");

    const semaphore = getLlmSemaphore(config.provider, config.maxConcurrent);
    const result = await semaphore.run(async () =>
      generateText({
        model,
        system: SPEC_SYSTEM_PROMPT,
        messages: [{ role: "user", content: promptText }],
        maxOutputTokens: 512,
      }),
    );

    const parsed = parseSpecResponse(result.text);
    const promptTokens = result.usage?.inputTokens ?? 0;
    const completionTokens = result.usage?.outputTokens ?? 0;
    const complexity = deriveComplexity(promptText, parsed.interpretation);

    logger.info(
      {
        disambiguationNeeded: parsed.disambiguationNeeded,
        checklistCount: parsed.verificationChecklist.length,
        questionCount: parsed.disambiguationQuestions.length,
        interpretation: parsed.interpretation.slice(0, 100),
        complexity,
      },
      "spec generated",
    );

    return {
      ...parsed,
      complexity,
      promptTokens,
      completionTokens,
    };
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
    };
  }
}

// ── Chat disambiguation response formatter ──────────────────────────

export function formatDisambiguationResponse(_conversationText: string, spec: SpecResult): string {
  const questions = spec.disambiguationQuestions
    .map((q, i) => `${i + 1}. ${q}`)
    .join("\n");
  return `I'd like to create this 3D model for you, but I have a few questions first to make sure I get it right:\n\n${questions}\n\nPlease answer these questions and I'll generate the model.`;
}
