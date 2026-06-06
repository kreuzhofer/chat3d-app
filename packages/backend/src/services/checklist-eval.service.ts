import type { RenderedFile } from "./rendering.service.js";
import type { EvalPlan } from "../utils/eval-plan.js";
import type {
  ComponentChecklistItem,
  ComponentVerificationResult,
  ChecklistItemResult,
  ChecklistVerdict,
} from "../utils/component-checklist.js";
import { createLogger } from "../utils/logger.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { trackedStreamText } from "./tracked-llm.service.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";

const logger = createLogger("checklist-eval");

export interface ChecklistFocusedEvalArgs {
  item: string;
  code: string;
  images: RenderedFile[];
}

export interface ChecklistFocusedEvalResult {
  verdict: ChecklistVerdict;
  reasoning: string;
}

export interface RunChecklistEvalInput {
  checklist: ComponentChecklistItem[];
  code: string;
  renderedFiles: RenderedFile[];
  evalPlan: EvalPlan | null;
  visualVerify: (args: ChecklistFocusedEvalArgs) => Promise<ChecklistFocusedEvalResult>;
  codeVerify: (args: ChecklistFocusedEvalArgs) => Promise<ChecklistFocusedEvalResult>;
}

const ANGLE_FROM_FILENAME = (fileName: string): string => {
  // file shapes: `<name>_front.png` (with prefix) or `front.png` (bare angle). Match suffix.
  const withPrefix = fileName.match(/_([a-z0-9_]+)\.(png|jpg|jpeg)$/i);
  if (withPrefix) return withPrefix[1];
  const bare = fileName.match(/^([a-z0-9_]+)\.(png|jpg|jpeg)$/i);
  if (bare) return bare[1];
  return fileName;
};

function filterImagesByPlan(files: RenderedFile[], evalPlan: EvalPlan | null): RenderedFile[] {
  if (!evalPlan?.inspectionPlan?.angles?.length) return files;
  const wanted = new Set<string>(evalPlan.inspectionPlan.angles);
  const filtered = files.filter((f) => wanted.has(ANGLE_FROM_FILENAME(f.fileName)));
  if (filtered.length === 0) {
    logger.warn(
      { wantedAngles: [...wanted], actualFiles: files.map((f) => f.fileName) },
      "filterImagesByPlan: no files matched evalPlan angles; falling back to all files",
    );
    return files;
  }
  return filtered;
}

// Combines visual + code verdicts. At least one must be non-null; the dispatcher's
// visibility guard guarantees this. With both null the function returns PASS via
// vacuous truth — do not call without a non-null argument.
function combine(
  visual: ChecklistFocusedEvalResult | null,
  code: ChecklistFocusedEvalResult | null,
): ChecklistFocusedEvalResult {
  const parts: string[] = [];
  if (visual) parts.push(`visual: ${visual.reasoning}`);
  if (code) parts.push(`code: ${code.reasoning}`);
  const verdicts = [visual?.verdict, code?.verdict].filter(Boolean) as ChecklistVerdict[];
  let verdict: ChecklistVerdict;
  if (verdicts.includes("FAIL")) verdict = "FAIL";
  else if (verdicts.every((v) => v === "PASS")) verdict = "PASS";
  else verdict = "UNCERTAIN";
  return { verdict, reasoning: parts.join(" | ") };
}

