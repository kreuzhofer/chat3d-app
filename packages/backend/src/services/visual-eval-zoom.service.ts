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
import { NoObjectGeneratedError } from "ai";
import { trackedGenerateText } from "./tracked-llm.service.js";
import { withJudgeSlot } from "./judge-slots.service.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { getZoomSettings } from "./generation-settings.service.js";
import { FOLLOW_UP_VIEWS, STANDARD_VIEWS, VIEW_LABELS, type StandardView } from "./visual-eval-views.js";
import { buildUncertainFollowUpPrompt } from "./visual-eval-prompt.service.js";
import {
  resolveFollowUpOutput,
} from "./visual-eval-schema.service.js";
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
  /** The views sent, in order. */
  angles: string[];
  /** The judge's answer; null when its reply could not be read as one (the item stays uncertain). */
  pass: boolean | null;
  /** The judge's evidence, or why the reply could not be read. */
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

/**
 * All eight, since issue #67. The set was seven — `ortho_45_bottom` (the 45°
 * up view) was never rendered, so a follow-up could not be shown one of the
 * eight views the judge is promised, and 13 of 95 adjudicated items name it
 * as the view that decides them. Every one of these is rendered on every
 * evaluation already; the pick only decides which are sent.
 */
const DEFAULT_HIGHRES_ANGLES: ViewingAngle[] = [...STANDARD_VIEWS] as ViewingAngle[];

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

  // The same three settings the Instrument id hashes (ADR 0003): an admin
  // edit here is a new revision of the procedure, not a silent change.
  const { enabled, resolutionPx: resolution, maxFollowUps } = await getZoomSettings();
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
    const views = followUpViews(highRes);
    const angles = views.map((v) => v.angle);

    if (views.length === 0) {
      logger.warn({ question: item.question }, "no high-res image for any follow-up view, skipping follow-up");
      resolvedChecklist[index] = { ...item, zoomFollowUp: "skipped" };
      continue;
    }

    try {
      const result = await runSingleFollowUp(item.question, views, judge, constructionSpec);
      followUpCount++;
      followUpDetails.push({ question: item.question, angles, pass: result.pass, detail: result.detail });
      totalPromptTokens += result.promptTokens;
      totalCompletionTokens += result.completionTokens;

      if (result.pass === null) {
        // Fail loud, never guess: the item stays uncertain (issue #56), and
        // the row says the follow-up was tried and could not be read (#61).
        logger.warn(
          { question: item.question.slice(0, 60), angles, reason: result.detail },
          "zoom follow-up reply could not be read, keeping uncertain",
        );
        resolvedChecklist[index] = { ...item, zoomFollowUp: "unreadable", zoomViews: angles };
        continue;
      }
      // The views sent are stamped on the resolved item too (issue #67): the
      // pick used to vanish on success, so no stored run could say which view
      // answered an item, and #61's angles were unrecoverable.
      resolvedChecklist[index] = {
        question: item.question,
        pass: result.pass,
        detail: `[2x zoom] ${result.detail}`,
        zoomViews: angles,
      };
      logger.info({ question: item.question.slice(0, 60), pass: result.pass, angles }, "uncertain item resolved via zoom");
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), question: item.question.slice(0, 60) }, "zoom follow-up failed, keeping uncertain");
      resolvedChecklist[index] = { ...item, zoomFollowUp: "failed", zoomViews: angles };
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
  /** null: the reply could not be read as an answer; `detail` says why. */
  pass: boolean | null;
  detail: string;
  promptTokens: number;
  completionTokens: number;
}

