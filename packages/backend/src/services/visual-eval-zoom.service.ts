/**
 * Visual Evaluation Zoom — Targeted Follow-Up for Uncertain Items
 *
 * When the VLM marks checklist items as "uncertain" (cannot resolve at standard
 * resolution), this service renders 2x resolution screenshots and asks focused
 * follow-up questions per uncertain item.
 *
 * Replaces the old tool-use zoom pattern which triggered 100% of the time and
 * re-sent ALL screenshots.
 */

import { renderModelScreenshots, type ModelFormat, type ViewingAngle, type RenderedScreenshot } from "./stl-rendering-client.service.js";
import { trackedGenerateText } from "./tracked-llm.service.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { isZoomFollowUpEnabled, getZoomResolution, getZoomMaxFollowUps } from "./generation-settings.service.js";
import { buildUncertainFollowUpPrompt } from "./visual-eval-prompt.service.js";
import type { ChecklistResult } from "./visual-eval-parser.service.js";
import { isUncertain } from "./visual-eval-parser.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("vlm-zoom");

// ── Types ────────────────────────────────────────────────────────────

export interface HighResRenderResult {
  images: RenderedScreenshot[];
  /** Map from angle name to base64 image for quick lookup */
  byAngle: Map<string, string>;
}

export interface ZoomFollowUpDetail {
  question: string;
  angle: string;
  pass: boolean;
  detail: string;
}

export interface ZoomFollowUpResult {
  /** Updated checklist with uncertain items resolved */
  resolvedChecklist: ChecklistResult[];
  /** Number of follow-up VLM calls made */
  followUpCount: number;
  /** Per-item details for trace recording */
  followUpDetails: ZoomFollowUpDetail[];
  /** Total tokens used across all follow-ups */
  promptTokens: number;
  completionTokens: number;
}

// ── High-res rendering ───────────────────────────────────────────────

const DEFAULT_HIGHRES_ANGLES: ViewingAngle[] = [
  "front", "back", "left", "right", "top", "bottom", "ortho_45",
];

/**
 * Render high-resolution screenshots for follow-up inspection.
 * Returns images indexed by angle for quick lookup.
 */
export async function renderHighResScreenshots(
  modelData: string,
  format: ModelFormat,
  resolution: number,
  angles?: ViewingAngle[],
): Promise<HighResRenderResult> {
  const targetAngles = angles ?? DEFAULT_HIGHRES_ANGLES;

  logger.info({ resolution, angleCount: targetAngles.length }, "rendering high-res screenshots");

  const result = await renderModelScreenshots({
    modelData,
    format,
    width: resolution,
    height: resolution,
    angles: targetAngles,
  });

  const byAngle = new Map<string, string>();
  for (const img of result.images) {
    byAngle.set(img.angle, img.base64);
  }

  return { images: result.images, byAngle };
}

// ── The production sequence, behind the settings ─────────────────────

export interface ZoomFollowUpArgs {
  checklist: ChecklistResult[];
  stlBase64: string;
  modelFormat: ModelFormat;
  constructionSpec?: string;
  /**
   * The judge that answers the follow-ups. Production leaves this unset and
   * gets the `vlm_eval` purpose; an experiment passes the judge under test,
   * otherwise its uncertain items would be resolved by a different model than
   * the one being scored (issue #54).
   */
  vlmConfig?: LlmModelConfig;
}

/**
 * Read the zoom settings, render the high-res set, and ask the judge about each
 * uncertain item — the one code path both production and the experiment
 * executor run, so the two cannot drift apart.
 *
 * Returns null when nothing is uncertain or the follow-up is disabled. Throws
 * when rendering or the judge lookup fails; the caller decides whether to keep
 * the uncertain items (both callers do).
 */
export async function runZoomFollowUp(args: ZoomFollowUpArgs): Promise<ZoomFollowUpResult | null> {
  const uncertainCount = args.checklist.filter((c) => isUncertain(c)).length;
  if (uncertainCount === 0) return null;

  const [enabled, resolution, maxFollowUps] = await Promise.all([
    isZoomFollowUpEnabled(), getZoomResolution(), getZoomMaxFollowUps(),
  ]);
  if (!enabled) return null;

  logger.info({ uncertainCount, resolution, maxFollowUps }, "rendering 2x screenshots for uncertain items");
  const highRes = await renderHighResScreenshots(args.stlBase64, args.modelFormat, resolution);
  return resolveUncertainItems(args.checklist, highRes, maxFollowUps, args.constructionSpec, args.vlmConfig);
}

// ── Follow-up VLM calls ──────────────────────────────────────────────

/**
 * For each uncertain checklist item, send a focused VLM call with one
 * high-res image and one specific question. Merges results back.
 *
 * `vlmConfig` names the judge that answers; without it the production
 * `vlm_eval` purpose is used.
 */
