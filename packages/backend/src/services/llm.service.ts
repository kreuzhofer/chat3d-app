import { generateText, streamText } from "ai";
import { config } from "../config.js";
import { getBuild123dReference } from "../data/build123d-api-reference.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  buildGenerateOptions,
  calculateCostUsd,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { createLogger } from "../utils/logger.js";
import type { ConversationHistoryEntry } from "./query.service.js";

const logger = createLogger("llm");

type LlmProvider = "mock" | "openai" | "anthropic" | "xai" | "deepseek" | "minimax" | "ollama";

export interface LlmModelDefinition {
  id: string;
  provider: LlmProvider;
  stage: "conversation" | "codegen";
  modelName: string;
}

export interface ConversationGenerationResult {
  text: string;
  model: LlmModelDefinition;
  usage: LlmUsageMetadata;
}

export interface CodeGenerationResult {
  code: string;
  baseFileName: string;
  model: LlmModelDefinition;
  usage: LlmUsageMetadata;
}

export interface LlmUsageMetadata {
  source: "provider" | "estimated";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

const MODEL_REGISTRY: LlmModelDefinition[] = (["conversation", "codegen"] as const).flatMap((stage) => {
  const entries: Array<{ provider: LlmProvider; modelName: string }> = [
    { provider: "mock", modelName: stage === "conversation" ? "mock-conversation" : "mock-codegen" },
    { provider: "openai", modelName: stage === "conversation" ? "gpt-4o-mini" : "gpt-5.2-codex" },
    { provider: "anthropic", modelName: "claude-3-5-haiku-latest" },
    { provider: "xai", modelName: "grok-2-latest" },
    { provider: "ollama", modelName: "llama3.1" },
  ];

  return entries.map((entry) => ({
    id: `${stage}-${entry.provider}-${entry.modelName}`,
    provider: entry.provider,
    stage,
    modelName: entry.modelName,
  }));
});

export class LlmServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
  ) {
    super(message);
  }
}

function sanitizeBaseFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "generated-model";
}

export function extractExecutableCode(raw: string): string {
  const fencedCodeBlock =
    raw.match(/```python\s*([\s\S]*?)```/i) ??
    raw.match(/```py\s*([\s\S]*?)```/i) ??
    raw.match(/```\s*([\s\S]*?)```/i);

  if (fencedCodeBlock?.[1]) {
    return fencedCodeBlock[1].trim();
  }

  return raw.trim();
}

/**
 * Map stage name to DB purpose name.
 */
function stageToPurpose(stage: "conversation" | "codegen"): string {
  return stage === "conversation" ? "conversation" : "chat_codegen";
}

/**
 * Resolve the model for a given stage from the DB-driven config.
 * Returns both the LlmModelDefinition (for backward compat) and the resolved LlmModelConfig.
 */
async function resolveModelForStage(stage: "conversation" | "codegen"): Promise<{ def: LlmModelDefinition; cfg: LlmModelConfig }> {
  if (config.query.llmMode !== "live") {
    const def: LlmModelDefinition = {
      id: `${stage}-mock`,
      provider: "mock",
      stage,
      modelName: stage === "conversation" ? "mock-conversation" : "mock-codegen",
    };
    // Return a dummy config for mock mode
    return {
      def,
      cfg: {
        id: "mock",
        provider: "mock",
        modelName: def.modelName,
        displayName: def.modelName,
        label: `mock/${def.modelName}`,
        costPer1mInput: 0,
        costPer1mOutput: 0,
        maxOutputTokens: null,
        maxContextTokens: null,
        supportsThinking: false,
        thinkingEffort: null,
        supportsVision: false,
        supportsEmbeddings: false,
        endpointUrl: null,
        apiKey: null,
      },
    };
  }

  const purpose = stageToPurpose(stage);
  const cfg = await getModelForPurpose(purpose);
  const def: LlmModelDefinition = {
    id: `${stage}-${cfg.provider}-${cfg.modelName}`,
    provider: cfg.provider as LlmProvider,
    stage,
    modelName: cfg.modelName,
  };
  return { def, cfg };
}

interface ProviderGenerationResult {
  text: string;
  usageRaw: unknown;
}

function toSafePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : null;
}

