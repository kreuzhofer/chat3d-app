/**
 * Guided JSON for the visual judge (issue #53).
 *
 * On OpenAI-compatible providers (vLLM) the judge's answer is constrained to
 * the evaluation schema at decode time: the SDK sends
 * `response_format: {type: "json_schema"}` and vLLM compiles it into a
 * grammar, so a structurally invalid answer cannot occur. The Anthropic path
 * — the reference judge — must be left exactly as it was.
 *
 * The provider factory itself is covered in llm-config-structured-outputs.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Capture the judge's LLM call instead of making it ────────────────

interface FakeStream { text: string; reasoning?: string; finishReason?: string }
const streamCalls: Array<Record<string, unknown>> = [];
let nextStream: FakeStream = { text: "" };

vi.mock("../services/tracked-llm.service.js", () => ({
  trackedStreamText: vi.fn((options: Record<string, unknown>) => {
    streamCalls.push(options);
    const { text, reasoning = "", finishReason = "stop" } = nextStream;
    async function* parts() {
      if (reasoning) yield { type: "reasoning-delta", text: reasoning };
      if (text) yield { type: "text-delta", text };
    }
    return {
      fullStream: parts(),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
      finishReason: Promise.resolve(finishReason),
    };
  }),
}));

vi.mock("../services/llm-config.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/llm-config.service.js")>();
  return { ...actual, createProviderModel: vi.fn(() => ({ modelId: "fake-model" })) };
});
vi.mock("../services/generation-settings.service.js", () => ({
  getZoomSettings: vi.fn(async () => ({ enabled: true, resolutionPx: 1536, maxFollowUps: 3 })),
}));

import { evaluateModelWithConfig } from "../services/visual-eval.service.js";
import {
  buildEvaluationResponseSchema,
  resolveGuidedJsonOutput,
} from "../services/visual-eval-schema.service.js";
import type { LlmModelConfig } from "../services/llm-config.service.js";
import { STANDARD_VIEWS } from "../services/visual-eval-views.js";

function cfg(overrides: Partial<LlmModelConfig> = {}): LlmModelConfig {
  return {
    id: "m1", provider: "vllm-dgx-14", providerType: "openai-compatible",
    modelName: "glm-5.3-flash", displayName: "glm", label: "vllm-dgx-14/glm-5.3-flash",
    costPer1mInput: 0, costPer1mOutput: 0, maxOutputTokens: null, maxContextTokens: null,
    supportsThinking: true, thinkingEffort: "high", supportsVision: true, supportsEmbeddings: false,
    streamingEnabled: true, vlmEvalPreamble: null, endpointUrl: "http://vllm.local/v1", apiKey: null,
    maxConcurrent: null,
    ...overrides,
  };
}
const anthropicCfg = () => cfg({ provider: "anthropic", providerType: null, modelName: "claude-sonnet-4-6", label: "anthropic/claude-sonnet-4-6", apiKey: "k" });

const images = STANDARD_VIEWS.map((angle) => ({ angle, base64: "AAA" }));

async function responseFormatOf(options: Record<string, unknown>) {
  const output = options.output as { responseFormat: Promise<Record<string, unknown>> } | undefined;
  return output ? output.responseFormat : undefined;
}

beforeEach(() => { streamCalls.length = 0; nextStream = { text: "" }; });

// ── The schema ───────────────────────────────────────────────────────

describe("buildEvaluationResponseSchema", () => {
  it("pins score to 1–10, one checklist entry per question, and nothing else", () => {
    const schema = buildEvaluationResponseSchema(3) as Record<string, any>;
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["score", "issues", "suggestions", "checklist"]);
    expect(schema.properties.score.enum).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(schema.properties.issues).toEqual({ type: "array", items: { type: "string" } });
    expect(schema.properties.suggestions).toEqual({ type: "array", items: { type: "string" } });

    const checklist = schema.properties.checklist;
    expect(checklist.minItems).toBe(3);
    expect(checklist.maxItems).toBe(3);
    expect(checklist.items.required).toEqual(["question", "pass", "detail"]);
    expect(checklist.items.additionalProperties).toBe(false);
    expect(checklist.items.properties.pass.enum).toEqual([true, false, null]);
  });

  it("has no checklist at all when no question was asked", () => {
    const schema = buildEvaluationResponseSchema(0) as Record<string, any>;
    expect(schema.properties.checklist).toBeUndefined();
    expect(schema.required).toEqual(["score", "issues", "suggestions"]);
  });
});

// ── Per-provider enforcement ─────────────────────────────────────────

describe("resolveGuidedJsonOutput", () => {
  it("returns a JSON output spec carrying the schema for an OpenAI-compatible judge", async () => {
    const schema = buildEvaluationResponseSchema(2);
    const output = resolveGuidedJsonOutput(cfg(), schema);
    expect(output).toBeDefined();
    expect(await output!.responseFormat).toEqual({ type: "json", schema, name: "evaluation" });
  });

  it("leaves Anthropic and every other provider type unconstrained", () => {
    const schema = buildEvaluationResponseSchema(2);
    expect(resolveGuidedJsonOutput(anthropicCfg(), schema)).toBeUndefined();
    for (const providerType of ["openai", "ollama", "bedrock", "xai"]) {
      expect(resolveGuidedJsonOutput(cfg({ providerType }), schema)).toBeUndefined();
    }
  });
});

// ── Wiring through the judge call ────────────────────────────────────

describe("evaluateModelWithConfig — guided JSON", () => {
  it("sends the schema, sized to the non-blank questions, on the vLLM path and parses the answer", async () => {
    nextStream = {
      text: JSON.stringify({
        score: 7, issues: [], suggestions: [],
        checklist: [
          { question: "Are there two arms?", pass: true, detail: "visible" },
          { question: "Is the pin centred?", pass: null, detail: "" },
        ],
      }),
    };
    const result = await evaluateModelWithConfig({
      userPrompt: "a hinge", categoryName: "Hinges", complexity: 3, images,
      verificationChecklist: ["Are there two arms?", "  ", "Is the pin centred?"],
    }, cfg());

    expect(streamCalls).toHaveLength(1);
    const format = (await responseFormatOf(streamCalls[0])) as Record<string, any>;
    expect(format.type).toBe("json");
    expect(format.schema.properties.checklist.minItems).toBe(2);
    expect(format.schema.properties.checklist.maxItems).toBe(2);
    expect(streamCalls[0].maxOutputTokens).toBe(4096);

    expect(result.score).toBe(7);
    expect(result.checklistResults).toEqual([
      { question: "Are there two arms?", pass: true, detail: "visible" },
      { question: "Is the pin centred?", pass: null, detail: "" },
    ]);
  });

  it("makes the Anthropic call exactly as before: no output constraint", async () => {
    nextStream = { text: JSON.stringify({ score: 8, issues: [], suggestions: [] }) };
    const result = await evaluateModelWithConfig({
      userPrompt: "a hinge", categoryName: "Hinges", complexity: 3, images,
      verificationChecklist: ["Are there two arms?"],
    }, anthropicCfg());

    expect(streamCalls).toHaveLength(1);
    expect("output" in streamCalls[0]).toBe(false);
    expect(streamCalls[0].maxOutputTokens).toBe(4096);
    expect(streamCalls[0].temperature).toBe(0);
    expect(result.score).toBe(8);
  });

  it("names the cause when the judge spent its whole output budget reasoning", async () => {
    nextStream = { text: "", reasoning: "x".repeat(500), finishReason: "length" };
    const result = await evaluateModelWithConfig({
      userPrompt: "a hinge", categoryName: "Hinges", complexity: 3, images,
      verificationChecklist: ["Are there two arms?"],
    }, cfg());

    expect(result.score).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/^Empty response from VLM/);
    expect(result.issues[0]).toMatch(/output budget/);
    expect(result.issues[0]).toMatch(/"length"/);
    expect(result.issues[0]).toMatch(/500 reasoning chars/);
  });
});
