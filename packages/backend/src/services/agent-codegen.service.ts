/**
 * Agent-based codegen loop (Phase 6).
 *
 * Uses a custom text_editor tool plus Build123d tools (validate_code,
 * render_project, search_examples, lookup_api, submit_result) in a
 * multi-step tool-use loop via Vercel AI SDK's generateText with stopWhen.
 *
 * Provider-agnostic: works with any LLM provider (Anthropic, Bedrock,
 * OpenAI, etc.) via the standard createProviderModel() path.
 *
 * The agent operates on an in-memory virtual filesystem (AgentFilesystem) to
 * avoid disk I/O during the loop. Results are returned for the caller
 * (query.service.ts) to persist to storage.
 */

import { stepCountIs, hasToolCall, zodSchema } from "ai";
import { trackedGenerateText } from "./tracked-llm.service.js";
import { z } from "zod";
import { createLogger } from "../utils/logger.js";
import { AgentFilesystem } from "./agent-filesystem.service.js";
import { searchKnowledge, searchKnowledgeByTags } from "./knowledge.service.js";
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
  createProviderModel,
  buildGenerateOptions,
  calculateCostUsd,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { wrapInTemplate } from "./workbench-codegen.service.js";
import {
  buildAgentSystemPrompt,
  buildFullAgentSystemPrompt,
  buildSubAgentSystemPrompt,
  buildAssemblyAgentSystemPrompt,
} from "../prompts/agent-system-prompt.js";

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
  /** Pre-populated files for the agent's filesystem (for assembly agents) */
  initialFiles?: Map<string, string>;
  /** If true, render_project tool is not available (for sub-agents) */
  disableRender?: boolean;
  /** Override system prompt (used by multi-agent orchestration) */
  systemPromptOverride?: string;
  /** Override user message (used by multi-agent orchestration) */
  userMessageOverride?: string;
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
    initialFiles,
    disableRender,
    systemPromptOverride,
    userMessageOverride,
  } = input;

  logger.info(
    { prompt: promptText.slice(0, 80), isModification, maxSteps, model: modelConfig.label, complexity, disableRender },
    "starting agent codegen loop",
  );

  // Initialize virtual filesystem
  const fs = new AgentFilesystem();
  if (initialFiles && initialFiles.size > 0) {
    fs.initFromFiles(initialFiles);
  } else if (isModification && baselineCode) {
    fs.initFromCode(baselineCode);
  }

  // Build system prompt
  const systemPrompt = systemPromptOverride
    ?? (complexity === "complex"
      ? buildFullAgentSystemPrompt({ isModification })
      : buildAgentSystemPrompt({ promptText, interpretation, isModification }));

  // Create model from configured provider (works with any provider)
  const model = createProviderModel(modelConfig);

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
  const userMessage = userMessageOverride ?? buildAgentUserMessage(promptText, isModification, baselineCode);

  // Helper: wrap files for rendering/validation. Only main.py gets the full template
  // (with export calls referencing root_part). Component files get just the import.
  const wrapProjectFiles = (): ProjectFile[] => {
    return fs.getFiles().map(f => ({
      path: f.path,
      content: f.path === "main.py"
        ? wrapInTemplate(f.content, baseFileName)
        : `from build123d import *\nimport math\n${f.content}`,
    }));
  };

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

        const projectFiles = wrapProjectFiles();

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

        const projectFiles = wrapProjectFiles();

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
      description: "Search the Build123d external knowledge base (official docs, repo examples, test patterns, and reference material like specs and dimensions) for working code snippets or technical reference related to a technique or concept. Use when you need to see how a specific API or pattern works, or when you need dimensions/specifications for components.",
      inputSchema: zodSchema(z.object({
        query: z.string().describe("Natural language description of what you want to find (e.g., 'how to create a helix sweep', 'loft between two sketches')"),
      })),
      execute: async ({ query }: { query: string }) => {
        try {
          const { matches } = await searchKnowledge(query, 3);
          if (matches.length === 0) {
            return "No matching knowledge entries found.";
          }
          return matches.map((m, i) => {
            const header = `### Reference ${i + 1}: ${m.title} (${m.sourceType}, ${(m.similarity * 100).toFixed(0)}% match)`;
            const desc = m.description ? m.description + "\n\n" : "";
            // Reference entries contain Markdown prose; code entries contain Python
            const content = m.sourceType === "reference"
              ? `${m.code}\n`
              : `\`\`\`python\n${m.code}\n\`\`\`\n`;
            return `${header}\n${desc}${content}Source: ${m.sourceUrl}`;
          }).join("\n\n");
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, "search_knowledge tool error");
          return "Knowledge search unavailable.";
        }
      },
    },

    search_reference: {
      type: "function" as const,
      description: "Search the knowledge base by tags/concepts (e.g., 'usb-c', 'fastener', 'raspberry-pi') for reference specifications, dimensions, and design guidelines. Use when you need exact measurements, tolerances, or engineering data for specific components.",
      inputSchema: zodSchema(z.object({
        tags: z.array(z.string()).describe("Tags to search for (e.g., ['usb-c', 'connector'] or ['m3', 'fastener'])"),
      })),
      execute: async ({ tags }: { tags: string[] }) => {
        try {
          const matches = await searchKnowledgeByTags(tags, 3);
          if (matches.length === 0) {
            return `No reference entries found matching tags: ${tags.join(", ")}`;
          }
          return matches.map((m, i) => {
            const header = `### Reference ${i + 1}: ${m.title} (${m.sourceType})`;
            const desc = m.description ? m.description + "\n\n" : "";
            const content = m.sourceType === "reference"
              ? `${m.code}\n`
              : `\`\`\`python\n${m.code}\n\`\`\`\n`;
            return `${header}\n${desc}${content}Tags: ${m.concepts.join(", ")}`;
          }).join("\n\n");
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, "search_reference tool error");
          return "Reference search unavailable.";
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

  // Custom text_editor tool — provider-agnostic replacement for
  // Anthropic's built-in text_editor_20250728. Same interface, works
  // with any LLM provider that supports tool use.
  const textEditorTool = {
    type: "function" as const,
    description: `A text editor for viewing and editing Python files in the project directory.

Commands:
- view: View file contents with line numbers. Optionally specify view_range as [startLine, endLine].
- create: Create a new file with the given content. Fails if the file already exists — use str_replace to edit.
- str_replace: Replace exactly one occurrence of old_str with new_str in the file. The old_str must match exactly one location; include enough surrounding context to make it unique.
- insert: Insert new text after the specified line number. Use insert_line=0 to prepend.

All paths are relative (e.g., "main.py", "components/base.py"). Only .py files are allowed.
Always view a file before editing it to see the current line numbers and content.`,
    inputSchema: zodSchema(z.object({
      command: z.enum(["view", "create", "str_replace", "insert"]).describe("The editor command to execute"),
      path: z.string().describe("Relative file path (e.g., 'main.py')"),
      file_text: z.string().optional().describe("Full file content for 'create' command"),
      old_str: z.string().optional().describe("Exact string to find for 'str_replace' — must match exactly one location"),
      new_str: z.string().optional().describe("Replacement string for 'str_replace', or text to insert for 'insert'"),
      view_range: z.array(z.number()).length(2).optional().describe("[startLine, endLine] to view a specific range (1-indexed)"),
      insert_line: z.number().optional().describe("Line number to insert after (0 = prepend) for 'insert' command"),
    })),
    execute: async (params: {
      command: string;
      path: string;
      file_text?: string;
      old_str?: string;
      new_str?: string;
      view_range?: number[];
      insert_line?: number;
    }) => {
      const { command, path: filePath } = params;

      switch (command) {
        case "view": {
          return fs.view(filePath, params.view_range as [number, number] | undefined);
        }
        case "create": {
          if (!params.file_text) return "ERROR: file_text is required for create command.";
          return fs.create(filePath, params.file_text);
        }
        case "str_replace": {
          if (params.old_str === undefined) return "ERROR: old_str is required for str_replace command.";
          if (params.new_str === undefined) return "ERROR: new_str is required for str_replace command.";
          return fs.strReplace(filePath, params.old_str, params.new_str);
        }
        case "insert": {
          const insertText = params.new_str;
          if (params.insert_line === undefined) return "ERROR: insert_line is required for insert command.";
          if (!insertText) return "ERROR: new_str is required for insert command.";
          return fs.insert(filePath, params.insert_line, insertText);
        }
        default:
          return `ERROR: Unknown command: ${command}`;
      }
    },
  };

  // Run the agent loop
  try {
    // Build tool set — optionally exclude render_project for sub-agents
    const agentTools: Record<string, any> = {
      ...customTools,
      text_editor: textEditorTool,
    };
    if (disableRender) {
      delete agentTools.render_project;
    }

    const result = await trackedGenerateText({
      model,
      system: systemPrompt,
      prompt: userMessage,
      tools: agentTools,
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
    }, {
      purpose: "agent_orchestration",
      providerName: modelConfig.provider,
      modelId: modelConfig.id,
      modelName: modelConfig.modelName,
      modelConfig: { costPer1mInput: modelConfig.costPer1mInput, costPer1mOutput: modelConfig.costPer1mOutput },
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

// ── Multi-Agent Orchestration (Phase 6c) ────────────────────────────

interface DecomposedComponent {
  name: string;
  description: string;
}

interface DecompositionResult {
  components: DecomposedComponent[];
  assemblyNotes: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Decompose a complex prompt into independent components using an LLM call.
 */
async function decomposePrompt(
  promptText: string,
  interpretation: string | undefined,
  modelConfig: LlmModelConfig,
): Promise<DecompositionResult> {
  const model = createProviderModel(modelConfig);

  const systemPrompt = `You are a 3D CAD architect. Given a description of a complex 3D model, decompose it into independent components that can be built separately and assembled.

Rules:
- Each component must be a self-contained 3D part (solid body)
- Components should be geometrically independent (buildable without reference to others)
- Include key dimensions in each component description (keep descriptions under 100 words)
- Keep the number of components between 2 and 5
- Each component name must be a valid Python identifier (snake_case, no spaces)
- Assembly notes: brief positioning instructions (under 50 words)

Respond with raw JSON only. No markdown, no code fences, no explanation:
{"components":[{"name":"component_name","description":"Brief description with dimensions"}],"assemblyNotes":"Brief positioning instructions"}`;

  const fullPrompt = interpretation
    ? `User request: ${promptText}\n\nInterpretation: ${interpretation}`
    : promptText;

  const result = await trackedGenerateText({
    model,
    system: systemPrompt,
    prompt: fullPrompt,
    maxOutputTokens: 2048,
  }, {
    purpose: "agent_decomposition",
    providerName: modelConfig.provider,
    modelId: modelConfig.id,
    modelName: modelConfig.modelName,
    modelConfig: { costPer1mInput: modelConfig.costPer1mInput, costPer1mOutput: modelConfig.costPer1mOutput },
  });

  const promptTokens = result.usage?.inputTokens ?? 0;
  const completionTokens = result.usage?.outputTokens ?? 0;

  try {
    // Strip markdown code fences if present
    const cleanText = result.text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    const parsed = JSON.parse(cleanText) as { components: DecomposedComponent[]; assemblyNotes: string };

    if (!Array.isArray(parsed.components) || parsed.components.length < 2) {
      throw new Error("Decomposition produced fewer than 2 components");
    }

    // Validate component names are valid Python identifiers
    for (const c of parsed.components) {
      c.name = c.name.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    }

    logger.info(
      { componentCount: parsed.components.length, components: parsed.components.map(c => c.name) },
      "prompt decomposed into components",
    );

    return {
      components: parsed.components,
      assemblyNotes: parsed.assemblyNotes || "",
      promptTokens,
      completionTokens,
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), text: result.text.slice(0, 200) }, "decomposition parsing failed");
    throw new Error(`Failed to decompose prompt: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Run multi-agent orchestration for complex models.
 *
 * 1. Decompose the prompt into components via LLM
 * 2. Run sub-agents to build each component (validate only, no render)
 * 3. Run an assembly agent to combine components and render the final model
 */
export async function runMultiAgentCodegen(input: AgentCodegenInput): Promise<AgentCodegenResult> {
  const {
    promptText,
    interpretation,
    baseFileName,
    maxSteps,
    modelConfig,
    signal,
    onProgress,
  } = input;

  logger.info(
    { prompt: promptText.slice(0, 80), model: modelConfig.label },
    "starting multi-agent orchestration",
  );

  // Accumulate usage across all agents
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalReasoningTokens = 0;
  let totalSteps = 0;

  // Step 1: Decompose the prompt
  onProgress?.("decomposing", "Breaking down the model into components...");

  let decomposition: DecompositionResult;
  try {
    decomposition = await decomposePrompt(promptText, interpretation, modelConfig);
  } catch (err) {
    // Decomposition failed — fall back to single-agent
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "decomposition failed, falling back to single agent");
    return runAgentCodegen(input);
  }

  totalPromptTokens += decomposition.promptTokens;
  totalCompletionTokens += decomposition.completionTokens;

  // Step 2: Run sub-agents for each component
  const componentFiles = new Map<string, string>();
  const subAgentMaxSteps = Math.min(Math.floor(maxSteps / 2), 10);

  for (let i = 0; i < decomposition.components.length; i++) {
    const component = decomposition.components[i];
    if (signal?.aborted) break;

    onProgress?.("component", `Building component ${i + 1}/${decomposition.components.length}: ${component.name}...`);

    const overallContext = `This is part of a larger model: "${promptText}".\n\nAll components:\n${decomposition.components.map(c => `- ${c.name}: ${c.description}`).join("\n")}\n\nAssembly plan: ${decomposition.assemblyNotes}`;

    const subPrompt = buildSubAgentSystemPrompt({
      componentName: component.name,
      componentDescription: component.description,
      overallContext,
    });

    try {
      const subUserMessage = `Create the "${component.name}" component.\n\n${component.description}\n\nWrite a function called \`${component.name}\` in main.py that returns the Part. Validate your code, then submit when validation passes. Do NOT render.`;

      const subResult = await runAgentCodegen({
        promptText: component.description,
        isModification: false,
        baseFileName,
        maxSteps: subAgentMaxSteps,
        modelConfig,
        signal,
        disableRender: true,
        systemPromptOverride: subPrompt,
        userMessageOverride: subUserMessage,
        onProgress: (state, detail) => {
          onProgress?.(state, `[${component.name}] ${detail}`);
        },
      });

      totalPromptTokens += subResult.usage.promptTokens;
      totalCompletionTokens += subResult.usage.completionTokens;
      totalReasoningTokens += subResult.usage.reasoningTokens;
      totalSteps += subResult.stepCount;

      // Collect component code (sub-agent writes to main.py, we rename it)
      if (subResult.code.trim()) {
        componentFiles.set(`components/${component.name}.py`, subResult.code);
        logger.info(
          { component: component.name, codeLength: subResult.code.length, steps: subResult.stepCount },
          "sub-agent completed component",
        );
      } else {
        logger.warn({ component: component.name }, "sub-agent produced no code");
      }
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), component: component.name }, "sub-agent failed");
      // Continue with other components — the assembly agent can work with what we have
    }
  }

  if (componentFiles.size === 0) {
    logger.warn("no components produced, falling back to single agent");
    return runAgentCodegen(input);
  }

  // Step 3: Run assembly agent
  onProgress?.("assembling", "Assembling components into final model...");

  const componentSummary = Array.from(componentFiles.entries())
    .map(([path, code]) => {
      const lines = code.split("\n");
      const funcMatch = lines.find(l => l.startsWith("def "));
      const funcSignature = funcMatch ?? "(function not found)";
      return `- \`${path}\`: ${funcSignature}`;
    })
    .join("\n");

  const assemblyPrompt = buildAssemblyAgentSystemPrompt({
    originalPrompt: promptText,
    assemblyNotes: decomposition.assemblyNotes,
    componentSummary,
  });

  // Assembly agent gets more steps since it needs to render
  const assemblyMaxSteps = Math.min(maxSteps, 15);

  const componentFileList = Array.from(componentFiles.keys()).map(p => `- ${p}`).join("\n");
  const assemblyUserMessage = `Assemble the components into the complete model.\n\nAvailable component files:\n${componentFileList}\n\nView each component file to understand its function signature and dimensions, then write main.py that imports and assembles them. Validate, render, and submit when the render succeeds.`;

  const assemblyResult = await runAgentCodegen({
    promptText: assemblyUserMessage,
    isModification: false,
    baseFileName,
    maxSteps: assemblyMaxSteps,
    modelConfig,
    signal,
    initialFiles: componentFiles,
    systemPromptOverride: assemblyPrompt,
    userMessageOverride: assemblyUserMessage,
    onProgress: (state, detail) => {
      onProgress?.(state, `[assembly] ${detail}`);
    },
  });

  totalPromptTokens += assemblyResult.usage.promptTokens;
  totalCompletionTokens += assemblyResult.usage.completionTokens;
  totalReasoningTokens += assemblyResult.usage.reasoningTokens;
  totalSteps += assemblyResult.stepCount;

  // Combine all files (components + assembly main.py)
  const allFiles = assemblyResult.files;

  logger.info(
    {
      componentCount: componentFiles.size,
      assemblySteps: assemblyResult.stepCount,
      totalSteps,
      renderSuccess: assemblyResult.renderSuccess,
      fileCount: allFiles.length,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
    },
    "multi-agent orchestration completed",
  );

  return {
    code: assemblyResult.code,
    files: allFiles,
    renderedFiles: assemblyResult.renderedFiles,
    renderSuccess: assemblyResult.renderSuccess,
    usage: {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      reasoningTokens: totalReasoningTokens,
      totalCostUsd: calculateCostUsd(modelConfig, totalPromptTokens, totalCompletionTokens),
    },
    stepCount: totalSteps,
    submitted: assemblyResult.submitted,
  };
}