function extractTokenUsage(value: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  if (typeof value !== "object" || value === null) {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    };
  }

  const usage = value as Record<string, unknown>;
  const inputTokens = toSafePositiveInteger(usage.inputTokens ?? usage.promptTokens ?? usage.input_tokens);
  const outputTokens = toSafePositiveInteger(
    usage.outputTokens ?? usage.completionTokens ?? usage.output_tokens,
  );
  const totalTokens = toSafePositiveInteger(usage.totalTokens ?? usage.total_tokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function buildUsageMetadata(input: {
  model: LlmModelDefinition;
  modelConfig?: LlmModelConfig;
  prompt: string;
  outputText: string;
  providerUsageRaw: unknown;
}): LlmUsageMetadata {
  const providerUsage = extractTokenUsage(input.providerUsageRaw);

  const estimatedInput = estimateTokens(input.prompt);
  const estimatedOutput = estimateTokens(input.outputText);
  const estimatedTotal = estimatedInput + estimatedOutput;

  const inputTokens = providerUsage.inputTokens ?? estimatedInput;
  const outputTokens = providerUsage.outputTokens ?? estimatedOutput;
  const totalTokens = providerUsage.totalTokens ?? inputTokens + outputTokens;

  // Use DB-driven pricing if config is available, otherwise fall back to 0
  const estimatedCostUsd = input.modelConfig
    ? calculateCostUsd(input.modelConfig, inputTokens, outputTokens)
    : 0;

  return {
    source:
      providerUsage.inputTokens !== null ||
      providerUsage.outputTokens !== null ||
      providerUsage.totalTokens !== null
        ? "provider"
        : "estimated",
    inputTokens,
    outputTokens,
    totalTokens: totalTokens > 0 ? totalTokens : estimatedTotal,
    estimatedCostUsd,
  };
}

/**
 * Generate text using the DB-driven model config.
 * Replaces the old provider-specific generateWithProvider().
 */
async function generateWithConfig(
  cfg: LlmModelConfig,
  prompt: string,
): Promise<ProviderGenerationResult> {
  const providerModel = createProviderModelFromConfig(cfg);
  const extraOpts = buildGenerateOptions(cfg);

  const result = await generateText({
    model: providerModel,
    prompt,
    ...extraOpts,
  });

  if (!result.text || result.text.trim() === "") {
    throw new LlmServiceError("LLM returned empty output", 502);
  }

  return {
    text: result.text.trim(),
    usageRaw: result.usage,
  };
}

/**
 * Stream text using the DB-driven model config.
 * Replaces the old provider-specific streamWithProvider().
 */
async function streamWithConfig(
  cfg: LlmModelConfig,
  prompt: string,
  onToken: (token: string) => void,
): Promise<ProviderGenerationResult> {
  const providerModel = createProviderModelFromConfig(cfg);
  const extraOpts = buildGenerateOptions(cfg);

  const result = streamText({
    model: providerModel,
    prompt,
    ...extraOpts,
  });

  let fullText = "";
  for await (const chunk of result.textStream) {
    fullText += chunk;
    onToken(chunk);
  }

  const finalResult = await result;

  if (fullText.trim() === "") {
    throw new LlmServiceError("LLM returned empty output", 502);
  }

  return {
    text: fullText.trim(),
    usageRaw: finalResult.usage,
  };
}

export function listLlmModels(): LlmModelDefinition[] {
  // Keep MODEL_REGISTRY for backward compatibility with /api/llm/models endpoint
  const configuredConversation = {
    id: `conversation-${config.query.conversationProvider}-${config.query.conversationModelName}`,
    provider: config.query.conversationProvider,
    stage: "conversation" as const,
    modelName: config.query.conversationModelName,
  };

  const configuredCodegen = {
    id: `codegen-${config.query.codegenProvider}-${config.query.codegenModelName}`,
    provider: config.query.codegenProvider,
    stage: "codegen" as const,
    modelName: config.query.codegenModelName,
  };

  const unique = new Map<string, LlmModelDefinition>();
  for (const model of [...MODEL_REGISTRY, configuredConversation, configuredCodegen]) {
    unique.set(model.id, model);
  }

  return [...unique.values()];
}

/**
 * Format conversation history entries into a text block for LLM prompts.
 * Returns empty string if no history is available.
 */
export function formatConversationHistory(history?: ConversationHistoryEntry[]): string {
  if (!history || history.length === 0) return "";

  const lines = ["## Conversation History"];
  for (const entry of history) {
    const roleLabel = entry.role === "user" ? "User" : "Assistant";
    lines.push(`[${entry.sequencePosition}] ${roleLabel}: ${entry.text}`);
    if (entry.code) {
      lines.push("```python", entry.code, "```");
    }
  }
  return lines.join("\n");
}

/**
 * Find the most recent Build123d code from conversation history.
 * Used as the baseline for modification in codegen prompts.
 */
export function findMostRecentCode(history?: ConversationHistoryEntry[]): string | undefined {
  if (!history || history.length === 0) return undefined;
  // Walk backwards to find the most recent assistant entry with code
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant" && history[i].code) {
      return history[i].code;
    }
  }
  return undefined;
}

