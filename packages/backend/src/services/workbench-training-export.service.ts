/**
 * Workbench Training Data Export
 *
 * Exports training data in JSONL format for fine-tuning:
 *
 * 1. Agent tool-use — full multi-turn trajectories in OpenAI function-calling format
 * 2. Spec generation — prompt → structured spec (single-turn)
 * 3. Spec enrichment — rough spec + research → enriched spec (single-turn)
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { currentInstrumentId } from "./visual-eval-instrument-id.service.js";
import { admittedWhere } from "./training-export/admission.js";
import { buildMinimalSystemPrompt } from "./training-export/minimal-system-prompt.js";
import { toolCallPayload, type ToolCallPayloadCarrier } from "../utils/agent-history.js";

const logger = createLogger("training-export");

// The agent's tool definitions live beside the other export pieces; re-exported
// so the routes and the synthetic exporter keep their import.
import { getAgentToolDefinitions } from "./training-export/agent-tool-definitions.js";
export { getAgentToolDefinitions };

// ── Types ──────────────────────────────────────────────────────────────

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface TrainingExportOptions {
  minScore?: number;
  categoryId?: string;
  approvalOnly?: boolean;
}

// ── Conversation Converter ──────────────────────────────────────────────

/**
 * Serialize a stored tool-call part's payload to an OpenAI `function.arguments`
 * string.
 *
 * `"{}"` is the honest answer for a genuinely no-argument call such as
 * `validate_and_render({})`, so it is returned without complaint; the failure
 * this guards against is reading the wrong key, which toolCallPayload() owns.
 */
function toolCallArguments(part: ToolCallPayloadCarrier): string {
  const payload = toolCallPayload(part);
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload ?? {});
}

/**
 * Convert a stored Vercel AI SDK CoreMessage[] into OpenAI function-calling format.
 *
 * Vercel format:
 *   assistant.content = [{type:"text",text}, {type:"tool-call",toolCallId,toolName,input}]
 *   tool.content      = [{type:"tool-result",toolCallId,toolName,output:{type:"text",value}}]
 *
 * Rows persisted before the AI SDK v7 `args` -> `input` rename carry the
 * tool-call payload under `args` instead; both shapes are read, via
 * toolCallPayload(). Dropping the legacy key would silently export
 * `arguments: "{}"` for every historical row.
 *
 * OpenAI format:
 *   assistant = {role:"assistant", content:"text", tool_calls:[{id,type,function:{name,arguments}}]}
 *   tool      = {role:"tool", tool_call_id:"id", content:"result text"} (one per tool result)
 */
export function convertAgentConversation(
  agentConversation: unknown,
  systemPrompt: string,
): OpenAIMessage[] {
  if (!Array.isArray(agentConversation)) return [];

  const messages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of agentConversation) {
    if (!msg || typeof msg !== "object" || !("role" in msg)) continue;

    if (msg.role === "user") {
      messages.push({
        role: "user",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      });
    } else if (msg.role === "assistant") {
      const parts = Array.isArray(msg.content) ? msg.content : [];
      const textParts = parts.filter((p: any) => p?.type === "text").map((p: any) => p.text);
      const toolCalls = parts.filter((p: any) => p?.type === "tool-call").map((p: any) => ({
        id: p.toolCallId,
        type: "function" as const,
        function: {
          name: p.toolName,
          arguments: toolCallArguments(p),
        },
      }));

      const assistantMsg: OpenAIMessage = { role: "assistant" };
      const textContent = textParts.join("\n");
      if (textContent) assistantMsg.content = textContent;
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      messages.push(assistantMsg);
    } else if (msg.role === "tool") {
      const results = Array.isArray(msg.content) ? msg.content : [];
      for (const tr of results) {
        if (!tr || tr.type !== "tool-result") continue;
        const outputValue = tr.output?.value
          ?? (typeof tr.output === "string" ? tr.output : JSON.stringify(tr.output ?? ""));
        messages.push({
          role: "tool",
          tool_call_id: tr.toolCallId,
          content: typeof outputValue === "string" ? outputValue : JSON.stringify(outputValue),
        });
      }
    }
  }

  return messages;
}

// ── Main Export ─────────────────────────────────────────────────────────

