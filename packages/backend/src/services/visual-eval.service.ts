/**
 * Visual Evaluation Service
 *
 * Uses a vision-capable LLM (VLM) to evaluate rendered 3D model screenshots
 * against the original user prompt. Supports VLM-guided zoom: the VLM can
 * request zoomed-in screenshots via tool_use to inspect fine details.
 */

import { trackedGenerateText, type TrackingMeta } from "./tracked-llm.service.js";
import { isQuotaExhaustion, asQuotaError, isRateLimitError } from "../utils/llm-errors.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import { createLogger } from "../utils/logger.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
} from "./llm-config.service.js";
import {
  parseEvaluationResponse,
  parseChecklistResults,
  type ChecklistResult,
} from "./visual-eval-parser.service.js";
import { buildEvaluationSystemPrompt } from "./visual-eval-prompt.service.js";
import {
  buildZoomToolWithCapture,
  renderZoomedScreenshot,
  MAX_ZOOM_REQUESTS,
  type ZoomToolArgs,
} from "./visual-eval-tools.service.js";
import type { ModelFormat, ViewingAngle } from "./stl-rendering-client.service.js";

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
  /** Number of zoom requests the VLM made during evaluation */
  zoomRequestCount?: number;
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
  /** Raw STL/3MF base64 data — enables VLM zoom capability when provided */
  stlBase64?: string;
  /** Model format for zoom re-renders (default: "stl") */
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

// ── Main evaluation function ─────────────────────────────────────────

