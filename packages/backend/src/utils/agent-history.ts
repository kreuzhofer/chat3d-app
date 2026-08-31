/**
 * Rebuilds an agent conversation (ModelMessage[]) from completed SDK steps.
 *
 * The AI SDK carries history internally across the steps of a single
 * streamText/generateText call, so the happy path never needs this. It exists
 * for the paths that *continue* a finished run:
 *   1. the nudge loop in agent-codegen.service.ts (agent wrote code but never
 *      called submit_result)
 *   2. the workbench fix loop, which feeds the rebuilt history back in as
 *      `previousMessages`
 *
 * The rebuilt history is also persisted per workbench example and read back by
 * the training exporter, so the emitted shape is a stored data contract — see
 * convertAgentConversation() in workbench-training-export.service.ts. Producer
 * and consumer share toolCallPayload() below precisely so they cannot drift
 * apart again the way they did in issue #22.
 */

import type {
  ModelMessage as CoreMessage,
  TextPart,
  ToolCallPart,
  ToolResultPart,
} from "ai";
import { createLogger } from "./logger.js";

const logger = createLogger("agent-history");

/** Anything carrying a tool-call payload under either the v7 or pre-v7 key. */
export interface ToolCallPayloadCarrier {
  /** Current AI SDK v7 key. */
  input?: unknown;
  /** Pre-v7 key: still on legacy step objects and on stored conversation rows. */
  args?: unknown;
}

/**
 * Read a tool-call part's payload, accepting both the current `input` key and
 * the pre-v7 `args` key.
 *
 * Rows persisted before the rename store the payload under `args`, and rows
 * written after it use `input`. Both the rebuilder here and the training-data
 * exporter go through this one function so a future SDK rename is a single edit
 * rather than a silent mismatch between what is written and what is read back.
 */
export function toolCallPayload(part: ToolCallPayloadCarrier | null | undefined): unknown {
  return part?.input ?? part?.args;
}

/** Structural view of an SDK step; kept loose because vLLM can emit partials. */
interface RawToolCall extends ToolCallPayloadCarrier {
  toolCallId?: string;
  toolName?: string;
}

interface RawToolResult {
  toolCallId?: string;
  toolName?: string;
  /** Current AI SDK v7 key. */
  output?: unknown;
  /** Pre-v7 key, still seen on replayed/legacy step objects. */
  result?: unknown;
}

export interface RawAgentStep {
  text?: string;
  toolCalls?: RawToolCall[];
  toolResults?: RawToolResult[];
}

/**
 * Convert initial messages + SDK step results into a CoreMessage[] array
 * suitable for passing to the next streamText/generateText call as conversation
 * history.
 *
 * The content arrays are typed against the SDK's own content-part interfaces so
 * a field rename in a future SDK version fails at compile time rather than at
 * runtime inside the prompt validator.
 *
 * Malformed parts are dropped rather than replayed — the SDK's prompt validator
 * rejects the whole request over one bad part, which would cost the entire run.
 * Every drop is logged, because a silent one looks identical to a step the model
 * never took.
 */
export function stepsToMessages(
  initialMessages: CoreMessage[],
  steps: RawAgentStep[],
): CoreMessage[] {
  const history = [...initialMessages];
  for (const step of steps) {
    // Assistant message: text + tool calls
    const assistantContent: Array<TextPart | ToolCallPart> = [];
    if (step.text) {
      assistantContent.push({ type: "text", text: step.text });
    }
    if (step.toolCalls && Array.isArray(step.toolCalls)) {
      for (const tc of step.toolCalls) {
        // Sanitize: vLLM can produce calls with no id or name at all
        if (!tc.toolCallId || !tc.toolName) {
          logger.warn(
            { toolCallId: tc.toolCallId, toolName: tc.toolName },
            "dropping malformed tool call from replayed history — missing id or name",
          );
          continue;
        }
        assistantContent.push({
          type: "tool-call",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: toolCallPayload(tc) ?? {},
        });
      }
    }
    if (assistantContent.length > 0) {
      history.push({ role: "assistant", content: assistantContent });
    }
    // Tool results
    if (step.toolResults && Array.isArray(step.toolResults)) {
      const toolContent: ToolResultPart[] = [];
      for (const tr of step.toolResults) {
        if (!tr.toolCallId) {
          logger.warn(
            { toolName: tr.toolName },
            "dropping malformed tool result from replayed history — missing toolCallId",
          );
          continue;
        }
        if (!tr.toolName) {
          logger.warn(
            { toolCallId: tr.toolCallId },
            "replayed tool result has no toolName — substituting \"unknown\"",
          );
        }
        // `output` is the current AI SDK v7 key; `result` was its pre-v7 name and
        // is read only so legacy/replayed step objects still carry their text
        // through. Live v7 steps never set `result`, so the order is inert today.
        const rawOutput = tr.output ?? tr.result ?? "";
        const textValue = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput);
        toolContent.push({
          type: "tool-result",
          toolCallId: tr.toolCallId,
          toolName: tr.toolName ?? "unknown",
          output: { type: "text", value: textValue },
        });
      }
      if (toolContent.length > 0) {
        history.push({ role: "tool", content: toolContent });
      }
    }
  }
  return history;
}
