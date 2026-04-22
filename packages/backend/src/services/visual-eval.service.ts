/**
 * Visual Evaluation Service
 *
 * Uses a vision-capable LLM (VLM) to evaluate rendered 3D model screenshots
 * against the user prompt and verification criteria. Uncertain checklist items
 * are resolved by targeted zoom follow-ups in the eval orchestrator.
 */

import { trackedStreamText, type TrackingMeta } from "./tracked-llm.service.js";
import { isQuotaExhaustion, asQuotaError, isRateLimitError } from "../utils/llm-errors.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import { createLogger } from "../utils/logger.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  type LlmModelConfig,
} from "./llm-config.service.js";
import {
  parseEvaluationResponse,
  parseChecklistResults,
  reconcileChecklist,
  type ChecklistResult,
} from "./visual-eval-parser.service.js";
import { buildEvaluationSystemPrompt } from "./visual-eval-prompt.service.js";
import type { ModelFormat } from "./stl-rendering-client.service.js";

const logger = createLogger("vlm-eval");
const EVAL_MAX_RETRIES = 2;

// ── Result types ─────────────────────────────────────────────────────

export interface EvaluationResult {
  score: number;
  issues: string[];
  suggestions: string[];
  vlmModel: string;
  promptTokens: number;
  completionTokens: number;
  checklistResults?: ChecklistResult[];
  /** Full raw text response from VLM (for training data). */
  rawResponse?: string;
  /** Reasoning/thinking tokens from VLM (for training data). */
  reasoning?: string;
  /** System prompt used for this evaluation (for training data). */
  systemPrompt?: string;
}

export type { ChecklistResult } from "./visual-eval-parser.service.js";
export { parseEvaluationResponse } from "./visual-eval-parser.service.js";

// ── Input types ──────────────────────────────────────────────────────

export interface LabeledImage {
  angle: string;
  base64: string;
}

export interface EvaluateModelInput {
  userPrompt: string;
  categoryName: string;
  complexity: number;
  /** Labeled base64-encoded PNG images from different angles */
  images: LabeledImage[];
  /** Optional verification checklist from spec generation step */
  verificationChecklist?: string[];
  /** Precise geometric blueprint — provides structural context for evaluation. */
  constructionSpec?: string;
  /** Raw STL/3MF base64 data (kept for interface compat, not used for zoom). */
  stlBase64?: string;
  /** Model format (kept for interface compat). */
  modelFormat?: ModelFormat;
}

// ── Angle labels ─────────────────────────────────────────────────────

const ANGLE_LABELS: Record<string, string> = {
  front: "Front view",
  back: "Back view",
  left: "Left view",
  right: "Right view",
  top: "Top view",
  bottom: "Bottom view",
  ortho_45: "45° down view",
  ortho_45_bottom: "45° up view",
  isometric: "Isometric view",
};

// ── Build user content with labeled images ───────────────────────────

type ContentPart = { type: "text"; text: string } | { type: "image"; image: string };

function buildImageUserContent(images: LabeledImage[]): ContentPart[] {
  const parts: ContentPart[] = [
    { type: "text", text: "Please evaluate the following 3D model images:" },
  ];
  for (const img of images) {
    const label = ANGLE_LABELS[img.angle] ?? img.angle;
    parts.push({ type: "text", text: `${label}:` });
    parts.push({ type: "image", image: img.base64 });
  }
  return parts;
}

// ── Main evaluation function (uses default VLM from purpose map) ─────

export async function evaluateModel(input: EvaluateModelInput): Promise<EvaluationResult> {
  if (!input.images || input.images.length === 0) {
    logger.warn("no labeled images provided, returning score 1");
    return {
      score: 1, issues: ["No images provided for evaluation"], suggestions: [],
      vlmModel: "", promptTokens: 0, completionTokens: 0,
    };
  }

  const vlmConfig = await getModelForPurpose("vlm_eval");
  return evaluateModelWithConfig(input, vlmConfig);
}

// ── Evaluation with explicit model config (for experiments) ─────────

