/**
 * Visual Evaluation Service
 *
 * Uses a vision-capable LLM (VLM) to evaluate rendered 3D model screenshots
 * against the original user prompt. Adapted from chat3d-docker's visualEval.ts
 * to use Vercel AI SDK with multi-provider support.
 */

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "../config.js";

const EVAL_MAX_RETRIES = 2;

type VlmProvider = "anthropic" | "openai";

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

// ── Provider resolution ──────────────────────────────────────────────

function resolveVlmProvider(): { provider: VlmProvider; modelName: string } {
  const provider = config.workbench.evalVlmProvider;
  const modelName = config.workbench.evalVlmModel;

  // If Anthropic is configured but key is missing, fall back to OpenAI
  if (provider === "anthropic" && !config.query.anthropicApiKey) {
    if (config.query.openAiApiKey) {
      console.warn("ANTHROPIC_API_KEY missing, falling back to OpenAI for VLM evaluation");
      return { provider: "openai", modelName: "gpt-4o" };
    }
    throw new Error("No VLM API key available (neither ANTHROPIC_API_KEY nor OPENAI_API_KEY)");
  }

  if (provider === "openai" && !config.query.openAiApiKey) {
    if (config.query.anthropicApiKey) {
      console.warn("OPENAI_API_KEY missing, falling back to Anthropic for VLM evaluation");
      return { provider: "anthropic", modelName: "claude-sonnet-4-6" };
    }
    throw new Error("No VLM API key available (neither OPENAI_API_KEY nor ANTHROPIC_API_KEY)");
  }

  return { provider, modelName };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createProviderModel(provider: VlmProvider, modelName: string): any {
  if (provider === "anthropic") {
    return createAnthropic({ apiKey: config.query.anthropicApiKey })(modelName);
  }
  return createOpenAI({ apiKey: config.query.openAiApiKey })(modelName);
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

Our renders are untextured 3D models. Focus on geometric similarity only — not texture,
color (unless the prompt requests color), or photorealism. Focus on: Does this 3D model
represent the same type of object? Do the overall shape, proportions, and key features match?

Return JSON only:
{
  "score": <integer 1–10>,
  "issues": ["<specific visual problem>", ...],
  "suggestions": ["<build123d code-level fix>", ...]
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

  if (!images || images.length === 0) {
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

  const { provider, modelName } = resolveVlmProvider();
  const vlmModelLabel = `${provider}/${modelName}`;
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
      const providerModel = createProviderModel(provider, modelName);

      const result = await generateText({
        model: providerModel,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
        maxTokens: 1024,
      });

      const responseText = result.text;
      if (!responseText) {
        throw new Error("Empty response from VLM");
      }

      const parsed = parseEvaluationResponse(responseText);

      return {
        ...parsed,
        looksCorrect: parsed.score >= 7,
        vlmModel: vlmModelLabel,
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < EVAL_MAX_RETRIES) {
        console.warn(
          `VLM evaluation attempt ${attempt + 1} failed, retrying: ${lastError.message}`,
        );
        // Brief delay before retry
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  console.error(`VLM evaluation failed after ${EVAL_MAX_RETRIES + 1} attempts:`, lastError?.message);
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
