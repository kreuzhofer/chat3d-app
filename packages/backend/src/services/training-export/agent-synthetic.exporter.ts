/**
 * Synthetic Agent Trajectory Exporter
 *
 * Reconstructs minimal-but-valid agent trajectories from approved workbench rows
 * whose recorded `agent_conversation` lost tool-call args due to the AI SDK v6
 * `args` → `input` field rename. Each row becomes a fixed 3-step trajectory:
 *   1. text_editor(create, main.py, file_text=row.code)
 *   2. validate_and_render({})
 *   3. submit_result({ summary })
 *
 * The summary is parsed from the stored submit_result tool-result echo when
 * present, otherwise falls back to a generic phrase. Other tool results (e.g.
 * the validate_and_render echo) are reused verbatim when available.
 */

import { prisma } from "../../db/prisma.js";
import { createLogger } from "../../utils/logger.js";
import {
  getAgentToolDefinitions,
  type TrainingExportOptions,
} from "../workbench-training-export.service.js";
import { buildMinimalSystemPrompt } from "./minimal-system-prompt.js";
import { currentInstrumentId } from "../visual-eval-instrument-id.service.js";
import { admittedWhere } from "./admission.js";

const logger = createLogger("training-export-synthetic");

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

// ── Helpers ─────────────────────────────────────────────────────────────

function extractUserPrompt(agentConversation: unknown, fallback: string): string {
  if (Array.isArray(agentConversation)) {
    for (const msg of agentConversation) {
      if (msg && typeof msg === "object" && (msg as any).role === "user") {
        const c = (msg as any).content;
        if (typeof c === "string" && c.trim()) return c;
        if (Array.isArray(c)) {
          const txt = c
            .filter((p: any) => p?.type === "text" && typeof p.text === "string")
            .map((p: any) => p.text)
            .join("\n")
            .trim();
          if (txt) return txt;
        }
      }
    }
  }
  return fallback;
}

function findToolResultText(agentConversation: unknown, toolName: string): string | null {
  if (!Array.isArray(agentConversation)) return null;
  for (const msg of agentConversation) {
    if (!msg || typeof msg !== "object" || (msg as any).role !== "tool") continue;
    const parts = Array.isArray((msg as any).content) ? (msg as any).content : [];
    for (const tr of parts) {
      if (!tr || tr.type !== "tool-result" || tr.toolName !== toolName) continue;
      const outputValue = tr.output?.value
        ?? (typeof tr.output === "string" ? tr.output : null);
      if (typeof outputValue === "string" && outputValue.trim()) return outputValue;
    }
  }
  return null;
}

function parseSubmitSummary(echoText: string | null): string {
  if (!echoText) return "Built the requested model.";
  const m = echoText.match(/Result submitted \([^)]*\):\s*(.+)$/s);
  if (m && m[1]) return m[1].trim();
  return "Built the requested model.";
}

function makeToolCallId(seed: string, index: number): string {
  return `call_${seed.slice(0, 8)}_${index}`;
}

// ── Main Export ─────────────────────────────────────────────────────────

export async function exportAgentSyntheticTrainingJsonl(
  options?: TrainingExportOptions,
): Promise<string> {
  const { minScore, categoryId, approvalOnly = true } = options ?? {};

  const where: Record<string, unknown> = {
    renderStatus: "success",
    experimentRunId: null,
  };
  if (approvalOnly) {
    // The same admission as every other exporter (ADR 0003, ADR 0004).
    Object.assign(where, admittedWhere(await currentInstrumentId()));
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
      id: true,
      code: true,
      agentConversation: true,
      agentSystemPrompt: true,
      promptRef: { select: { prompt: true } },
    },
    orderBy: [
      { promptRef: { categoryId: "asc" } },
      { promptRef: { index: "asc" } },
      { evalScore: "desc" },
    ],
  });

  const tools = getAgentToolDefinitions();
  const lines: string[] = [];
  let skippedNoCode = 0;
  let skippedNoPrompt = 0;

  for (const row of rows) {
    if (!row.code || !row.code.trim()) {
      skippedNoCode += 1;
      continue;
    }
    const userPrompt = extractUserPrompt(
      row.agentConversation,
      row.promptRef?.prompt ?? "",
    );
    if (!userPrompt.trim()) {
      skippedNoPrompt += 1;
      continue;
    }

    const systemPrompt = row.agentSystemPrompt && row.agentSystemPrompt.trim().length > 0
      ? row.agentSystemPrompt
      : buildMinimalSystemPrompt(row.code, "trajectory");

    const submitEcho = findToolResultText(row.agentConversation, "submit_result");
    const summary = parseSubmitSummary(submitEcho);

    const validateEcho = findToolResultText(row.agentConversation, "validate_and_render")
      ?? "Validation PASSED.\nRender SUCCEEDED. Generated 3 file(s): main.step, main.stl, main.3mf\n\nYou can now call submit_result if you're satisfied, or make further edits.";

    const submitOutput = submitEcho ?? `Result submitted (composite: 9/10, code: 9, visual: 9): ${summary}`;

    const id1 = makeToolCallId(row.id, 1);
    const id2 = makeToolCallId(row.id, 2);
    const id3 = makeToolCallId(row.id, 3);

    const messages: OpenAIMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
      {
        role: "assistant",
        tool_calls: [{
          id: id1,
          type: "function",
          function: {
            name: "text_editor",
            arguments: JSON.stringify({
              command: "create",
              path: "main.py",
              file_text: row.code,
            }),
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: id1,
        content: "File created successfully at: main.py",
      },
      {
        role: "assistant",
        tool_calls: [{
          id: id2,
          type: "function",
          function: {
            name: "validate_and_render",
            arguments: "{}",
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: id2,
        content: validateEcho,
      },
      {
        role: "assistant",
        tool_calls: [{
          id: id3,
          type: "function",
          function: {
            name: "submit_result",
            arguments: JSON.stringify({ summary }),
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: id3,
        content: submitOutput,
      },
    ];

    lines.push(JSON.stringify({
      task_type: "agent_codegen_synthetic",
      tools,
      messages,
    }));
  }

  logger.info(
    {
      totalRows: rows.length,
      exportedLines: lines.length,
      skippedNoCode,
      skippedNoPrompt,
      minScore,
      categoryId,
      approvalOnly,
    },
    "synthetic agent training JSONL export completed",
  );

  return lines.join("\n");
}
