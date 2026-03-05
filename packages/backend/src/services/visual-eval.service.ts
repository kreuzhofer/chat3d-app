/**
 * Visual Evaluation Service
 *
 * Uses a vision-capable LLM (VLM) to evaluate rendered 3D model screenshots
 * against the original user prompt. Adapted from chat3d-docker's visualEval.ts
 * to use Vercel AI SDK with multi-provider support.
 */

import { generateText } from "ai";
import { isQuotaExhaustion, asQuotaError, isRateLimitError } from "../utils/llm-errors.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import { createLogger } from "../utils/logger.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  type LlmModelConfig,
} from "./llm-config.service.js";

const logger = createLogger("vlm-eval");
const EVAL_MAX_RETRIES = 2;

// ── Result types ─────────────────────────────────────────────────────

export interface EvaluationResult {
  score: number;
  issues: string[];
  suggestions: string[];
  looksCorrect: boolean;
  vlmModel: string;
  promptTokens: number;
  completionTokens: number;
}

interface ParsedEvaluation {
  score: number;
  issues: string[];
  suggestions: string[];
}

// ── Evaluation prompt ────────────────────────────────────────────────

function buildEvaluationSystemPrompt(
  userPrompt: string,
  categoryName: string,
  complexity: number,
): string {
  return `You are a 3D model quality evaluator for Build123d CAD models.

The user requested: "${userPrompt}"
Category: ${categoryName} (complexity level ${complexity}/10)

Evaluate the rendered 3D model shown in the images across three dimensions:
- Shape: Is the overall shape correct? Missing or extra geometry?
- Proportions: Are relative sizes of components correct?
- Features: Are requested details present and accurate?

Score the model from 1 to 10:
- 1–3: Poor — major elements missing or wrong shape
- 4–6: Partial — some elements correct, significant issues
- 7–8: Good — correct overall, minor issues only
- 9–10: Excellent — accurate representation of the request

Adjust your expectations to the category complexity level. A complexity-1 primitive
category only needs to demonstrate the basic shape correctly. A complexity-10 PCB case
must have accurate port cutouts, standoff placement, and structural features.

CRITICAL — about the rendering format:
These images show STL file renders using ORTHOGRAPHIC projection (no perspective distortion).
In orthographic projection, parallel edges remain perfectly parallel and relative sizes are
accurate regardless of distance from the camera. There is no foreshortening or convergence.
Straight geometry (cylinders, pipes, boxes) will appear truly straight — do not report tapering
or convergence artifacts.

STL is a tessellated mesh format — ALL surfaces are composed of flat triangular facets.
This is inherent to the format, not a defect. Curved surfaces (cylinders, spheres, fillets,
cones, tori) will ALWAYS appear faceted. The render uses flat shading with no anti-aliasing,
so edges may look jagged.

You are provided labeled views: front, back, left, right, top, bottom, a 45° down view, and a 45° up view.
Together these cover all six faces of the model plus two complementary 3D overviews (from above and below).

CRITICAL — positional judgments:
The 45° angled views create visual displacement: features appear shifted toward the camera's opposite
edge (e.g. holes appear lower in the 45° down view and higher in the 45° up view). This is a normal
projection effect, NOT a modeling error. To judge the vertical position of features, ALWAYS use the
straight side views (front, back, left, right) where vertical position maps directly to pixel position.
The camera is centered at the exact geometric center of the model's bounding box, so a feature at the
vertical center of the model appears at the vertical center of the straight side views.
Never report positional issues (e.g. "holes are in the lower half") based on angled views alone.

CRITICAL — do not invent requirements:
Only evaluate what the user ACTUALLY requested. If the prompt does not specify a position, size ratio,
or other detail, then ANY reasonable interpretation is correct and must NOT be flagged as an issue.
For example, if the prompt says "through-holes" without specifying vertical placement, the holes may be
at any height and this is NOT an issue. Only flag something as an issue if the prompt explicitly
requested it and the model clearly does not match.

You MUST completely ignore ALL of the following when scoring:
- Faceted/polygonal appearance of curved surfaces
- Lack of smoothness on rounded geometry
- Jagged or aliased edges
- Visible triangulation or tessellation artifacts
- Surface roughness from mesh approximation
These are ALL normal STL rendering characteristics and must NEVER reduce the score.

Focus ONLY on geometric similarity: Does this 3D model represent the correct type of object?
Do the overall shape, proportions, and key features match the request? Ignore texture, color
(unless the prompt requests color), photorealism, and rendering quality entirely.

Classifying issues vs suggestions:
- "issues": ONLY real geometric/structural problems — wrong shape, missing features,
  incorrect proportions, extra geometry, misaligned parts. These are problems in the
  Build123d code that produces the geometry. Issues must NEVER reference rendering
  artifacts, tessellation, or features the prompt did not request.
- "suggestions": ONLY prompt clarifications — specific ways the user's prompt could be
  more precise to get better results. Example: "The prompt does not specify hole vertical
  placement; adding 'at mid-height' would ensure centered positioning."
  Suggestions must NEVER contain: rendering observations, tessellation/faceting comments,
  "verify X in code" statements, or proposals to add features the prompt did not request.
  If you cannot identify a genuine prompt ambiguity, return an empty suggestions array.

Return JSON only:
{
  "score": <integer 1–10>,
  "issues": ["<geometric/structural problem>", ...],
  "suggestions": ["<rendering observation or code improvement>", ...]
}`;
}