export async function evaluateModelWithConfig(
  input: EvaluateModelInput,
  vlmConfig: LlmModelConfig,
): Promise<EvaluationResult> {
  const { userPrompt, categoryName, complexity, images } = input;

  logger.info(
    { category: categoryName, complexity, imageCount: images.length, model: vlmConfig.label },
    "starting evaluation",
  );

  if (!images || images.length === 0) {
    logger.warn("no labeled images provided, returning score 1");
    return {
      score: 1, issues: ["No images provided for evaluation"], suggestions: [],
      vlmModel: vlmConfig.label, promptTokens: 0, completionTokens: 0,
    };
  }

  const vlmModelLabel = vlmConfig.label;
  const providedAngles = images.map(img => img.angle);
  const systemPrompt = buildEvaluationSystemPrompt(
    userPrompt, categoryName, complexity, input.verificationChecklist,
    false, providedAngles, input.constructionSpec, vlmConfig.vlmEvalPreamble ?? undefined,
  );

  const userContent = buildImageUserContent(images);
  const providerModel = createProviderModelFromConfig(vlmConfig);
  const trackingMeta: TrackingMeta = {
    purpose: "vlm_evaluation",
    providerName: vlmConfig.provider,
    modelId: vlmConfig.id,
    modelName: vlmConfig.modelName,
    modelConfig: { costPer1mInput: vlmConfig.costPer1mInput, costPer1mOutput: vlmConfig.costPer1mOutput },
  };

  // Wrap evaluation (including retries) with per-provider semaphore
  const semaphore = getLlmSemaphore(vlmConfig.provider, vlmConfig.maxConcurrent);
  return semaphore.run(async () => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= EVAL_MAX_RETRIES; attempt++) {
      try {
        logger.info({ model: vlmModelLabel, attempt }, "calling VLM");
        // Use streaming so thinking/reasoning tokens go to a separate channel
        // and don't pollute the response text (critical for Gemma 4, Qwen3, etc.)
        const stream = trackedStreamText({
          model: providerModel,
          system: systemPrompt,
          messages: [{ role: "user" as const, content: userContent }],
          maxOutputTokens: 4096,
          temperature: 0,
        }, trackingMeta);

        let text = "";
        let reasoning = "";
        for await (const part of stream.fullStream) {
          if (part.type === "text-delta") text += part.text;
          else if (part.type === "reasoning-delta" || part.type === "reasoning") {
            reasoning += (part as { text?: string }).text ?? "";
          }
        }
        const resolved = await stream;
        const promptTokens = resolved.usage?.inputTokens ?? 0;
        const completionTokens = resolved.usage?.outputTokens ?? 0;

        logger.info({ response: text }, "VLM returned evaluation");
        const result = buildFinalResult(text, input, vlmModelLabel, promptTokens, completionTokens);
        result.rawResponse = text;
        result.reasoning = reasoning || undefined;
        result.systemPrompt = systemPrompt;
        return result;
      } catch (error) {
        if (isQuotaExhaustion(error)) {
          throw asQuotaError(error, vlmConfig.provider) ?? error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < EVAL_MAX_RETRIES) {
          const isRateLimit = isRateLimitError(error);
          const delay = isRateLimit
            ? Math.min(2000 * Math.pow(2, attempt), 60000)
            : 1000 * (attempt + 1);
          logger.warn({ attempt: attempt + 1, err: lastError, isRateLimit, delayMs: delay }, "attempt failed, retrying");
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    logger.error({ err: lastError, attempts: EVAL_MAX_RETRIES + 1 }, "evaluation failed after all attempts");
    return {
      score: 1, issues: [`Evaluation failed: ${lastError?.message ?? "Unknown error"}`],
      suggestions: [], vlmModel: vlmConfig.label,
      promptTokens: 0, completionTokens: 0,
    };
  });
}

// ── Build final result from VLM text ─────────────────────────────────

function buildFinalResult(
  responseText: string,
  input: EvaluateModelInput,
  vlmModelLabel: string,
  promptTokens: number,
  completionTokens: number,
): EvaluationResult {
  if (!responseText) {
    return {
      score: 1, issues: ["Empty response from VLM"], suggestions: [],
      vlmModel: vlmModelLabel, promptTokens, completionTokens,
    };
  }

  const parsed = parseEvaluationResponse(responseText);

  let checklistResults: ChecklistResult[] | undefined;
  if (input.verificationChecklist?.length) {
    const rawResults = parseChecklistResults(responseText);
    checklistResults = reconcileChecklist(rawResults, input.verificationChecklist);
    if (checklistResults.length > 0) {
      const uncertainCount = checklistResults.filter(c => c.pass === null).length;
      if (rawResults.length !== input.verificationChecklist.length) {
        logger.warn({
          specCount: input.verificationChecklist.length,
          vlmCount: rawResults.length,
          reconciledCount: checklistResults.length,
        }, "VLM returned different checklist count — reconciled to spec questions");
      }
      logger.info({
        checklistCount: checklistResults.length,
        passCount: checklistResults.filter(c => c.pass === true).length,
        uncertainCount,
      }, "checklist results parsed");
    }
  }

  logger.info(
    { score: parsed.score, issueCount: parsed.issues.length, suggestionCount: parsed.suggestions.length },
    "evaluation parsed",
  );

  return {
    ...parsed,
    vlmModel: vlmModelLabel,
    promptTokens,
    completionTokens,
    checklistResults,
  };
}
