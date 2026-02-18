import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "../config.js";

export interface LlmModelDefinition {
  id: string;
  provider: "mock" | "openai";
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

const MODEL_REGISTRY: LlmModelDefinition[] = [
  {
    id: "conversation-mock-v1",
    provider: "mock",
    stage: "conversation",
    modelName: "mock-conversation",
  },
  {
    id: "codegen-mock-v1",
    provider: "mock",
    stage: "codegen",
    modelName: "mock-codegen",
  },
  {
    id: "conversation-openai-gpt-4o-mini",
    provider: "openai",
    stage: "conversation",
    modelName: "gpt-4o-mini",
  },
  {
    id: "codegen-openai-gpt-4o-mini",
    provider: "openai",
    stage: "codegen",
    modelName: "gpt-4o-mini",
  },
];

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

function selectModel(stage: "conversation" | "codegen"): LlmModelDefinition {
  const preferredProvider = config.query.llmMode === "live" ? "openai" : "mock";
  const selected = MODEL_REGISTRY.find((model) => model.stage === stage && model.provider === preferredProvider);
  if (!selected) {
    throw new LlmServiceError(`No model configured for stage=${stage} provider=${preferredProvider}`, 500);
  }
  return selected;
}

async function generateWithOpenAi(modelName: string, prompt: string): Promise<string> {
  if (!config.query.openAiApiKey) {
    throw new LlmServiceError("OPENAI_API_KEY is required in QUERY_LLM_MODE=live", 500);
  }

  const openai = createOpenAI({
    apiKey: config.query.openAiApiKey,
  });

  const result = await generateText({
    model: openai(modelName),
    prompt,
  });

  if (!result.text || result.text.trim() === "") {
    throw new LlmServiceError("LLM returned empty output", 502);
  }

  return result.text.trim();
}

export function listLlmModels(): LlmModelDefinition[] {
  return [...MODEL_REGISTRY];
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
    text: await generateWithOpenAi(model.modelName, prompt),
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

  const text = await generateWithOpenAi(model.modelName, prompt);

  return {
    model,
    baseFileName,
    code: text,
  };
}
