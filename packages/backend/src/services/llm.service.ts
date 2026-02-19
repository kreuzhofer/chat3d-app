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
}

export interface CodeGenerationResult {
  code: string;
  baseFileName: string;
  model: LlmModelDefinition;
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

async function generateWithProvider(model: LlmModelDefinition, prompt: string): Promise<string> {
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

    return result.text.trim();
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

    return result.text.trim();
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

    return result.text.trim();
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

    return result.text.trim();
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

  if (model.provider === "mock") {
    return {
      model,
      text: `Mock assistant response for context "${input.contextName}": ${input.prompt}`,
    };
  }

  const prompt = [
    "You are a CAD copilot. Answer briefly and provide practical modeling guidance.",
    `Chat context: ${input.contextName}`,
    `User request: ${input.prompt}`,
  ].join("\n\n");

  return {
    model,
    text: await generateWithProvider(model, prompt),
  };
}

export async function generateBuild123dCode(input: {
  prompt: string;
  conversationText: string;
}): Promise<CodeGenerationResult> {
  const model = selectModel("codegen");
  const baseFileName = sanitizeBaseFileName(input.prompt);

  if (model.provider === "mock") {
    return {
      model,
      baseFileName,
      code: `
from build123d import *
with BuildPart() as model:
    Box(20, 20, 20)
export_step(model.part, "${baseFileName}.step")
      `.trim(),
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

  const text = await generateWithProvider(model, prompt);

  return {
    model,
    baseFileName,
    code: extractExecutableCode(text),
  };
}
