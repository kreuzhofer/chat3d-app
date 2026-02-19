import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { config } from "../config.js";

type LlmProvider = "mock" | "openai" | "anthropic" | "xai" | "ollama";

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

function selectModel(stage: "conversation" | "codegen"): LlmModelDefinition {
  if (config.query.llmMode !== "live") {
    return {
      id: `${stage}-mock`,
      provider: "mock",
      stage,
      modelName: stage === "conversation" ? "mock-conversation" : "mock-codegen",
    };
  }

  const provider = stage === "conversation" ? config.query.conversationProvider : config.query.codegenProvider;
  const modelName = stage === "conversation" ? config.query.conversationModelName : config.query.codegenModelName;

  return {
    id: `${stage}-${provider}-${modelName}`,
    provider,
    stage,
    modelName,
  };
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

function perTokenCostUsd(model: LlmModelDefinition): { inputPerToken: number; outputPerToken: number } {
  const pricesPer1k: Record<string, { input: number; output: number }> = {
    "openai:gpt-4o-mini": { input: 0.00015, output: 0.0006 },
    "openai:gpt-5.2-codex": { input: 0.0015, output: 0.006 },
    "anthropic:claude-3-5-haiku-latest": { input: 0.0008, output: 0.004 },
    "xai:grok-2-latest": { input: 0.002, output: 0.01 },
    "ollama:llama3.1": { input: 0, output: 0 },
    "mock:mock-conversation": { input: 0, output: 0 },
    "mock:mock-codegen": { input: 0, output: 0 },
  };

  const key = `${model.provider}:${model.modelName}`;
  const entry = pricesPer1k[key] ?? { input: 0, output: 0 };
  return {
    inputPerToken: entry.input / 1000,
    outputPerToken: entry.output / 1000,
  };
}

function roundUsd(value: number): number {
  return Number(value.toFixed(8));
}

function buildUsageMetadata(input: {
  model: LlmModelDefinition;
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

  const pricing = perTokenCostUsd(input.model);
  const estimatedCostUsd = roundUsd(
    inputTokens * pricing.inputPerToken + outputTokens * pricing.outputPerToken,
  );

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

async function generateWithProvider(model: LlmModelDefinition, prompt: string): Promise<ProviderGenerationResult> {
  if (model.provider === "openai") {
    if (!config.query.openAiApiKey) {
      throw new LlmServiceError("OPENAI_API_KEY is required for OpenAI provider", 500);
    }

    const openai = createOpenAI({
      apiKey: config.query.openAiApiKey,
    });

    const result = await generateText({
      model: openai(model.modelName),
      prompt,
    });

    if (!result.text || result.text.trim() === "") {
      throw new LlmServiceError("LLM returned empty output", 502);
    }

    return {
      text: result.text.trim(),
      usageRaw: result.usage,
    };
  }

  if (model.provider === "anthropic") {
    if (!config.query.anthropicApiKey) {
      throw new LlmServiceError("ANTHROPIC_API_KEY is required for Anthropic provider", 500);
    }

    const anthropic = createAnthropic({
      apiKey: config.query.anthropicApiKey,
    });

    const result = await generateText({
      model: anthropic(model.modelName),
      prompt,
    });

    if (!result.text || result.text.trim() === "") {
      throw new LlmServiceError("LLM returned empty output", 502);
    }

    return {
      text: result.text.trim(),
      usageRaw: result.usage,
    };
  }

  if (model.provider === "xai") {
    if (!config.query.xaiApiKey) {
      throw new LlmServiceError("XAI_API_KEY is required for xAI provider", 500);
    }

    const xai = createXai({
      apiKey: config.query.xaiApiKey,
    });

    const result = await generateText({
      model: xai(model.modelName),
      prompt,
    });

    if (!result.text || result.text.trim() === "") {
      throw new LlmServiceError("LLM returned empty output", 502);
    }

    return {
      text: result.text.trim(),
      usageRaw: result.usage,
    };
  }

  if (model.provider === "ollama") {
    const normalizedBaseUrl = config.query.ollamaBaseUrl.replace(/\/+$/, "");
    const baseUrlWithVersion = normalizedBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    const ollama = createOpenAICompatible({
      name: "ollama",
      baseURL: baseUrlWithVersion,
      apiKey: config.query.ollamaToken.trim() === "" ? undefined : config.query.ollamaToken.trim(),
    });

    const result = await generateText({
      model: ollama.chatModel(model.modelName),
      prompt,
    });

    if (!result.text || result.text.trim() === "") {
      throw new LlmServiceError("LLM returned empty output", 502);
    }

    return {
      text: result.text.trim(),
      usageRaw: result.usage,
    };
  }

  throw new LlmServiceError(`Unsupported LLM provider: ${model.provider}`, 500);
}

export function listLlmModels(): LlmModelDefinition[] {
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

export async function generateConversationText(input: {
  prompt: string;
  contextName: string;
}): Promise<ConversationGenerationResult> {
  const model = selectModel("conversation");
  const prompt = [
    "You are a CAD copilot. Answer briefly and provide practical modeling guidance.",
    `Chat context: ${input.contextName}`,
    `User request: ${input.prompt}`,
  ].join("\n\n");

  if (model.provider === "mock") {
    const text = `Mock assistant response for context "${input.contextName}": ${input.prompt}`;
    return {
      model,
      text,
      usage: buildUsageMetadata({
        model,
        prompt,
        outputText: text,
        providerUsageRaw: null,
      }),
    };
  }

  const result = await generateWithProvider(model, prompt);

  return {
    model,
    text: result.text,
    usage: buildUsageMetadata({
      model,
      prompt,
      outputText: result.text,
      providerUsageRaw: result.usageRaw,
    }),
  };
}

export async function generateBuild123dCode(input: {
  prompt: string;
  conversationText: string;
}): Promise<CodeGenerationResult> {
  const model = selectModel("codegen");
  const baseFileName = sanitizeBaseFileName(input.prompt);

  if (model.provider === "mock") {
    const code = `
from build123d import *
with BuildPart() as model:
    Box(20, 20, 20)
export_step(model.part, "${baseFileName}.step")
      `.trim();
    const prompt = [
      "Generate valid Python build123d code.",
      "Requirements:",
      `- Export one STEP file with base filename ${baseFileName}.step`,
      "- Code must be executable as-is.",
      `User request: ${input.prompt}`,
      `Assistant planning notes: ${input.conversationText}`,
    ].join("\n");

    return {
      model,
      baseFileName,
      code,
      usage: buildUsageMetadata({
        model,
        prompt,
        outputText: code,
        providerUsageRaw: null,
      }),
    };
  }

  const prompt = [
    "Generate valid Python build123d code.",
    "Requirements:",
    `- Export one STEP file with base filename ${baseFileName}.step`,
    "- Code must be executable as-is.",
    `User request: ${input.prompt}`,
    `Assistant planning notes: ${input.conversationText}`,
  ].join("\n");

  const result = await generateWithProvider(model, prompt);
  const code = extractExecutableCode(result.text);

  return {
    model,
    baseFileName,
    code,
    usage: buildUsageMetadata({
      model,
      prompt,
      outputText: code,
      providerUsageRaw: result.usageRaw,
    }),
  };
}