// ── Response parsing (three-level fallback) ──────────────────────────

function clampScore(score: number): number {
  if (typeof score !== "number" || isNaN(score)) return 1;
  return Math.max(1, Math.min(10, Math.round(score)));
}

function buildResultFromParsed(parsed: ParsedEvaluation): ParsedEvaluation {
  return {
    score: clampScore(parsed.score),
    issues: Array.isArray(parsed.issues)
      ? parsed.issues.filter((i): i is string => typeof i === "string")
      : [],
    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s): s is string => typeof s === "string")
      : [],
  };
}

function extractFromText(content: string): ParsedEvaluation {
  const scoreMatch = content.match(/["']?score["']?\s*[:=]\s*(\d+)/i);
  const score = scoreMatch ? clampScore(parseInt(scoreMatch[1], 10)) : 1;

  const issues: string[] = [];
  const issuesSection = content.match(/issues[:\s]*\n?([\s\S]*?)(?=suggestions|$)/i);
  if (issuesSection) {
    const issueMatches = issuesSection[1].match(/[-•*]\s*(.+)/g);
    if (issueMatches) {
      issues.push(...issueMatches.map((m) => m.replace(/^[-•*]\s*/, "").trim()));
    }
  }

  const suggestions: string[] = [];
  const suggestionsSection = content.match(/suggestions[:\s]*\n?([\s\S]*?)$/i);
  if (suggestionsSection) {
    const suggestionMatches = suggestionsSection[1].match(/[-•*]\s*(.+)/g);
    if (suggestionMatches) {
      suggestions.push(...suggestionMatches.map((m) => m.replace(/^[-•*]\s*/, "").trim()));
    }
  }

  if (!scoreMatch && issues.length === 0 && suggestions.length === 0) {
    return { score: 1, issues: ["Failed to parse evaluation response"], suggestions: [] };
  }

  return { score, issues, suggestions };
}

export function parseEvaluationResponse(content: string): ParsedEvaluation {
  if (!content || typeof content !== "string") {
    return { score: 1, issues: ["Empty response"], suggestions: [] };
  }

  // Level 1: Extract JSON from code fence
  let jsonStr = content;
  const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim();
  }

  // Level 2: Direct JSON.parse
  try {
    const parsed = JSON.parse(jsonStr) as ParsedEvaluation;
    return buildResultFromParsed(parsed);
  } catch {
    // fall through
  }

  // Level 3: Regex extraction from unstructured text
  return extractFromText(content);
}

// ── Main evaluation function ─────────────────────────────────────────

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
  /** Optional override for the looks-correct score threshold (default 7) */
  looksCorrectThreshold?: number;
}