const CONVERSATION_SYSTEM_PROMPT = [
  "You are a CAD copilot for Chat3D, a prompt-to-CAD workspace that generates 3D models using Build123d.",
  "",
  "IMPORTANT: You must begin your response with exactly one of these tags on its own line:",
  "- [CODEGEN_NEEDED] — if the user is requesting a 3D model, part, or geometry to be created, modified, or regenerated.",
  "- [CHAT_ONLY] — if the user is asking a question, making conversation, requesting information, or anything that does NOT require generating a 3D model.",
  "",
  "After the tag, provide your response. Be brief and practical.",
  "",
  "CRITICAL RULES:",
  "- When you respond with [CODEGEN_NEEDED], write ONLY a brief natural-language acknowledgment of what you will generate (1-2 sentences). Do NOT include any code, code blocks, or technical implementation details. A separate code-generation pipeline will produce the code — your job is only to confirm the request.",
  "  Good example: '[CODEGEN_NEEDED]\\nI'll generate an L-shaped mounting bracket with your specified dimensions and bolt holes.'",
  "  Bad example: '[CODEGEN_NEEDED]\\nHere is the code: ```python from build123d import * ...```'",
  "- When you respond with [CHAT_ONLY], provide a helpful conversational response.",
  "",
  "Examples of [CHAT_ONLY]: greetings, questions about capabilities, requests for tips, feedback on previous results without requesting changes.",
  "Examples of [CODEGEN_NEEDED]: 'design a gear', 'make it taller', 'add a fillet', 'create an enclosure', any request that implies generating or modifying 3D geometry.",
].join("\n");

function buildConversationPrompt(input: {
  prompt: string;
  contextName: string;
  conversationHistory?: ConversationHistoryEntry[];
}): string {
  const historyBlock = formatConversationHistory(input.conversationHistory);
  return [
    CONVERSATION_SYSTEM_PROMPT,
    `Chat context: ${input.contextName}`,
    historyBlock,
    `User request: ${input.prompt}`,
  ].filter(Boolean).join("\n\n");
}

/**
 * Parse the conversation response to extract the codegen decision tag and clean text.
 * Returns { needsCodegen: boolean, text: string } where text has the tag stripped.
 */
export function parseConversationResponse(raw: string): { needsCodegen: boolean; text: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[CODEGEN_NEEDED]")) {
    return { needsCodegen: true, text: trimmed.slice("[CODEGEN_NEEDED]".length).trim() };
  }
  if (trimmed.startsWith("[CHAT_ONLY]")) {
    return { needsCodegen: false, text: trimmed.slice("[CHAT_ONLY]".length).trim() };
  }
  // Default to chat-only if the LLM didn't follow instructions — safer to skip codegen
  // than to trigger an unwanted model generation for a conversational question.
  return { needsCodegen: false, text: trimmed };
}

export async function generateConversationText(input: {
  prompt: string;
  contextName: string;
  conversationHistory?: ConversationHistoryEntry[];
}): Promise<ConversationGenerationResult> {
  const { def: model, cfg: modelCfg } = await resolveModelForStage("conversation");
  const prompt = buildConversationPrompt(input);

  if (model.provider === "mock") {
    const text = `[CODEGEN_NEEDED]\nMock assistant response for context "${input.contextName}": ${input.prompt}`;
    return {
      model,
      text,
      usage: buildUsageMetadata({
        model,
        modelConfig: modelCfg,
        prompt,
        outputText: text,
        providerUsageRaw: null,
      }),
    };
  }

  const result = await generateWithConfig(modelCfg, prompt);

  return {
    model,
    text: result.text,
    usage: buildUsageMetadata({
      model,
      modelConfig: modelCfg,
      prompt,
      outputText: result.text,
      providerUsageRaw: result.usageRaw,
    }),
  };
}

