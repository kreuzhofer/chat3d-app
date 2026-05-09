/**
 * Workbench Training Data Export
 *
 * Exports training data in JSONL format for fine-tuning:
 *
 * 1. Agent tool-use — full multi-turn trajectories in OpenAI function-calling format
 * 2. Spec generation — prompt → structured spec (single-turn)
 * 3. Spec enrichment — rough spec + research → enriched spec (single-turn)
 */

import { zodSchema } from "ai";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { buildMinimalSystemPrompt } from "./training-export/minimal-system-prompt.js";

const logger = createLogger("training-export");

// ── Types ──────────────────────────────────────────────────────────────

interface OpenAIToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

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

interface TrainingExampleMetadata {
  example_id: string;
  prompt_id: string;
  category: string;
  eval_score: number | null;
  visual_score: number | null;
  code_score: number | null;
  assertion_pass_rate: number | null;
  approval_status: string;
  llm_model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

export interface TrainingExportOptions {
  minScore?: number;
  categoryId?: string;
  approvalOnly?: boolean;
}

// ── Tool Definitions ────────────────────────────────────────────────────
// Mirrors the Zod schemas from agent-tools.service.ts, without execute fns.

function buildToolDef(name: string, description: string, schema: z.ZodObject<any>): OpenAIToolDef {
  const jsonSch = zodSchema(schema).jsonSchema;
  return { type: "function", function: { name, description, parameters: jsonSch } };
}

export function getAgentToolDefinitions(): OpenAIToolDef[] {
  return [
    buildToolDef(
      "text_editor",
      `A text editor for viewing and editing Python files in the project directory.

Commands:
- view: View file contents with line numbers. Optionally specify view_range as [startLine, endLine].
- create: Create a new file with the given content. Fails if the file already exists — use str_replace to edit.
- str_replace: Replace exactly one occurrence of old_str with new_str in the file. The old_str must match exactly one location; include enough surrounding context to make it unique.
- insert: Insert new text after the specified line number. Use insert_line=0 to prepend.
- overwrite: Replace entire contents of an existing file. Prefer str_replace for targeted edits.

All paths are relative (e.g., "main.py", "components/base.py"). Only .py files are allowed.
Always view a file before editing it to see the current line numbers and content.`,
      z.object({
        command: z.enum(["view", "create", "str_replace", "insert", "overwrite"]).describe("The editor command to execute"),
        path: z.string().describe("Relative file path (e.g., 'main.py')"),
        file_text: z.string().optional().describe("Full file content for 'create' or 'overwrite' command"),
        old_str: z.string().optional().describe("Exact string to find for 'str_replace' — must match exactly one location"),
        new_str: z.string().optional().describe("Replacement string for 'str_replace', or text to insert for 'insert'"),
        view_range: z.array(z.number()).length(2).optional().describe("[startLine, endLine] to view a specific range (1-indexed)"),
        insert_line: z.number().optional().describe("Line number to insert after (0 = prepend) for 'insert' command"),
      }),
    ),
    buildToolDef(
      "validate_code",
      "Validate your Build123d code for syntax errors and common mistakes. This is fast and free — always validate before rendering. Validates all files in the project.",
      z.object({}),
    ),
    buildToolDef(
      "render_project",
      "Render the project to produce 3D model files (STEP, STL, 3MF). This is expensive — only call after validation passes. Executes main.py as the entry point.",
      z.object({}),
    ),
    buildToolDef(
      "validate_and_render",
      "Validate and render in one step. Validates first; if validation passes, renders immediately. Use this when you're confident the code is ready. Saves a round-trip compared to calling validate_code then render_project separately.",
      z.object({}),
    ),
    buildToolDef(
      "evaluate_model",
      "Evaluate the rendered 3D model against the user's prompt using a vision model (VLM). Takes screenshots and scores the model 1-10. Only call after a successful render. Use this to check quality before submitting — submit_result also runs evaluation automatically.",
      z.object({}),
    ),
    buildToolDef(
      "evaluate_code",
      "Review your code for correctness against the user's prompt. Runs two checks: (1) Assertion check — verifies numeric parameters (dimensions, counts) match the spec (free, instant). (2) Code review — an LLM reviews the code for parameter accuracy, feature completeness, and logical correctness (cheap, ~5s). Call this BEFORE rendering to catch dimensional errors early. You do NOT need a rendered model for this.",
      z.object({}),
    ),
    buildToolDef(
      "submit_result",
      "Submit your result after a successful render. Automatically runs a visual evaluation (VLM) to check quality. If the score is below the acceptance threshold, the submission is REJECTED and you must address the issues before re-submitting.",
      z.object({
        summary: z.string().describe("Brief summary of what was built or changed"),
      }),
    ),
    buildToolDef(
      "list_files",
      "List files in the project with line counts. Cheaper than viewing each file individually.",
      z.object({
        directory: z.string().optional().describe("Optional directory to filter by (e.g., 'components')"),
      }),
    ),
    buildToolDef(
      "search_examples",
      "Search the workbench for similar Build123d examples. Use this to see how similar models are built. Returns up to 3 examples with their prompt and code.",
      z.object({
        query: z.string().describe("Natural language description of what you're looking for (e.g., 'gear with rounded teeth', 'box with lid')"),
      }),
    ),
    buildToolDef(
      "search_knowledge",
      "Search the Build123d external knowledge base (official docs, repo examples, test patterns, and reference material like specs and dimensions) for working code snippets or technical reference related to a technique or concept. Use when you need to see how a specific API or pattern works, or when you need dimensions/specifications for components.",
      z.object({
        query: z.string().describe("Natural language description of what you want to find (e.g., 'how to create a helix sweep', 'loft between two sketches')"),
      }),
    ),
    buildToolDef(
      "lookup_api",
      "Look up Build123d API reference documentation for a specific topic. Available topics: primitives_3d, primitives_2d, sketch_ops, operations_3d, boolean, positioning, edge_face_selection, fillets_chamfers, offset_shell, arrays_patterns, build_contexts, buildline, sweep, loft, sketch_on_face, revolve, parametric_math",
      z.object({
        topic: z.string().describe("The API topic to look up (e.g., 'sweep', 'boolean', 'fillets_chamfers')"),
      }),
    ),
  ];
}

// ── Conversation Converter ──────────────────────────────────────────────

/**
 * Convert a stored Vercel AI SDK CoreMessage[] into OpenAI function-calling format.
 *
 * Vercel format:
 *   assistant.content = [{type:"text",text}, {type:"tool-call",toolCallId,toolName,args}]
 *   tool.content      = [{type:"tool-result",toolCallId,toolName,output:{type:"text",value}}]
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
          arguments: typeof p.args === "string" ? p.args : JSON.stringify(p.args ?? {}),
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
  if (approvalOnly) {
    where.approvalStatus = { in: ["auto_approved", "human_approved"] };
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
      promptId: true,
      code: true,
      agentConversation: true,
      agentSystemPrompt: true,
      evalScore: true,
      visualScore: true,
      codeEvalScore: true,
      assertionPassRate: true,
      approvalStatus: true,
      llmModel: true,
      promptTokens: true,
      completionTokens: true,
      promptRef: {
        select: {
          prompt: true,
          category: { select: { name: true } },
        },
      },
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

    const metadata: TrainingExampleMetadata = {
      example_id: row.id,
      prompt_id: row.promptId,
      category: row.promptRef.category.name,
      eval_score: row.evalScore ? Number(row.evalScore) : null,
      visual_score: row.visualScore ? Number(row.visualScore) : null,
      code_score: row.codeEvalScore ? Number(row.codeEvalScore) : null,
      assertion_pass_rate: row.assertionPassRate ? Number(row.assertionPassRate) : null,
      approval_status: row.approvalStatus,
      llm_model: row.llmModel,
      prompt_tokens: row.promptTokens,
      completion_tokens: row.completionTokens,
    };

    lines.push(JSON.stringify({ task_type: "agent_codegen", tools, messages, metadata }));
  }

  logger.info(
    { totalRows: rows.length, exportedLines: lines.length, minScore, categoryId, approvalOnly },
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
      id: true,
      prompt: true,
      specRawResponse: true,
      specSystemPrompt: true,
      specInterpretation: true,
      constructionSpec: true,
      codeAssertions: true,
      verificationChecklist: true,
      verificationCriteria: true,
      category: { select: { name: true } },
    },
    orderBy: [{ categoryId: "asc" }, { index: "asc" }],
  });

  const lines: string[] = [];
  for (const row of rows) {
    // Find best eval score among approved examples for this prompt (quality signal)
    const bestExample = await prisma.workbenchExample.findFirst({
      where: {
        promptId: row.id,
        approvalStatus: { in: ["auto_approved", "human_approved"] },
        renderStatus: "success",
        experimentRunId: null,
      },
      select: { evalScore: true },
      orderBy: { evalScore: "desc" },
    });

    lines.push(JSON.stringify({
      task_type: "spec_generation",
      messages: [
        { role: "system", content: row.specSystemPrompt },
        { role: "user", content: row.prompt },
        { role: "assistant", content: row.specRawResponse },
      ],
      metadata: {
        prompt_id: row.id,
        category: row.category.name,
        has_construction_spec: !!row.constructionSpec,
        has_assertions: Array.isArray(row.codeAssertions) && (row.codeAssertions as unknown[]).length > 0,
        downstream_eval_score: bestExample?.evalScore ? Number(bestExample.evalScore) : null,
      },
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
      id: true,
      prompt: true,
      enrichmentRawResponse: true,
      enrichmentSystemPrompt: true,
      enrichmentUserMessage: true,
      category: { select: { name: true } },
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
      metadata: {
        prompt_id: row.id,
        category: row.category.name,
      },
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