export async function runChecklistEval(
  input: RunChecklistEvalInput,
): Promise<ComponentVerificationResult> {
  const { checklist, code, renderedFiles, evalPlan, visualVerify, codeVerify } = input;
  if (checklist.length === 0) {
    return { results: [], passedCount: 0, failedCount: 0, uncertainCount: 0 };
  }

  const visualImages = filterImagesByPlan(renderedFiles, evalPlan);

  const results: ChecklistItemResult[] = await Promise.all(
    checklist.map(async (entry, index): Promise<ChecklistItemResult> => {
      try {
        const wantVisual = entry.visibility === "visual" || entry.visibility === "both";
        const wantCode = entry.visibility === "code" || entry.visibility === "both";

        const [v, c] = await Promise.all([
          wantVisual
            ? visualVerify({ item: entry.item, code, images: visualImages })
            : Promise.resolve(null),
          wantCode
            ? codeVerify({ item: entry.item, code, images: visualImages })
            : Promise.resolve(null),
        ]);

        const combined = combine(v, c);
        return {
          index,
          item: entry.item,
          visibility: entry.visibility,
          verdict: combined.verdict,
          reasoning: combined.reasoning,
        };
      } catch (err) {
        logger.warn({ err, index, item: entry.item }, "checklist item eval failed");
        return {
          index,
          item: entry.item,
          visibility: entry.visibility,
          verdict: "UNCERTAIN",
          reasoning: `eval failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }),
  );

  const passedCount = results.filter((r) => r.verdict === "PASS").length;
  const failedCount = results.filter((r) => r.verdict === "FAIL").length;
  const uncertainCount = results.filter((r) => r.verdict === "UNCERTAIN").length;

  return { results, passedCount, failedCount, uncertainCount };
}

// ── Focused checklist verifiers ───────────────────────────────────────

/**
 * Parse a verdict text response from an LLM into a ChecklistFocusedEvalResult.
 * Looks for PASS / FAIL / UNCERTAIN on the first ~32 characters of the response.
 */
export function parseChecklistVerdictText(text: string): ChecklistFocusedEvalResult {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();
  let verdict: ChecklistVerdict = "UNCERTAIN";
  if (/^PASS\b|\bPASS\b/.test(upper.slice(0, 32))) verdict = "PASS";
  else if (/^FAIL\b|\bFAIL\b/.test(upper.slice(0, 32))) verdict = "FAIL";
  else if (/^UNCERTAIN\b/.test(upper)) verdict = "UNCERTAIN";
  return { verdict, reasoning: trimmed.slice(0, 600) };
}

const VISUAL_SYS_PROMPT = (item: string): string =>
  `You are verifying ONE specific feature of a 3D model from rendered images.\n` +
  `The feature to verify: "${item}"\n\n` +
  `Reply on the first line with exactly one of: PASS, FAIL, UNCERTAIN.\n` +
  `Then add 1-3 sentences of reasoning. Use PASS only when the images clearly show the feature; ` +
  `UNCERTAIN when the views don't show it clearly; FAIL when the images contradict it.`;

const CODE_SYS_PROMPT = (item: string): string =>
  `You are verifying ONE specific spec item against Python Build123d code.\n` +
  `The spec item to verify: "${item}"\n\n` +
  `Reply on the first line with exactly one of: PASS, FAIL, UNCERTAIN.\n` +
  `Then add 1-3 sentences of reasoning. PASS only when the code clearly satisfies the item; ` +
  `UNCERTAIN when the code is ambiguous; FAIL when it contradicts the item.`;

async function resolveVlmConfig(): Promise<LlmModelConfig> {
  return getModelForPurpose("vlm_eval");
}

async function resolveCodeReviewConfig(): Promise<{ config: LlmModelConfig }> {
  for (const purpose of ["code_review", "spec_generation", "conversation"] as const) {
    try {
      const config = await getModelForPurpose(purpose);
      if (purpose !== "code_review") {
        logger.info({ purpose }, "code_review purpose not configured, falling back for checklist eval");
      }
      return { config };
    } catch {
      continue;
    }
  }
  throw new Error("No LLM model configured for code review (tried code_review, spec_generation, conversation)");
}

export async function verifyChecklistItemVisual(
  args: ChecklistFocusedEvalArgs,
): Promise<ChecklistFocusedEvalResult> {
  const vlmConfig = await resolveVlmConfig();
  // Cap at 3 images defensively (dispatcher already slices, but be explicit)
  const images = args.images.slice(0, 3);

  const userContent: Array<{ type: "text"; text: string } | { type: "image"; image: string; mimeType: string }> = [
    { type: "text", text: "Verify this feature from the views below." },
    ...images.map((img) => ({
      type: "image" as const,
      image: img.contentBase64,
      mimeType: img.mimeType ?? "image/png",
    })),
  ];

  const providerModel = createProviderModelFromConfig(vlmConfig);
  const semaphore = getLlmSemaphore(vlmConfig.provider, vlmConfig.maxConcurrent);

  return semaphore.run(async () => {
    logger.info({ item: args.item, model: vlmConfig.label, imageCount: images.length }, "verifyChecklistItemVisual calling VLM");

    const stream = trackedStreamText({
      model: providerModel,
      system: VISUAL_SYS_PROMPT(args.item),
      messages: [{ role: "user" as const, content: userContent }],
      maxOutputTokens: 256,
      temperature: 0,
    }, {
      purpose: "vlm_evaluation",
      providerName: vlmConfig.provider,
      modelId: vlmConfig.id,
      modelName: vlmConfig.modelName,
      modelConfig: { costPer1mInput: vlmConfig.costPer1mInput, costPer1mOutput: vlmConfig.costPer1mOutput },
    });

    let text = "";
    for await (const part of stream.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    await stream;

    logger.debug({ item: args.item, response: text }, "verifyChecklistItemVisual raw response");
    return parseChecklistVerdictText(text);
  });
}

export async function verifyChecklistItemCode(
  args: ChecklistFocusedEvalArgs,
): Promise<ChecklistFocusedEvalResult> {
  const { config } = await resolveCodeReviewConfig();

  const userContent = `Verify this spec item against the Build123d code below.\n\n\`\`\`python\n${args.code}\n\`\`\``;
  const providerModel = createProviderModelFromConfig(config);
  const semaphore = getLlmSemaphore(config.provider, config.maxConcurrent);

  return semaphore.run(async () => {
    logger.info({ item: args.item, model: config.label }, "verifyChecklistItemCode calling LLM");

    const stream = trackedStreamText({
      model: providerModel,
      system: CODE_SYS_PROMPT(args.item),
      messages: [{ role: "user" as const, content: userContent }],
      maxOutputTokens: 256,
      temperature: 0,
    }, {
      purpose: "code_evaluation",
      providerName: config.provider,
      modelId: config.id,
      modelName: config.modelName,
      modelConfig: { costPer1mInput: config.costPer1mInput, costPer1mOutput: config.costPer1mOutput },
    });

    let text = "";
    for await (const part of stream.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    await stream;

    logger.debug({ item: args.item, response: text }, "verifyChecklistItemCode raw response");
    return parseChecklistVerdictText(text);
  });
}
