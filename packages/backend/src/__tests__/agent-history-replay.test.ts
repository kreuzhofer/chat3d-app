/**
 * Regression guard for issue #22: rebuilt agent history must satisfy the AI
 * SDK's ModelMessage[] prompt validator.
 *
 * stepsToMessages() used to emit tool-call parts under the pre-v7 `args` key.
 * Because the content array was typed `any[]`, TypeScript never caught it, and
 * every replay path (the nudge loop, the workbench fix loop) died in ~0 ms with
 * "Invalid prompt: The messages do not match the ModelMessage[] schema" before
 * a single byte hit the provider.
 *
 * Note on zod versions: under the zod the deployed image resolves (4.5.2) the
 * schema's `input: z.unknown()` is non-optional, so a missing `input` is a hard
 * validation failure. Under the zod resolved here (3.25.x v4-compat) the key is
 * optional and the buggy shape merely *parses away* the payload. The assertions
 * below therefore check the parsed output, not just `success`, so they fail on
 * the regression under either resolution.
 */
import { describe, it, expect } from "vitest";
import { modelMessageSchema, streamText, jsonSchema, tool, type ModelMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { stepsToMessages, type RawAgentStep } from "../utils/agent-history.js";

const INITIAL: ModelMessage[] = [
  { role: "user", content: "Create a Build123d model of a 20mm cube." },
];

/** One completed step in the AI SDK v7 shape: tool call carries `input`. */
const V7_STEPS: RawAgentStep[] = [
  {
    text: "Writing the cube now.",
    toolCalls: [
      {
        toolCallId: "call_1",
        toolName: "text_editor",
        input: { command: "create", path: "main.py", file_text: "box = Box(20, 20, 20)" },
      },
    ],
    toolResults: [
      { toolCallId: "call_1", toolName: "text_editor", output: "Created main.py (21 bytes)" },
    ],
  },
];

function assistantToolCallParts(history: ModelMessage[]) {
  return history
    .filter(m => m.role === "assistant")
    .flatMap(m => (Array.isArray(m.content) ? m.content : []))
    .filter((p): p is { type: "tool-call"; toolCallId: string; toolName: string; input: unknown } =>
      (p as { type?: string }).type === "tool-call");
}

describe("stepsToMessages — rebuilt agent history", () => {
  it("produces a history that validates against the SDK's ModelMessage schema", () => {
    const history = stepsToMessages(INITIAL, V7_STEPS);

    expect(assistantToolCallParts(history)).toHaveLength(1);
    for (const message of history) {
      const parsed = modelMessageSchema.safeParse(message);
      expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    }

    // The schema strips unknown keys, so validating the *parsed* messages is
    // what proves the tool-call payload survives the round-trip.
    const validated = history.map(m => modelMessageSchema.parse(m)) as ModelMessage[];
    expect(assistantToolCallParts(validated)[0].input).toEqual(
      V7_STEPS[0].toolCalls![0].input,
    );
  });

  it("emits the tool-call payload under `input`, never the pre-v7 `args` key", () => {
    const [toolCall] = assistantToolCallParts(stepsToMessages(INITIAL, V7_STEPS));

    expect(toolCall.input).toEqual({
      command: "create",
      path: "main.py",
      file_text: "box = Box(20, 20, 20)",
    });
    expect(toolCall).not.toHaveProperty("args");
  });

  it("still reads the payload from a step that carries the legacy `args` key", () => {
    const legacySteps: RawAgentStep[] = [
      {
        toolCalls: [{ toolCallId: "call_1", toolName: "lookup_api", args: { topic: "sweep" } }],
      },
    ];
    const [toolCall] = assistantToolCallParts(stepsToMessages(INITIAL, legacySteps));

    expect(toolCall.input).toEqual({ topic: "sweep" });
  });

  it("prefers the v7 `output` key but still reads a legacy `result`", () => {
    const legacyOnly: RawAgentStep[] = [
      { toolResults: [{ toolCallId: "c1", toolName: "render", result: "legacy text" }] },
    ];
    const bothKeys: RawAgentStep[] = [
      { toolResults: [{ toolCallId: "c1", toolName: "render", output: "v7 text", result: "legacy text" }] },
    ];

    const textOf = (steps: RawAgentStep[]) => {
      const toolMessage = stepsToMessages([], steps).find(m => m.role === "tool");
      const [part] = toolMessage!.content as Array<{ output: { value: string } }>;
      return part.output.value;
    };

    expect(textOf(legacyOnly)).toBe("legacy text");
    expect(textOf(bothKeys)).toBe("v7 text");
  });

  it("wraps tool results in the v7 output shape and skips malformed parts", () => {
    const messyStep: RawAgentStep[] = [
      {
        toolCalls: [
          { toolName: "text_editor", input: {} },               // no toolCallId → dropped
          { toolCallId: "call_ok", toolName: "render", input: {} },
        ],
        toolResults: [
          { toolName: "render", output: "ignored" },             // no toolCallId → dropped
          { toolCallId: "call_ok", toolName: "render", output: { ok: true } },
        ],
      },
    ];
    const history = stepsToMessages([], messyStep);

    expect(assistantToolCallParts(history)).toHaveLength(1);
    const toolMessage = history.find(m => m.role === "tool");
    expect(toolMessage?.content).toEqual([
      {
        type: "tool-result",
        toolCallId: "call_ok",
        toolName: "render",
        output: { type: "text", value: JSON.stringify({ ok: true }) },
      },
    ]);
    for (const message of history) {
      expect(modelMessageSchema.safeParse(message).success).toBe(true);
    }
  });
});

/**
 * Scope note: this exercises the message assembly the nudge loop performs
 * (agent-codegen.service.ts builds `[...conversationHistory, nudge]`), not
 * runAgentCodegen() itself — standing that whole loop up needs a provider, the
 * agent filesystem, the render service and the trace builder. A regression in
 * the two assembly lines themselves would not be caught here.
 */
describe("nudge replay reaches the provider", () => {
  it("sends a rebuilt history + nudge message over the wire instead of failing validation", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const provider = createOpenAICompatible({
      name: "vllm-test",
      baseURL: "http://vllm.invalid/v1",
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(
          'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n' +
            "data: [DONE]\n\n",
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    const nudgeMessages: ModelMessage[] = [
      ...stepsToMessages(INITIAL, V7_STEPS),
      { role: "user", content: "You wrote code but did not submit. Call validate_and_render now." },
    ];

    const result = streamText({
      model: provider.chatModel("qwen3.8-27b-bf16"),
      messages: nudgeMessages,
      tools: {
        validate_and_render: tool({
          description: "Render the current project",
          inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        }),
      },
    });
    // Consuming the stream surfaces InvalidPromptError, which is thrown
    // synchronously by the prompt validator before any fetch happens.
    for await (const _part of result.fullStream) { /* drain */ }

    expect(requests).toHaveLength(1);
    const sent = requests[0].messages as Array<Record<string, unknown>>;
    const assistant = sent.find(m => m.role === "assistant");
    expect(assistant?.tool_calls).toMatchObject([
      { function: { name: "text_editor" } },
    ]);
    expect(String((assistant?.tool_calls as any[])[0].function.arguments)).toContain("main.py");
  });
});
