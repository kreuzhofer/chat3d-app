/**
 * Regression test for the patched @ai-sdk/openai-compatible stream flush
 * (patches/@ai-sdk+openai-compatible+2.0.62.patch, Vercel AI #7326).
 *
 * GLM-5.2 on vLLM can end a stream with an "orphan" tool call: tool_calls
 * deltas whose arguments never become parsable JSON before finish. The
 * upstream flush handler emits these as tool-call parts anyway, which blows
 * up downstream input parsing; our patch skips them. An earlier hand-written
 * version of the patch referenced `isParsableJson` without importing it in
 * the ESM bundle, crashing the whole agent pipeline with a ReferenceError —
 * this test exercises the real patched ESM bundle end-to-end.
 */
import { describe, it, expect } from "vitest";
import { streamText, jsonSchema, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

function sseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function makeModel(events: string[]) {
  const provider = createOpenAICompatible({
    name: "vllm-test",
    baseURL: "http://vllm.invalid/v1",
    fetch: async () => sseResponse(events),
  });
  return provider.chatModel("glm-5.2");
}

const validateTool = tool({
  description: "Validate build123d code",
  inputSchema: jsonSchema<{ code: string }>({
    type: "object",
    properties: { code: { type: "string" } },
    required: ["code"],
  }),
});

async function collectParts(events: string[]) {
  const result = streamText({
    model: makeModel(events),
    prompt: "make a box",
    tools: { validate_code: validateTool },
  });
  const parts: Array<{ type: string; [key: string]: unknown }> = [];
  for await (const part of result.fullStream) {
    parts.push(part as { type: string });
  }
  return parts;
}

describe("openai-compatible stream flush with orphan tool calls", () => {
  it("completes the stream and drops a tool call whose args never parse", async () => {
    const parts = await collectParts([
      '{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"Building it now."}}]}',
      '{"id":"c1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_orphan","type":"function","function":{"name":"validate_code","arguments":"{\\"code\\": \\"from build123d imp"}}]}}]}',
      '{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    ]);

    const errors = parts.filter((p) => p.type === "error");
    expect(errors).toEqual([]);
    expect(parts.filter((p) => p.type === "tool-call")).toEqual([]);
    const text = parts
      .filter((p) => p.type === "text-delta")
      .map((p) => p.text ?? p.textDelta)
      .join("");
    expect(text).toContain("Building it now.");
    expect(parts.some((p) => p.type === "finish")).toBe(true);
  });

  it("still emits complete tool calls (guard must not over-filter)", async () => {
    const parts = await collectParts([
      '{"id":"c2","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_ok","type":"function","function":{"name":"validate_code","arguments":"{\\"code\\": \\"Box(1,1,1)\\"}"}}]}}]}',
      '{"id":"c2","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
    ]);

    const errors = parts.filter((p) => p.type === "error");
    expect(errors).toEqual([]);
    const toolCalls = parts.filter((p) => p.type === "tool-call");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolName).toBe("validate_code");
    expect(toolCalls[0].input).toEqual({ code: "Box(1,1,1)" });
  });
});
