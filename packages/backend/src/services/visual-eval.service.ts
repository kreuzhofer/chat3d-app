/**
 * Visual Evaluation Service
 *
 * Uses a vision-capable LLM (VLM) to evaluate rendered 3D model screenshots
 * against the original user prompt. Adapted from chat3d-docker's visualEval.ts
 * to use Vercel AI SDK with multi-provider support.
 */

import { generateText } from "ai";
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
These images show STL file renders. STL is a tessellated mesh format — ALL surfaces are
composed of flat triangular facets. This is inherent to the format, not a defect.
Curved surfaces (cylinders, spheres, fillets, cones, tori) will ALWAYS appear faceted.
The render uses flat shading with no anti-aliasing, so edges may look jagged.

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
  Build123d code that produces the geometry.
- "suggestions": rendering observations, minor cosmetic notes, and code-level improvement
  ideas. These are NOT geometric errors and must NOT affect the score.
  Never put faceting, smoothness, aliasing, or tessellation observations into issues.

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

export interface EvaluateModelInput {
  userPrompt: string;
  categoryName: string;
  complexity: number;
  /** Base64-encoded PNG images from different angles */
  images: string[];
}

export async function evaluateModel(input: EvaluateModelInput): Promise<EvaluationResult> {
  const { userPrompt, categoryName, complexity, images } = input;

  logger.info(
    { prompt: userPrompt.slice(0, 80), category: categoryName, complexity, imageCount: images.length },
    "starting evaluation",
  );

  if (!images || images.length === 0) {
    logger.warn("no images provided, returning score 1");
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

  // Build user message with image parts
  const userContent: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [
    { type: "text", text: "Please evaluate the following 3D model images:" },
  ];

  for (const base64Image of images) {
    userContent.push({ type: "image", image: base64Image });
  }

  // Retry loop
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
        looksCorrect: parsed.score >= 7,
        vlmModel: vlmModelLabel,
        promptTokens: result.usage?.inputTokens ?? 0,
        completionTokens: result.usage?.outputTokens ?? 0,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < EVAL_MAX_RETRIES) {
        logger.warn(
          { attempt: attempt + 1, err: lastError },
          "attempt failed, retrying",
        );
        // Brief delay before retry
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
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
}
