/**
 * Extracts the last render-tool failure from an agent conversation history
 * and classifies it via render-errors.ts.
 *
 * The agent's `validate_and_render` and `render_project` tools return strings
 * like:
 *   "Render FAILED.\n\nError: <raw build123d error>\n\nPlease fix the code..."
 * This helper finds the most recent such message, parses the raw error, and
 * runs classifyRenderError() over it.
 *
 * Used at:
 * 1. workbench persistence time (workbench-codegen.service.ts:~800)
 * 2. the backfill script (scripts/backfill-render-errors.ts)
 *
 * Returns null when:
 *   - the conversation has no tool messages
 *   - the last render-tool message indicates success
 *   - the conversation shape is unrecognized
 */
import {
  classifyRenderError,
  type ClassifiedRenderError,
} from "./render-errors.js";

const RENDER_TOOL_NAMES = new Set(["validate_and_render", "render_project"]);
const FAIL_MARKER = "Render FAILED";
const ERROR_PREFIX_RE = /Error:\s*([\s\S]*?)(?:\n\nPlease fix|\n\nThis means|\n\nThis is a service|$)/;

interface ToolResultContent {
  type: string;
  toolName?: string;
  output?: unknown;
}

interface ConvoMessage {
  role?: string;
  content?: unknown;
}

function isToolResultContent(x: unknown): x is ToolResultContent {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as { type?: unknown }).type === "tool-result"
  );
}

function extractToolOutputString(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const text = output
      .map(part => (typeof part === "object" && part !== null && "text" in part ? (part as { text?: unknown }).text : null))
      .filter((t): t is string => typeof t === "string")
      .join("\n");
    return text || null;
  }
  if (typeof output === "object" && output !== null && "text" in output) {
    const text = (output as { text?: unknown }).text;
    return typeof text === "string" ? text : null;
  }
  return null;
}

export function extractAndClassifyLastRenderError(
  agentConversation: unknown,
): ClassifiedRenderError | null {
  if (!Array.isArray(agentConversation)) return null;

  // Walk newest-first; the last render-tool result is the one we want.
  for (let i = agentConversation.length - 1; i >= 0; i--) {
    const msg = agentConversation[i] as ConvoMessage;
    if (!msg || typeof msg !== "object") continue;
    if (msg.role !== "tool") continue;

    const contents = Array.isArray(msg.content) ? msg.content : [msg.content];
    for (const part of contents) {
      if (!isToolResultContent(part)) continue;
      if (!part.toolName || !RENDER_TOOL_NAMES.has(part.toolName)) continue;

      const outputText = extractToolOutputString(part.output);
      if (!outputText) continue;

      // Success case → no error to classify
      if (!outputText.includes(FAIL_MARKER)) return null;

      // Extract raw error message between "Error: " and the next blank line.
      const match = outputText.match(ERROR_PREFIX_RE);
      const rawMessage = match ? match[1].trim() : outputText;
      return classifyRenderError(rawMessage);
    }
  }

  return null;
}