async function runSingleFollowUp(
  question: string,
  views: FollowUpView[],
  vlmConfig: LlmModelConfig,
  constructionSpec?: string,
): Promise<FollowUpResult> {
  const model = createProviderModelFromConfig(vlmConfig);
  const systemPrompt = buildUncertainFollowUpPrompt(question, constructionSpec);
  // The main judge call's guards (issue #56): temperature 0, and the answer's
  // shape as the decoding grammar on vLLM — and, since issue #64, as
  // structured output on Anthropic too, where free text under the evidence
  // clause turned into prose that overran the cap.
  const guidedOutput = resolveFollowUpOutput(vlmConfig);

  const semaphore = getLlmSemaphore(vlmConfig.provider, vlmConfig.maxConcurrent);
  let result: Awaited<ReturnType<typeof trackedGenerateText>>;
  try {
    result = await withJudgeSlot(vlmConfig, () => semaphore.run(async () =>
    trackedGenerateText({
      model,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: [
          { type: "text" as const, text: `Inspect these high-resolution views and answer: ${question}` },
          // Each image is preceded by its label, the same wording the main
          // call uses, so "the top view shows…" in the detail is checkable.
          ...views.flatMap((v) => [
            { type: "text" as const, text: `${VIEW_LABELS[v.angle]}:` },
            { type: "image" as const, image: v.base64 },
          ]),
        ],
      }],
      // One JSON object with a one-sentence detail; the cap only stops a runaway
      // reply, it is not what keeps the answer short (#64 raised it from 256).
      maxOutputTokens: 512,
      temperature: 0,
      ...(guidedOutput ? { output: guidedOutput } : {}),
    }, {
      purpose: "vlm_evaluation",
      providerName: vlmConfig.provider,
      modelId: vlmConfig.id,
      modelName: vlmConfig.modelName,
      modelConfig: { costPer1mInput: vlmConfig.costPer1mInput, costPer1mOutput: vlmConfig.costPer1mOutput },
      // The follow-up is a judge call like any other, and #67 made it the one
      // whose views decide the answer — it records its condition too (ADR 0005).
      endpointUrl: vlmConfig.endpointUrl,
    }),
  ));
  } catch (err) {
    // With guided output the SDK validates the reply before we see it; its
    // rejection is the same outcome as ours, recorded the same way.
    if (NoObjectGeneratedError.isInstance(err)) {
      return {
        pass: null,
        detail: `reply could not be read as a pass/fail answer (finish reason "${err.finishReason ?? "unknown"}", ` +
          `rejected by the SDK's output parser): ${snippet(err.text ?? "")}`,
        promptTokens: err.usage?.inputTokens ?? 0,
        completionTokens: err.usage?.outputTokens ?? 0,
      };
    }
    throw err;
  }

  const promptTokens = result.usage?.inputTokens ?? 0;
  const completionTokens = result.usage?.outputTokens ?? 0;

  const answer = readFollowUpAnswer(result.text);
  if (!answer.ok) {
    const finishReason = result.finishReason ?? "unknown";
    return {
      pass: null,
      detail: `reply could not be read as a pass/fail answer (finish reason "${finishReason}"): ${answer.reason}`,
      promptTokens,
      completionTokens,
    };
  }
  return { pass: answer.pass, detail: answer.detail, promptTokens, completionTokens };
}

// ── Reading the reply ────────────────────────────────────────────────

export type FollowUpAnswer =
  | { ok: true; pass: boolean; detail: string }
  | { ok: false; reason: string };

/**
 * The reply as `{pass, detail}`, or why it is not one. Strict on purpose: the
 * old keyword fallback read any fragment containing the word "pass" as a
 * pass, so `"pass": false` inside prose was stored as true (issue #56). A
 * code fence around the JSON is unwrapped; anything else that is not a JSON
 * object with a boolean `pass` is unreadable, and the caller keeps the item
 * uncertain.
 */
export function readFollowUpAnswer(text: string): FollowUpAnswer {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (fenceMatch ? fenceMatch[1] : text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { ok: false, reason: `not JSON: ${snippet(text)}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: `not a JSON object: ${snippet(text)}` };
  }
  const { pass, detail } = parsed as { pass?: unknown; detail?: unknown };
  if (typeof pass !== "boolean") {
    return { ok: false, reason: `"pass" is ${JSON.stringify(pass)}, not a boolean: ${snippet(text)}` };
  }
  return { ok: true, pass, detail: typeof detail === "string" ? detail : "" };
}

function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
}

// ── The views the follow-up sends ────────────────────────────────────

interface FollowUpView { angle: StandardView; base64: string }

/**
 * The follow-up's views, in `FOLLOW_UP_VIEWS` order, skipping any the render
 * did not produce.
 *
 * This replaces a keyword rule that read the item's wording and sent ONE view
 * ("face" fired on front; the word "top" was the only way to reach the top
 * view). Against the deciding view of 92 adjudicated items it was right 42%
 * of the time — below a constant `top` — because one view is usually not
 * enough: the deciding view is item-specific and often plural. The fixed set
 * covers 91% and cannot mis-read a question, having stopped reading it.
 */
function followUpViews(highRes: HighResRenderResult): FollowUpView[] {
  const out: FollowUpView[] = [];
  for (const angle of FOLLOW_UP_VIEWS) {
    const base64 = highRes.byAngle.get(angle);
    if (base64) out.push({ angle, base64 });
  }
  return out;
}
