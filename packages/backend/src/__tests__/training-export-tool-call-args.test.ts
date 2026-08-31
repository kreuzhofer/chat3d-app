/**
 * The rebuilt agent conversation is persisted per workbench example and read
 * back by the training exporter. Issue #22 renamed the producer's tool-call key
 * from `args` to `input`; the converter must keep reading both, or every
 * already-stored row silently exports `arguments: "{}"` and the fine-tuning
 * dataset is corrupted with no error.
 */
import { describe, it, expect } from "vitest";
import { convertAgentConversation } from "../services/workbench-training-export.service.js";

const SYSTEM = "You are a Build123d agent.";
const PAYLOAD = { command: "create", path: "main.py", file_text: "box = Box(20, 20, 20)" };

function conversationWithToolCall(callPart: Record<string, unknown>) {
  return [
    { role: "user", content: "Create a 20mm cube." },
    { role: "assistant", content: [{ type: "text", text: "Writing it." }, callPart] },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "text_editor",
          output: { type: "text", value: "Created main.py" },
        },
      ],
    },
  ];
}

function firstToolCall(messages: ReturnType<typeof convertAgentConversation>) {
  const assistant = messages.find(m => m.role === "assistant");
  expect(assistant?.tool_calls).toBeDefined();
  return assistant!.tool_calls![0];
}

describe("convertAgentConversation — tool-call arguments", () => {
  it("exports arguments for historical rows stored under the pre-v7 `args` key", () => {
    const messages = convertAgentConversation(
      conversationWithToolCall({
        type: "tool-call", toolCallId: "call_1", toolName: "text_editor", args: PAYLOAD,
      }),
      SYSTEM,
    );

    const call = firstToolCall(messages);
    expect(call.function.name).toBe("text_editor");
    expect(JSON.parse(call.function.arguments)).toEqual(PAYLOAD);
  });

  it("exports arguments for rows stored under the current `input` key", () => {
    const messages = convertAgentConversation(
      conversationWithToolCall({
        type: "tool-call", toolCallId: "call_1", toolName: "text_editor", input: PAYLOAD,
      }),
      SYSTEM,
    );

    expect(JSON.parse(firstToolCall(messages).function.arguments)).toEqual(PAYLOAD);
  });

  it("passes through a pre-serialized string payload under either key", () => {
    for (const key of ["args", "input"] as const) {
      const messages = convertAgentConversation(
        conversationWithToolCall({
          type: "tool-call", toolCallId: "call_1", toolName: "lookup_api",
          [key]: '{"topic":"sweep"}',
        }),
        SYSTEM,
      );
      expect(firstToolCall(messages).function.arguments).toBe('{"topic":"sweep"}');
    }
  });

  it("falls back to an empty object when neither key carries a payload", () => {
    const messages = convertAgentConversation(
      conversationWithToolCall({
        type: "tool-call", toolCallId: "call_1", toolName: "validate_and_render",
      }),
      SYSTEM,
    );

    expect(firstToolCall(messages).function.arguments).toBe("{}");
  });

  it("still emits the tool result message alongside the call", () => {
    const messages = convertAgentConversation(
      conversationWithToolCall({
        type: "tool-call", toolCallId: "call_1", toolName: "text_editor", input: PAYLOAD,
      }),
      SYSTEM,
    );

    expect(messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: "Created main.py",
    });
  });
});