export async function generateConversationTextStream(input: {
  prompt: string;
  contextName: string;
  onToken: (token: string) => void;
  conversationHistory?: ConversationHistoryEntry[];
}): Promise<ConversationGenerationResult> {
  const { def: model, cfg: modelCfg } = await resolveModelForStage("conversation");
  const prompt = buildConversationPrompt(input);

  if (model.provider === "mock") {
    const text = `[CODEGEN_NEEDED]\nMock assistant response for context "${input.contextName}": ${input.prompt}`;
    // Simulate streaming by emitting the mock response word by word
    for (const word of text.split(" ")) {
      input.onToken(word + " ");
    }
    return {
      model,
      text,
      usage: buildUsageMetadata({
        model,
        modelConfig: modelCfg,
        prompt,
        outputText: text,
        providerUsageRaw: null,
      }),
    };
  }

  const result = await streamWithConfig(modelCfg, prompt, input.onToken);

  return {
    model,
    text: result.text,
    usage: buildUsageMetadata({
      model,
      modelConfig: modelCfg,
      prompt,
      outputText: result.text,
      providerUsageRaw: result.usageRaw,
    }),
  };
}

export function buildCodegenPrompt(
  baseFileName: string,
  userPrompt: string,
  conversationText: string,
  conversationHistory?: ConversationHistoryEntry[],
): string {
  const { entries, examples } = getBuild123dReference();

  const classReference = entries
    .map((e) => `  - ${e.className}: ${e.signature} — ${e.description}`)
    .join("\n");

  const exampleSnippets = examples
    .map((ex) => `### ${ex.operation}: ${ex.description}\n\`\`\`python\n${ex.code}\n\`\`\``)
    .join("\n\n");

  const sections = [
    "Generate valid Python build123d code.",
    "",
    "## Build123d API Reference — Available Classes and Functions",
    classReference,
    "",
    "## Example Code Snippets",
    exampleSnippets,
    "",
    "Use ONLY the classes and functions listed above. Do NOT invent or hallucinate classes that are not in this reference.",
    "",
  ];

  // Include most recent code as baseline for modification (Req 10.3, 11.1)
  const baselineCode = findMostRecentCode(conversationHistory);
  if (baselineCode) {
    sections.push(
      "## Previous Code (baseline for modification)",
      "Modify this existing code based on the user's follow-up request. Preserve working parts and apply the requested changes.",
      "```python",
      baselineCode,
      "```",
      "",
    );
  }

  // Include conversation history for context (Req 10.1, 10.4)
  const historyBlock = formatConversationHistory(conversationHistory);
  if (historyBlock) {
    sections.push(historyBlock, "");
  }

  sections.push(
    "## Requirements",
    `- Export one STEP file with base filename ${baseFileName}.step`,
    "- Code must be executable as-is.",
    "",
    `User request: ${userPrompt}`,
    `Assistant planning notes: ${conversationText}`,
  );

  return sections.join("\n");
}

export async function generateBuild123dCode(input: {
  prompt: string;
  conversationText: string;
  conversationHistory?: ConversationHistoryEntry[];
}): Promise<CodeGenerationResult> {
  const { def: model, cfg: modelCfg } = await resolveModelForStage("codegen");
  const baseFileName = sanitizeBaseFileName(input.prompt);

  if (model.provider === "mock") {
    const code = `
from build123d import *
with BuildPart() as model:
    Box(20, 20, 20)
export_step(model.part, "${baseFileName}.step")
      `.trim();
    const prompt = buildCodegenPrompt(baseFileName, input.prompt, input.conversationText, input.conversationHistory);

    return {
      model,
      baseFileName,
      code,
      usage: buildUsageMetadata({
        model,
        modelConfig: modelCfg,
        prompt,
        outputText: code,
        providerUsageRaw: null,
      }),
    };
  }

  const prompt = buildCodegenPrompt(baseFileName, input.prompt, input.conversationText, input.conversationHistory);

  const result = await generateWithConfig(modelCfg, prompt);
  const code = extractExecutableCode(result.text);

  return {
    model,
    baseFileName,
    code,
    usage: buildUsageMetadata({
      model,
      modelConfig: modelCfg,
      prompt,
      outputText: code,
      providerUsageRaw: result.usageRaw,
    }),
  };
}