export async function exportAgentTrainingJsonl(
  options?: TrainingExportOptions,
): Promise<string> {
  const { minScore, categoryId, approvalOnly = true } = options ?? {};

  const where: Record<string, unknown> = {
    agentConversation: { not: null },
    agentSystemPrompt: { not: null },
    renderStatus: "success",
    experimentRunId: null,
  };
  let instrumentId: string | null = null;
  if (approvalOnly) {
    // A human's verdict, or a judge's under the current instrument by a
    // qualified judge (ADR 0003, ADR 0004); Stale and Provisional rows wait.
    instrumentId = await currentInstrumentId();
    Object.assign(where, admittedWhere(instrumentId));
  }
  if (minScore != null) {
    where.evalScore = { gte: minScore };
  }
  if (categoryId) {
    where.promptRef = { categoryId };
  }

  const rows = await prisma.workbenchExample.findMany({
    where,
    select: {
      code: true,
      agentConversation: true,
    },
    orderBy: [
      { promptRef: { categoryId: "asc" } },
      { promptRef: { index: "asc" } },
      { evalScore: "desc" },
    ],
  });

  const tools = getAgentToolDefinitions();
  const lines: string[] = [];

  for (const row of rows) {
    const minimalSystemPrompt = buildMinimalSystemPrompt(row.code, "trajectory");
    const messages = convertAgentConversation(row.agentConversation, minimalSystemPrompt);
    if (messages.length <= 1) continue; // system-only = no real conversation

    lines.push(JSON.stringify({ task_type: "agent_codegen", tools, messages }));
  }

  logger.info(
    { totalRows: rows.length, exportedLines: lines.length, minScore, categoryId, approvalOnly, instrumentId },
    "agent training JSONL export completed",
  );

  return lines.join("\n");
}

// ── Spec Generation Export ─────────────────────────────────────────────

/**
 * Export spec-generation training data: prompt → structured spec JSON.
 * Each line is a single-turn conversation (system + user prompt → assistant spec response).
 */
export async function exportSpecGenTrainingJsonl(
  options?: TrainingExportOptions,
): Promise<string> {
  const { categoryId } = options ?? {};

  const where: Record<string, unknown> = {
    specRawResponse: { not: null },
    specSystemPrompt: { not: null },
  };
  if (categoryId) where.categoryId = categoryId;

  const rows = await prisma.workbenchExamplePrompt.findMany({
    where,
    select: {
      prompt: true,
      specRawResponse: true,
      specSystemPrompt: true,
    },
    orderBy: [{ categoryId: "asc" }, { index: "asc" }],
  });

  const lines: string[] = [];
  for (const row of rows) {
    lines.push(JSON.stringify({
      task_type: "spec_generation",
      messages: [
        { role: "system", content: row.specSystemPrompt },
        { role: "user", content: row.prompt },
        { role: "assistant", content: row.specRawResponse },
      ],
    }));
  }

  logger.info({ totalRows: rows.length, exportedLines: lines.length }, "spec-gen training JSONL export completed");
  return lines.join("\n");
}

// ── Spec Enrichment Export ──────────────────────────────────────────────

/**
 * Export spec-enrichment training data: rough spec + research → enriched spec.
 * Each line is a single-turn conversation (system + user message → assistant enriched spec).
 */
export async function exportSpecEnrichmentTrainingJsonl(
  options?: TrainingExportOptions,
): Promise<string> {
  const { categoryId } = options ?? {};

  const where: Record<string, unknown> = {
    enrichmentRawResponse: { not: null },
    enrichmentSystemPrompt: { not: null },
    enrichmentUserMessage: { not: null },
  };
  if (categoryId) where.categoryId = categoryId;

  const rows = await prisma.workbenchExamplePrompt.findMany({
    where,
    select: {
      enrichmentRawResponse: true,
      enrichmentSystemPrompt: true,
      enrichmentUserMessage: true,
    },
    orderBy: [{ categoryId: "asc" }, { index: "asc" }],
  });

  const lines: string[] = [];
  for (const row of rows) {
    lines.push(JSON.stringify({
      task_type: "spec_enrichment",
      messages: [
        { role: "system", content: row.enrichmentSystemPrompt },
        { role: "user", content: row.enrichmentUserMessage },
        { role: "assistant", content: row.enrichmentRawResponse },
      ],
    }));
  }

  logger.info({ totalRows: rows.length, exportedLines: lines.length }, "spec-enrichment training JSONL export completed");
  return lines.join("\n");
}

// ── Combined Multi-Task Export ──────────────────────────────────────────

/**
 * Export all training data in a single JSONL file.
 * Each line has a `task_type` field so downstream can identify/filter tasks.
 * Useful for multi-task fine-tuning (one model learns all pipeline stages).
 */
export async function exportCombinedTrainingJsonl(
  options?: TrainingExportOptions,
): Promise<string> {
  const [agent, specGen, specEnrich] = await Promise.all([
    exportAgentTrainingJsonl(options),
    exportSpecGenTrainingJsonl(options),
    exportSpecEnrichmentTrainingJsonl(options),
  ]);

  const parts = [agent, specGen, specEnrich].filter(Boolean);
  const combined = parts.join("\n");

  const lineCount = combined ? combined.split("\n").length : 0;
  logger.info({ lineCount }, "combined multi-task training JSONL export completed");
  return combined;
}