export async function resolveUncertainItems(
  checklist: ChecklistResult[],
  highRes: HighResRenderResult,
  maxFollowUps: number,
  constructionSpec?: string,
  vlmConfig?: LlmModelConfig,
): Promise<ZoomFollowUpResult> {
  const uncertainItems = checklist
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isUncertain(item));

  if (uncertainItems.length === 0) {
    return { resolvedChecklist: checklist, followUpCount: 0, followUpDetails: [], promptTokens: 0, completionTokens: 0 };
  }

  logger.info({ uncertainCount: uncertainItems.length, maxFollowUps }, "resolving uncertain checklist items");

  const judge = vlmConfig ?? await resolveProductionJudge();

  const resolvedChecklist = [...checklist];
  let followUpCount = 0;
  const followUpDetails: ZoomFollowUpDetail[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  // Process up to maxFollowUps uncertain items
  const toProcess = uncertainItems.slice(0, maxFollowUps);

  for (const { item, index } of toProcess) {
    // Pick the best available angle — use ortho_45 as default, or top for top-related features
    const angle = pickBestAngle(item.question, highRes);
    const imageBase64 = highRes.byAngle.get(angle);

    if (!imageBase64) {
      logger.warn({ question: item.question, angle }, "no high-res image for angle, skipping follow-up");
      continue;
    }

    try {
      const result = await runSingleFollowUp(item.question, imageBase64, judge, constructionSpec);
      resolvedChecklist[index] = {
        question: item.question,
        pass: result.pass,
        detail: `[2x zoom] ${result.detail}`,
      };
      followUpCount++;
      followUpDetails.push({ question: item.question, angle, pass: result.pass, detail: result.detail });
      totalPromptTokens += result.promptTokens;
      totalCompletionTokens += result.completionTokens;

      logger.info({ question: item.question.slice(0, 60), pass: result.pass, angle }, "uncertain item resolved via zoom");
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), question: item.question.slice(0, 60) }, "zoom follow-up failed, keeping uncertain");
    }
  }

  return { resolvedChecklist, followUpCount, followUpDetails, promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens };
}

async function resolveProductionJudge(): Promise<LlmModelConfig> {
  try {
    return await getModelForPurpose("vlm_eval");
  } catch {
    return getModelForPurpose("conversation");
  }
}

// ── Single follow-up call ────────────────────────────────────────────

interface FollowUpResult {
  pass: boolean;
  detail: string;
  promptTokens: number;
  completionTokens: number;
}

async function runSingleFollowUp(
  question: string,
  imageBase64: string,
  vlmConfig: LlmModelConfig,
  constructionSpec?: string,
): Promise<FollowUpResult> {
  const model = createProviderModelFromConfig(vlmConfig);
  const systemPrompt = buildUncertainFollowUpPrompt(question, constructionSpec);

  const semaphore = getLlmSemaphore(vlmConfig.provider, vlmConfig.maxConcurrent);
  const result = await semaphore.run(async () =>
    trackedGenerateText({
      model,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `Inspect this high-resolution image and answer: ${question}` },
          { type: "image", image: imageBase64 },
        ],
      }],
      maxOutputTokens: 256,
    }, {
      purpose: "vlm_evaluation",
      providerName: vlmConfig.provider,
      modelId: vlmConfig.id,
      modelName: vlmConfig.modelName,
      modelConfig: { costPer1mInput: vlmConfig.costPer1mInput, costPer1mOutput: vlmConfig.costPer1mOutput },
    }),
  );

  const promptTokens = result.usage?.inputTokens ?? 0;
  const completionTokens = result.usage?.outputTokens ?? 0;

  // Parse the response — expect { pass: true|false, detail: "..." }
  let jsonStr = result.text;
  const fenceMatch = result.text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(jsonStr) as { pass?: boolean; detail?: string };
    return {
      pass: parsed.pass === true,
      detail: typeof parsed.detail === "string" ? parsed.detail : "",
      promptTokens,
      completionTokens,
    };
  } catch {
    // Fallback: look for pass/fail keywords
    const text = result.text.toLowerCase();
    const pass = text.includes("pass") && !text.includes("fail");
    return { pass, detail: result.text.slice(0, 200), promptTokens, completionTokens };
  }
}

// ── Angle selection heuristic ────────────────────────────────────────

function pickBestAngle(question: string, highRes: HighResRenderResult): string {
  const q = question.toLowerCase();
  const available = [...highRes.byAngle.keys()];

  // Simple keyword heuristics for angle selection
  if (q.includes("top") || q.includes("upper") || q.includes("above")) {
    if (available.includes("top")) return "top";
  }
  if (q.includes("bottom") || q.includes("lower") || q.includes("beneath")) {
    if (available.includes("bottom")) return "bottom";
  }
  if (q.includes("front") || q.includes("face")) {
    if (available.includes("front")) return "front";
  }
  if (q.includes("side") || q.includes("lateral")) {
    if (available.includes("left")) return "left";
  }

  // Default: ortho_45 gives the best overview
  if (available.includes("ortho_45")) return "ortho_45";
  return available[0] ?? "front";
}
