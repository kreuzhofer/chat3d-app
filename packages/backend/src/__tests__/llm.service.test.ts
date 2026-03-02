import { afterEach, describe, expect, it } from "vitest";
import { config } from "../config.js";
import { extractExecutableCode, generateConversationTextStream, listLlmModels } from "../services/llm.service.js";

const originalQueryConfig = {
  llmMode: config.query.llmMode,
  conversationProvider: config.query.conversationProvider,
  codegenProvider: config.query.codegenProvider,
  conversationModelName: config.query.conversationModelName,
  codegenModelName: config.query.codegenModelName,
};

afterEach(() => {
  config.query.llmMode = originalQueryConfig.llmMode;
  config.query.conversationProvider = originalQueryConfig.conversationProvider;
  config.query.codegenProvider = originalQueryConfig.codegenProvider;
  config.query.conversationModelName = originalQueryConfig.conversationModelName;
  config.query.codegenModelName = originalQueryConfig.codegenModelName;
});

describe("llm service provider routing", () => {
  it("exposes configured live providers in the model registry", () => {
    config.query.llmMode = "live";
    config.query.conversationProvider = "anthropic";
    config.query.conversationModelName = "claude-3-5-haiku-latest";
    config.query.codegenProvider = "xai";
    config.query.codegenModelName = "grok-2-latest";

    const models = listLlmModels();
    expect(models.some((model) => model.id === "conversation-anthropic-claude-3-5-haiku-latest")).toBe(true);
    expect(models.some((model) => model.id === "codegen-xai-grok-2-latest")).toBe(true);
  });

  it("extracts fenced python code for executable build123d payloads", () => {
    const raw = `
Here is your script:

\`\`\`python
from build123d import *
with BuildPart() as model:
    Box(10, 10, 10)
\`\`\`
`.trim();

    const extracted = extractExecutableCode(raw);
    expect(extracted.startsWith("from build123d import *")).toBe(true);
    expect(extracted.includes("```")).toBe(false);
  });

  it("streams conversation text token by token in mock mode", async () => {
    config.query.llmMode = "mock";

    const tokens: string[] = [];
    const result = await generateConversationTextStream({
      contextName: "Stream test context",
      prompt: "Hello streaming",
      onToken: (token) => tokens.push(token),
    });

    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.join("").trim()).toBe(result.text);
    expect(result.model.provider).toBe("mock");
    expect(result.usage).toBeDefined();
  });

});
