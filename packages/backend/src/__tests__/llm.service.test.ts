import { afterEach, describe, expect, it } from "vitest";
import { config } from "../config.js";
import { extractExecutableCode, generateConversationTextStream } from "../services/llm.service.js";

const originalLlmMode = config.query.llmMode;

afterEach(() => {
  config.query.llmMode = originalLlmMode;
});

describe("llm service", () => {
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
