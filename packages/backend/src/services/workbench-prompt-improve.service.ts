/**
 * Workbench Prompt Improvement Service
 *
 * Uses the codegen LLM to generate 3 improved prompt variations based on
 * the current prompt text and VLM evaluation feedback. The user picks one
 * and edits it before saving.
 */

import { trackedGenerateText } from "./tracked-llm.service.js";
import { createLogger } from "../utils/logger.js";
import { withLlmRetry } from "../utils/llm-retry.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  buildGenerateOptions,
  type LlmModelConfig,
} from "./llm-config.service.js";

const logger = createLogger("prompt-improve");

// ── Types ────────────────────────────────────────────────────────────

export interface ImprovePromptInput {
  promptText: string;
  evalIssues: string[];
  evalSuggestions: string[];
  code: string;
  disambiguationQuestions?: string[];
}

export interface ImprovePromptResult {
  variations: string[];
  model: string;
}

// ── System prompt ───────────────────────────────────────────────────

function buildImproveSystemPrompt(): string {
  return `You are a Build123d CAD prompt-writing assistant.

Given a user's original 3D modeling prompt, evaluation feedback (issues found and suggestions for improvement), and the generated code, produce exactly 3 improved prompt variations.

Each variation should:
- Preserve the user's original intent and all explicit requirements
- Address ambiguities identified in the suggestions (e.g., add missing dimensions, positions, or constraints)
- Be a complete, self-contained prompt (not a diff or delta)
- Be concise — one to three sentences, similar length to the original
- Use precise engineering language (e.g., "centered at mid-height" not "in the middle area")

Each variation should also:
- If ambiguity questions are provided, ensure each variation explicitly addresses those ambiguities with specific choices

The 3 variations should represent different interpretations or levels of detail:
1. Minimal clarification — only add what is needed to resolve the most critical ambiguity
2. Moderate clarification — address all suggestions while keeping the prompt readable
3. Full specification — make all dimensions, positions, and relationships fully explicit

Return JSON only:
{
  "variations": ["<variation 1>", "<variation 2>", "<variation 3>"]
}`;
}

function buildImproveUserMessage(input: ImprovePromptInput): string {
  const sections: string[] = [];

  sections.push(`Original prompt: "${input.promptText}"`);

  if (input.evalIssues.length > 0) {
    sections.push(`\nEvaluation issues:\n${input.evalIssues.map((i) => `- ${i}`).join("\n")}`);
  }

  if (input.evalSuggestions.length > 0) {
    sections.push(`\nEvaluation suggestions:\n${input.evalSuggestions.map((s) => `- ${s}`).join("\n")}`);
  }

  if (input.code) {
    sections.push(`\nGenerated Build123d code:\n\`\`\`python\n${input.code}\n\`\`\``);
  }

  if (input.disambiguationQuestions?.length) {
    sections.push(`\nAmbiguity questions identified:\n${input.disambiguationQuestions.map((q) => `- ${q}`).join("\n")}`);
  }

  sections.push("\nGenerate 3 improved prompt variations as described.");

  return sections.join("\n");
}

// ── Response parsing ────────────────────────────────────────────────

function parseVariations(text: string): string[] {
  // Try JSON parse first
  try {
    const parsed = JSON.parse(text);
    if (parsed?.variations && Array.isArray(parsed.variations)) {
      const filtered = parsed.variations.filter(
        (v: unknown): v is string => typeof v === "string" && v.trim().length > 0,
      );
      if (filtered.length >= 1) return filtered.slice(0, 3);
    }
  } catch {
    // Fall through to regex extraction
  }

  // Try extracting JSON from markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      if (parsed?.variations && Array.isArray(parsed.variations)) {
        const filtered = parsed.variations.filter(
          (v: unknown): v is string => typeof v === "string" && v.trim().length > 0,
        );
        if (filtered.length >= 1) return filtered.slice(0, 3);
      }
    } catch {
      // Fall through
    }
  }

  // Last resort: try to find quoted strings that look like prompts
  const quotedStrings = [...text.matchAll(/"([^"]{20,})"/g)].map((m) => m[1]);
  if (quotedStrings.length >= 1) {
    return quotedStrings.slice(0, 3);
  }

  throw new Error("Failed to parse prompt variations from LLM response");
}

// ── Main function ───────────────────────────────────────────────────

export async function improvePrompt(input: ImprovePromptInput): Promise<ImprovePromptResult> {
  const cfg: LlmModelConfig = await getModelForPurpose("agent_codegen");
  const model = createProviderModelFromConfig(cfg);
  const generateOptions = buildGenerateOptions(cfg);

  const systemPrompt = buildImproveSystemPrompt();
  const userMessage = buildImproveUserMessage(input);

  logger.info(
    { model: cfg.label, promptLength: input.promptText.length },
    "generating prompt improvement variations",
  );

  const semaphore = getLlmSemaphore(cfg.provider, cfg.maxConcurrent);

  const result = await semaphore.run(async () => {
    return withLlmRetry(
      async () =>
        trackedGenerateText({
          model,
          system: systemPrompt,
          prompt: userMessage,
          ...generateOptions,
        }, {
          purpose: "prompt_improvement",
          providerName: cfg.provider,
          modelId: cfg.id,
          modelName: cfg.modelName,
          modelConfig: { costPer1mInput: cfg.costPer1mInput, costPer1mOutput: cfg.costPer1mOutput },
        }),
      { provider: cfg.provider },
    );
  });

  const responseText = result.text;

  logger.debug(
    { responseLength: responseText.length },
    "received prompt improvement response",
  );

  const variations = parseVariations(responseText);

  logger.info(
    { variationCount: variations.length, model: cfg.label },
    "prompt improvement variations generated",
  );

  return {
    variations,
    model: cfg.label,
  };
}
