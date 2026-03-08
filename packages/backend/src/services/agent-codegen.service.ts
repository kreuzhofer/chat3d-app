/**
 * Agent-based codegen loop (Phase 6).
 *
 * Uses Anthropic's text_editor_20250728 built-in tool plus custom Build123d
 * tools (validate_code, render_project, search_examples, lookup_api, submit_result)
 * in a multi-step tool-use loop via Vercel AI SDK's generateText with stopWhen.
 *
 * The agent operates on an in-memory virtual filesystem (AgentFilesystem) to
 * avoid disk I/O during the loop. Results are returned for the caller
 * (query.service.ts) to persist to storage.
 */

import { generateText, stepCountIs, hasToolCall, zodSchema } from "ai";
import { z } from "zod";
import { createLogger } from "../utils/logger.js";
import { AgentFilesystem } from "./agent-filesystem.service.js";
import { searchKnowledge } from "./knowledge.service.js";
import {
  renderBuild123dProject,
  validateBuild123dProject,
  type ProjectFile,
  type RenderedFile,
  RenderingServiceError,
} from "./rendering.service.js";
import { findSimilarExamples } from "./workbench-embeddings.service.js";
import {
  CODEGEN_SECTION_3D_PRIMITIVES,
  CODEGEN_SECTION_2D_SKETCH,
  CODEGEN_SECTION_SKETCH_OPS,
  CODEGEN_SECTION_3D_OPS,
  CODEGEN_SECTION_BOOLEAN,
  CODEGEN_SECTION_POSITIONING,
  CODEGEN_SECTION_EDGE_FACE,
  CODEGEN_SECTION_FILLETS,
  CODEGEN_SECTION_OFFSET_SHELL,
  CODEGEN_SECTION_ARRAYS,
  CODEGEN_SECTION_BUILD_CONTEXTS,
  CODEGEN_SECTION_BUILDLINE,
  CODEGEN_SECTION_SWEEP,
  CODEGEN_SECTION_LOFT,
  CODEGEN_SECTION_SKETCH_ON_FACE,
  CODEGEN_SECTION_REVOLVE,
  CODEGEN_SECTION_PARAMETRIC,
} from "../prompts/system-prompts.js";
import {
  createAnthropicProviderForAgent,
  buildGenerateOptions,
  calculateCostUsd,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { wrapInTemplate } from "./workbench-codegen.service.js";
import { buildAgentSystemPrompt, buildFullAgentSystemPrompt } from "../prompts/agent-system-prompt.js";

const logger = createLogger("agent-codegen");

// ── Types ──────────────────────────────────────────────────────────────

export interface AgentCodegenInput {
  promptText: string;
  interpretation?: string;
  isModification: boolean;
  baselineCode?: string;
  baseFileName: string;
  maxSteps: number;
  modelConfig: LlmModelConfig;
  /** Complexity from spec generation */
  complexity?: "simple" | "medium" | "complex";
  signal?: AbortSignal;
  /** Callback for progress updates */
  onProgress?: (state: string, detail: string) => void;
}

export interface AgentCodegenResult {
  /** Final code from main.py */
  code: string;
  /** All project files (for multi-file projects) */
  files: Array<{ path: string; content: string }>;
  /** Rendered output files (STEP, STL, 3MF) */
  renderedFiles: RenderedFile[];
  /** Whether render succeeded */
  renderSuccess: boolean;
  /** Token usage */
  usage: {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalCostUsd: number;
  };
  /** Number of agent steps taken */
  stepCount: number;
  /** Whether the agent explicitly submitted (vs hitting step limit) */
  submitted: boolean;
}

// ── API Reference Lookup ───────────────────────────────────────────────

const API_SECTIONS: Record<string, string> = {
  primitives_3d: CODEGEN_SECTION_3D_PRIMITIVES,
  primitives_2d: CODEGEN_SECTION_2D_SKETCH,
  sketch_ops: CODEGEN_SECTION_SKETCH_OPS,
  operations_3d: CODEGEN_SECTION_3D_OPS,
  boolean: CODEGEN_SECTION_BOOLEAN,
  positioning: CODEGEN_SECTION_POSITIONING,
  edge_face_selection: CODEGEN_SECTION_EDGE_FACE,
  fillets_chamfers: CODEGEN_SECTION_FILLETS,
  offset_shell: CODEGEN_SECTION_OFFSET_SHELL,
  arrays_patterns: CODEGEN_SECTION_ARRAYS,
  build_contexts: CODEGEN_SECTION_BUILD_CONTEXTS,
  buildline: CODEGEN_SECTION_BUILDLINE,
  sweep: CODEGEN_SECTION_SWEEP,
  loft: CODEGEN_SECTION_LOFT,
  sketch_on_face: CODEGEN_SECTION_SKETCH_ON_FACE,
  revolve: CODEGEN_SECTION_REVOLVE,
  parametric_math: CODEGEN_SECTION_PARAMETRIC,
};

// ── Main agent loop ────────────────────────────────────────────────────

export async function runAgentCodegen(input: AgentCodegenInput): Promise<AgentCodegenResult> {
  const {
    promptText,
    interpretation,
    isModification,
    baselineCode,
    baseFileName,
    maxSteps,
    modelConfig,
    complexity,
    signal,
    onProgress,
  } = input;

  logger.info(
    { prompt: promptText.slice(0, 80), isModification, maxSteps, model: modelConfig.label, complexity },
    "starting agent codegen loop",
  );

  // Initialize virtual filesystem
  const fs = new AgentFilesystem();
  if (isModification && baselineCode) {
    fs.initFromCode(baselineCode);
  }

  // Build system prompt
  const useFullPrompt = complexity === "complex";
  const systemPrompt = useFullPrompt
    ? buildFullAgentSystemPrompt({ isModification })
    : buildAgentSystemPrompt({ promptText, interpretation, isModification });

  // Create Anthropic provider for text_editor tool
  const anthropicProvider = createAnthropicProviderForAgent(modelConfig);
  const model = anthropicProvider(modelConfig.modelName);

  // Build extra options (thinking, etc.)
  const extraOpts = buildGenerateOptions(modelConfig);

  // Track state for submit_result tool
  let submitted = false;
  let lastRenderedFiles: RenderedFile[] = [];
  let renderSuccess = false;

  // Usage tracking
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalReasoningTokens = 0;

  // Build initial user message
  const userMessage = buildAgentUserMessage(promptText, isModification, baselineCode);

  // Define custom Build123d tools.
  // The tool() helper has strict type inference that conflicts with our async execute
  // functions. We define tools as plain objects matching the Tool type, which is
  // equivalent at runtime and avoids the overload mismatch.
  const customTools = {
    validate_code: {
      type: "function" as const,
      description: "Validate your Build123d code for syntax errors and common mistakes. This is fast and free — always validate before rendering. Validates all files in the project.",
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const files = fs.getFiles();
        if (files.length === 0) {
          return "ERROR: No files in the project. Create main.py first.";
        }

        const projectFiles: ProjectFile[] = files.map(f => ({
          path: f.path,
          content: wrapInTemplate(f.content, baseFileName),
        }));

        onProgress?.("validating", "Validating code...");

        try {
          const result = await validateBuild123dProject(projectFiles);
          if (result.valid) {
            const warningText = result.warnings.length > 0
              ? `\n\nWarnings (non-blocking):\n${result.warnings.map(w => `- [${w.rule}] ${w.message} (line ${w.line})`).join("\n")}`
              : "";
            return `Validation PASSED. No errors found.${warningText}`;
          }
          const errorText = result.errors.join("\n");
          const warningText = result.warnings.length > 0
            ? `\n\nWarnings:\n${result.warnings.map(w => `- [${w.rule}] ${w.message} (line ${w.line})`).join("\n")}`
            : "";
          return `Validation FAILED.\n\nErrors:\n${errorText}${warningText}`;
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, "validate_code tool error");
          return `Validation service unavailable: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    render_project: {
      type: "function" as const,
      description: "Render the project to produce 3D model files (STEP, STL, 3MF). This is expensive — only call after validation passes. Executes main.py as the entry point.",
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const files = fs.getFiles();
        if (files.length === 0) {
          return "ERROR: No files in the project. Create main.py first.";
        }
        if (!fs.getMainCode()) {
          return "ERROR: No main.py found. The project must have a main.py as the entry point.";
        }

        const projectFiles: ProjectFile[] = files.map(f => ({
          path: f.path,
          content: wrapInTemplate(f.content, baseFileName),
        }));

        onProgress?.("rendering", "Rendering 3D model...");

        try {
          const result = await renderBuild123dProject(
            { files: projectFiles, baseFileName },
            { signal },
          );
          lastRenderedFiles = result.files;
          renderSuccess = true;
          const fileList = result.files.map(f => f.filename).join(", ");
          return `Render SUCCEEDED. Generated ${result.files.length} file(s): ${fileList}\n\nYou can now call submit_result if you're satisfied, or make further edits.`;
        } catch (err) {
          renderSuccess = false;
          if (err instanceof RenderingServiceError) {
            logger.info({ err: err.message, isInfra: err.isInfrastructure }, "render_project tool: render failed");
            if (err.isInfrastructure) {
              return `Render FAILED (infrastructure error — not a code issue): ${err.message}\n\nThis is a service issue, not a problem with your code. You may try again.`;
            }
            return `Render FAILED.\n\nError: ${err.message}\n\nPlease fix the code and validate again before re-rendering.`;
          }
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn({ err: msg }, "render_project tool: unexpected error");
          return `Render FAILED with unexpected error: ${msg}`;
        }
      },
    },

    search_examples: {
      type: "function" as const,
      description: "Search the workbench for similar Build123d examples. Use this to see how similar models are built. Returns up to 3 examples with their prompt and code.",
      inputSchema: zodSchema(z.object({
        query: z.string().describe("Natural language description of what you're looking for (e.g., 'gear with rounded teeth', 'box with lid')"),
      })),
      execute: async ({ query }: { query: string }) => {
        try {
          const { matches } = await findSimilarExamples(query, 3);
          if (matches.length === 0) {
            return "No similar examples found in the workbench.";
          }
          return matches.map((m, i) =>
            `### Example ${i + 1} (similarity: ${(m.similarity * 100).toFixed(0)}%)\nPrompt: ${m.prompt}\n\nCode:\n\`\`\`python\n${m.code}\n\`\`\``
          ).join("\n\n");
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, "search_examples tool error");
          return "Example search unavailable.";
        }
      },
    },

    lookup_api: {
      type: "function" as const,
      description: "Look up Build123d API reference documentation for a specific topic. Available topics: primitives_3d, primitives_2d, sketch_ops, operations_3d, boolean, positioning, edge_face_selection, fillets_chamfers, offset_shell, arrays_patterns, build_contexts, buildline, sweep, loft, sketch_on_face, revolve, parametric_math",
      inputSchema: zodSchema(z.object({
        topic: z.string().describe("The API topic to look up (e.g., 'sweep', 'boolean', 'fillets_chamfers')"),
      })),
      execute: async ({ topic }: { topic: string }) => {
        const section = API_SECTIONS[topic];
        if (!section) {
          const available = Object.keys(API_SECTIONS).join(", ");
          return `Unknown topic: "${topic}". Available topics: ${available}`;
        }
        return section;
      },
    },

    search_knowledge: {
      type: "function" as const,
      description: "Search the Build123d external knowledge base (official docs, repo examples, test patterns) for working code snippets related to a technique or concept. Use when you need to see how a specific API or pattern works beyond what's in the system prompt.",
      inputSchema: zodSchema(z.object({
        query: z.string().describe("Natural language description of what you want to find (e.g., 'how to create a helix sweep', 'loft between two sketches')"),
      })),
      execute: async ({ query }: { query: string }) => {
        try {
          const { matches } = await searchKnowledge(query, 3);
          if (matches.length === 0) {
            return "No matching knowledge entries found.";
          }
          return matches.map((m, i) =>
            `### Reference ${i + 1}: ${m.title} (${m.sourceType}, ${(m.similarity * 100).toFixed(0)}% match)\n${m.description ? m.description + "\n\n" : ""}\`\`\`python\n${m.code}\n\`\`\`\nSource: ${m.sourceUrl}`
          ).join("\n\n");
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, "search_knowledge tool error");
          return "Knowledge search unavailable.";
        }
      },
    },

    submit_result: {
      type: "function" as const,
      description: "Submit your result when you're satisfied with the rendered output. Call this after a successful render to complete the task.",
      inputSchema: zodSchema(z.object({
        summary: z.string().describe("Brief summary of what was built or changed"),
      })),
      execute: async ({ summary }: { summary: string }) => {
        submitted = true;
        logger.info({ summary }, "agent submitted result");
        return `Result submitted: ${summary}`;
      },
    },
  };

  // Get text_editor tool from Anthropic provider
  const textEditorTool = anthropicProvider.tools.textEditor_20250728({
    execute: async (params) => {
      const { command, path: filePath } = params;

      switch (command) {
        case "view": {
          const viewRange = params.view_range as number[] | undefined;
          return fs.view(filePath, viewRange as [number, number] | undefined);
        }
        case "create": {
          const fileText = params.file_text as string;
          if (!fileText) return "ERROR: file_text is required for create command.";
          return fs.create(filePath, fileText);
        }
        case "str_replace": {
          const oldStr = params.old_str as string;
          const newStr = params.new_str as string;
          if (oldStr === undefined) return "ERROR: old_str is required for str_replace command.";
          if (newStr === undefined) return "ERROR: new_str is required for str_replace command.";
          return fs.strReplace(filePath, oldStr, newStr);
        }
        case "insert": {
          const insertLine = params.insert_line as number;
          const insertText = params.insert_text ?? params.new_str;
          if (insertLine === undefined) return "ERROR: insert_line is required for insert command.";
          if (!insertText) return "ERROR: insert_text (or new_str) is required for insert command.";
          return fs.insert(filePath, insertLine, insertText as string);
        }
        default:
          return `ERROR: Unknown command: ${command}`;
      }
    },
  });

  // Run the agent loop
  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: userMessage,
      tools: {
        ...customTools,
        text_editor: textEditorTool,
      } as Record<string, any>,
      stopWhen: [
        stepCountIs(maxSteps),
        hasToolCall("submit_result"),
      ],
      abortSignal: signal,
      onStepFinish: (event) => {
        const stepNum = event.stepNumber + 1;
        const usage = event.usage;

        // Accumulate usage
        totalPromptTokens += usage?.inputTokens ?? 0;
        totalCompletionTokens += usage?.outputTokens ?? 0;
        // Reasoning tokens from provider metadata
        const providerMeta = event.providerMetadata;
        const anthropicMeta = providerMeta?.anthropic as Record<string, unknown> | undefined;
        const reasoningTokens = (anthropicMeta?.reasoningTokens as number) ?? 0;
        totalReasoningTokens += reasoningTokens;

        // Log tool calls
        const toolNames = event.toolCalls.map(tc => tc.toolName);
        logger.info(
          { step: stepNum, maxSteps, tools: toolNames, usage: { input: usage?.inputTokens, output: usage?.outputTokens, reasoning: reasoningTokens } },
          "agent step completed",
        );

        onProgress?.("agent", `Agent step ${stepNum}/${maxSteps}: ${toolNames.join(", ") || "thinking"}`);
      },
      ...extraOpts,
    });

    const finalCode = fs.getMainCode() ?? "";
    const allFiles = fs.getFiles();
    const stepCount = result.steps.length;

    logger.info(
      {
        stepCount,
        submitted,
        renderSuccess,
        fileCount: allFiles.length,
        codeLength: finalCode.length,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        reasoningTokens: totalReasoningTokens,
      },
      "agent codegen loop completed",
    );

    return {
      code: finalCode,
      files: allFiles,
      renderedFiles: lastRenderedFiles,
      renderSuccess,
      usage: {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        reasoningTokens: totalReasoningTokens,
        totalCostUsd: calculateCostUsd(modelConfig, totalPromptTokens, totalCompletionTokens),
      },
      stepCount,
      submitted,
    };
  } catch (err) {
    // If we got an abort, return whatever we have
    if (signal?.aborted) {
      logger.info("agent codegen aborted by signal");
      const finalCode = fs.getMainCode() ?? "";
      return {
        code: finalCode,
        files: fs.getFiles(),
        renderedFiles: lastRenderedFiles,
        renderSuccess,
        usage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          reasoningTokens: totalReasoningTokens,
          totalCostUsd: calculateCostUsd(modelConfig, totalPromptTokens, totalCompletionTokens),
        },
        stepCount: 0,
        submitted: false,
      };
    }
    throw err;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function buildAgentUserMessage(
  promptText: string,
  isModification: boolean,
  baselineCode?: string,
): string {
  const parts: string[] = [];

  if (isModification && baselineCode) {
    parts.push("The current model code is already in main.py. View it first, then make the requested changes.");
    parts.push("");
    parts.push(`User request: ${promptText}`);
  } else {
    parts.push(`Create a Build123d model for the following request:`);
    parts.push("");
    parts.push(promptText);
    parts.push("");
    parts.push("Create main.py with your code, validate it, render it, and submit when you're satisfied with the result.");
  }

  return parts.join("\n");
}