export async function evaluateModel(input: EvaluateModelInput): Promise<EvaluationResult> {
  const { userPrompt, categoryName, complexity, images } = input;

  logger.info(
    { prompt: userPrompt.slice(0, 80), category: categoryName, complexity, imageCount: images.length },
    "starting evaluation",
  );

  if (!images || images.length === 0) {
    logger.warn("no labeled images provided, returning score 1");
    return {
      score: 1,
      issues: ["No images provided for evaluation"],
      suggestions: [],
      looksCorrect: false,
      vlmModel: "",
      promptTokens: 0,
      completionTokens: 0,
    };
  }

  const vlmConfig = await getModelForPurpose("vlm_eval");
  const vlmModelLabel = vlmConfig.label;
  logger.info({ model: vlmModelLabel }, "using VLM model");

  const systemPrompt = buildEvaluationSystemPrompt(userPrompt, categoryName, complexity);

  // Build user message with labeled image parts.
  // Each image is preceded by a text label so the VLM knows which angle it's viewing.
  const angleLabels: Record<string, string> = {
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

  const userContent: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [
    { type: "text", text: "Please evaluate the following 3D model images:" },
  ];

  for (const img of images) {
    const label = angleLabels[img.angle] ?? img.angle;
    userContent.push({ type: "text", text: `${label}:` });
    userContent.push({ type: "image", image: img.base64 });
  }

  // Wrap entire evaluation (including retries) with per-provider semaphore
  const semaphore = getLlmSemaphore(vlmConfig.provider, vlmConfig.maxConcurrent);
  return semaphore.run(async () => {
    // Retry loop for transient errors (including rate limits)
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= EVAL_MAX_RETRIES; attempt++) {
      try {
        const providerModel = createProviderModelFromConfig(vlmConfig);

        logger.info({ attempt: attempt + 1, maxAttempts: EVAL_MAX_RETRIES + 1, model: vlmModelLabel }, "calling VLM");
        const result = await generateText({
          model: providerModel,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
          maxOutputTokens: 1024, // Eval-specific limit — keep responses concise
        });

        const responseText = result.text;
        if (!responseText) {
          throw new Error("Empty response from VLM");
        }

        logger.debug({ response: responseText.slice(0, 300) }, "raw VLM response");

        const parsed = parseEvaluationResponse(responseText);

        logger.info(
          { score: parsed.score, issueCount: parsed.issues.length, suggestionCount: parsed.suggestions.length },
          "evaluation parsed",
        );

        return {
          ...parsed,
          looksCorrect: parsed.score >= (input.looksCorrectThreshold ?? 7),
          vlmModel: vlmModelLabel,
          promptTokens: result.usage?.inputTokens ?? 0,
          completionTokens: result.usage?.outputTokens ?? 0,
        };
      } catch (error) {
        // Never retry quota/credit exhaustion errors — abort immediately
        if (isQuotaExhaustion(error)) {
          throw asQuotaError(error, vlmConfig.provider) ?? error;
        }

        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < EVAL_MAX_RETRIES) {
          // Rate limit errors get longer backoff; other transient errors use shorter delay
          const isRateLimit = isRateLimitError(error);
          const delay = isRateLimit
            ? Math.min(2000 * Math.pow(2, attempt), 60000)
            : 1000 * (attempt + 1);
          logger.warn(
            { attempt: attempt + 1, err: lastError, isRateLimit, delayMs: delay },
            "attempt failed, retrying",
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    logger.error({ err: lastError, attempts: EVAL_MAX_RETRIES + 1 }, "evaluation failed after all attempts");
    return {
      score: 1,
      issues: [`Evaluation failed: ${lastError?.message ?? "Unknown error"}`],
      suggestions: [],
      looksCorrect: false,
      vlmModel: vlmModelLabel,
      promptTokens: 0,
      completionTokens: 0,
    };
  });
}