export async function evaluateModel(input: EvaluateModelInput): Promise<EvaluationResult> {
  const { userPrompt, categoryName, complexity, images, stlBase64 } = input;
  const modelFormat = input.modelFormat ?? "stl";
  const zoomEnabled = !!stlBase64;

  logger.info(
    { category: categoryName, complexity, imageCount: images.length, zoomEnabled },
    "starting evaluation",
  );

  if (!images || images.length === 0) {
    logger.warn("no labeled images provided, returning score 1");
    return {
      score: 1, issues: ["No images provided for evaluation"], suggestions: [],
      vlmModel: "", promptTokens: 0, completionTokens: 0,
    };
  }

  const vlmConfig = await getModelForPurpose("vlm_eval");
  const vlmModelLabel = vlmConfig.label;
  logger.info({ model: vlmModelLabel, zoomEnabled }, "using VLM model");

  const systemPrompt = buildEvaluationSystemPrompt(
    userPrompt, categoryName, complexity, input.verificationChecklist, zoomEnabled,
  );

  const userContent = buildImageUserContent(images);

  // Wrap entire evaluation (including retries) with per-provider semaphore
  const semaphore = getLlmSemaphore(vlmConfig.provider, vlmConfig.maxConcurrent);
  return semaphore.run(async () => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= EVAL_MAX_RETRIES; attempt++) {
      try {
        const result = await runEvaluationWithZoom({
          vlmConfig, systemPrompt, userContent,
          stlBase64, modelFormat, input, zoomEnabled,
        });
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

// ── Evaluation with optional zoom loop ───────────────────────────────

interface RunEvalInput {
  vlmConfig: Awaited<ReturnType<typeof getModelForPurpose>>;
  systemPrompt: string;
  userContent: ContentPart[];
  stlBase64: string | undefined;
  modelFormat: ModelFormat;
  input: EvaluateModelInput;
  zoomEnabled: boolean;
}

async function runEvaluationWithZoom(ctx: RunEvalInput): Promise<EvaluationResult> {
  const { vlmConfig, systemPrompt, userContent, input, zoomEnabled } = ctx;
  const providerModel = createProviderModelFromConfig(vlmConfig);
  const trackingMeta: TrackingMeta = {
    purpose: "vlm_evaluation",
    providerName: vlmConfig.provider,
    modelId: vlmConfig.id,
    modelName: vlmConfig.modelName,
    modelConfig: { costPer1mInput: vlmConfig.costPer1mInput, costPer1mOutput: vlmConfig.costPer1mOutput },
  };

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  // Build zoom tools with capture array if zoom is enabled
  const capturedZoomRequests: ZoomToolArgs[] = [];
  const zoomTools = zoomEnabled ? buildZoomToolWithCapture(capturedZoomRequests) : undefined;

  // Phase 1: Initial evaluation call (with zoom tools if enabled)
  logger.info({ model: vlmConfig.label, hasZoomTools: zoomEnabled }, "calling VLM (phase 1)");
  const result1 = await trackedGenerateText({
    model: providerModel,
    system: systemPrompt,
    messages: [{ role: "user" as const, content: userContent }],
    tools: zoomTools,
    maxOutputTokens: 1024,
  }, trackingMeta);

  totalPromptTokens += result1.usage?.inputTokens ?? 0;
  totalCompletionTokens += result1.usage?.outputTokens ?? 0;

  // If VLM returned text directly (no zoom requested)
  if (capturedZoomRequests.length === 0) {
    logger.info({ response: result1.text }, "VLM returned direct evaluation (no zoom)");
    return buildFinalResult(result1.text, input, vlmConfig.label, totalPromptTokens, totalCompletionTokens, 0);
  }

  // Phase 2: VLM requested detail views — render at 1024px with tight framing
  logger.info(
    { detailRequests: capturedZoomRequests.map(r => ({ angle: r.angle, reason: r.reason })) },
    "VLM requested detail views",
  );

  const zoomedImages: ContentPart[] = [];
  let zoomCount = 0;
  for (const args of capturedZoomRequests.slice(0, MAX_ZOOM_REQUESTS)) {
    if (!ctx.stlBase64) break;
    const zoomed = await renderZoomedScreenshot({
      modelData: ctx.stlBase64,
      format: ctx.modelFormat,
      angle: args.angle as ViewingAngle,
    });
    if (zoomed) {
      zoomedImages.push({ type: "text", text: `High-resolution ${ANGLE_LABELS[args.angle] ?? args.angle} (1024px, tight framing):` });
      zoomedImages.push({ type: "image", image: zoomed.base64 });
      zoomCount++;
    }
  }

  if (zoomedImages.length === 0) {
    // Zoom failed — fall back to re-calling without tools
    logger.warn("zoom rendering failed, re-calling VLM without tools");
    const fallbackResult = await trackedGenerateText({
      model: providerModel,
      system: systemPrompt,
      messages: [{ role: "user" as const, content: userContent }],
      maxOutputTokens: 1024,
    }, trackingMeta);
    totalPromptTokens += fallbackResult.usage?.inputTokens ?? 0;
    totalCompletionTokens += fallbackResult.usage?.outputTokens ?? 0;
    return buildFinalResult(fallbackResult.text, input, vlmConfig.label, totalPromptTokens, totalCompletionTokens, 0);
  }

  // Build phase 2 as a single clean user message — no tool content.
  // Bedrock strips tool-call/tool-result messages when no tools are active,
  // so we combine all images (original + zoomed) into one message instead.
  const phase2Messages = [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "Please evaluate the following 3D model. Standard views:" },
        ...userContent.slice(1), // skip the original "Please evaluate..." prefix
        { type: "text" as const, text: "\nAdditional zoomed-in views for detail inspection:" },
        ...zoomedImages,
        { type: "text" as const, text: "\nNow provide your final evaluation JSON based on all images (standard + zoomed views)." },
      ],
    },
  ];

  // Phase 2: Final evaluation with zoomed images (no tools — force text response)
  logger.info({ zoomCount }, "calling VLM (phase 2 with zoomed images)");
  const result2 = await trackedGenerateText({
    model: providerModel,
    system: systemPrompt,
    messages: phase2Messages,
    maxOutputTokens: 1024,
  }, trackingMeta);

  totalPromptTokens += result2.usage?.inputTokens ?? 0;
  totalCompletionTokens += result2.usage?.outputTokens ?? 0;

  logger.info({ response: result2.text, zoomCount }, "VLM returned final evaluation after zoom");
  return buildFinalResult(result2.text, input, vlmConfig.label, totalPromptTokens, totalCompletionTokens, zoomCount);
}

// ── Build final result from VLM text ─────────────────────────────────

function buildFinalResult(
  responseText: string,
  input: EvaluateModelInput,
  vlmModelLabel: string,
  promptTokens: number,
  completionTokens: number,
  zoomRequestCount: number,
): EvaluationResult {
  if (!responseText) {
    return {
      score: 1, issues: ["Empty response from VLM"], suggestions: [],
      vlmModel: vlmModelLabel,
      promptTokens, completionTokens, zoomRequestCount,
    };
  }

  const parsed = parseEvaluationResponse(responseText);

  let checklistResults: ChecklistResult[] | undefined;
  if (input.verificationChecklist?.length) {
    checklistResults = parseChecklistResults(responseText);
    if (checklistResults.length > 0) {
      logger.info({ checklistCount: checklistResults.length, passCount: checklistResults.filter(c => c.pass).length }, "checklist results parsed");
    }
  }

  logger.info(
    { score: parsed.score, issueCount: parsed.issues.length, suggestionCount: parsed.suggestions.length, zoomRequestCount },
    "evaluation parsed",
  );

  return {
    ...parsed,
    vlmModel: vlmModelLabel,
    promptTokens,
    completionTokens,
    checklistResults,
    zoomRequestCount,
  };
}
