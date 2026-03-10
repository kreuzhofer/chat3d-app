/**
 * Agent tool definitions for the codegen loop.
 * Factory function builds all tools: text_editor, validate_code,
 * render_project, validate_and_render, search_examples, search_knowledge,
 * lookup_api, list_files, and submit_result.
 */
import { zodSchema } from "ai";
import { z } from "zod";
import { createLogger } from "../utils/logger.js";
import { AgentFilesystem } from "./agent-filesystem.service.js";
import { hybridSearchKnowledge } from "./knowledge-search.service.js";
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

const logger = createLogger("agent-tools");

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

export interface ValidationResult {
  valid: boolean;
  text: string;
}

export async function doValidate(projectFiles: ProjectFile[]): Promise<ValidationResult> {
  const result = await validateBuild123dProject(projectFiles);
  if (result.valid) {
    const warningText = result.warnings.length > 0
      ? `\n\nWarnings (non-blocking):\n${result.warnings.map(w => `- [${w.rule}] ${w.message} (line ${w.line})`).join("\n")}`
      : "";
    return { valid: true, text: `Validation PASSED. No errors found.${warningText}` };
  }
  const errorText = result.errors.join("\n");
  const warningText = result.warnings.length > 0
    ? `\n\nWarnings:\n${result.warnings.map(w => `- [${w.rule}] ${w.message} (line ${w.line})`).join("\n")}`
    : "";
  return { valid: false, text: `Validation FAILED.\n\nErrors:\n${errorText}${warningText}` };
}

export interface RenderResult {
  success: boolean;
  text: string;
  files: RenderedFile[];
}

export async function doRender(
  projectFiles: ProjectFile[],
  baseFileName: string,
  signal?: AbortSignal,
): Promise<RenderResult> {
  try {
    const result = await renderBuild123dProject(
      { files: projectFiles, baseFileName },
      { signal },
    );
    const fileList = result.files.map(f => f.filename).join(", ");
    return {
      success: true,
      text: `Render SUCCEEDED. Generated ${result.files.length} file(s): ${fileList}`,
      files: result.files,
    };
  } catch (err) {
    if (err instanceof RenderingServiceError) {
      logger.info({ err: err.message, isInfra: err.isInfrastructure }, "render failed");
      if (err.isInfrastructure) {
        return {
          success: false,
          text: `Render FAILED (infrastructure error — not a code issue): ${err.message}\n\nThis is a service issue, not a problem with your code. You may try again.`,
          files: [],
        };
      }
      return {
        success: false,
        text: `Render FAILED.\n\nError: ${err.message}\n\nPlease fix the code and validate again before re-rendering.`,
        files: [],
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "render: unexpected error");
    return {
      success: false,
      text: `Render FAILED with unexpected error: ${msg}`,
      files: [],
    };
  }
}

const MAX_EXAMPLE_LINES = 20;
const MAX_KNOWLEDGE_CODE_LINES = 30;

function truncateCode(code: string, maxLines: number): string {
  const lines = code.split("\n");
  if (lines.length <= maxLines) return code;
  return lines.slice(0, maxLines).join("\n") + `\n# ... (${lines.length - maxLines} more lines)`;
}

export interface AgentToolDeps {
  fs: AgentFilesystem;
  wrapProjectFiles: () => ProjectFile[];
  baseFileName: string;
  signal?: AbortSignal;
  onProgress?: (state: string, detail: string) => void;
  onRenderSuccess: (files: RenderedFile[]) => void;
  onSubmit: () => void;
}

export function buildAgentTools(deps: AgentToolDeps, options: { disableRender?: boolean }): Record<string, any> {
  const { fs, wrapProjectFiles, baseFileName, signal, onProgress, onRenderSuccess, onSubmit } = deps;

  const tools: Record<string, any> = {
    validate_code: {
      type: "function" as const,
      description: "Validate your Build123d code for syntax errors and common mistakes. This is fast and free — always validate before rendering. Validates all files in the project.",
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const files = fs.getFiles();
        if (files.length === 0) {
          return "ERROR: No files in the project. Create main.py first.";
        }
        onProgress?.("validating", "Validating code...");
        try {
          const result = await doValidate(wrapProjectFiles());
          return result.text;
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, "validate_code tool error");
          return `Validation service unavailable: ${err instanceof Error ? err.message : String(err)}`;
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
          return matches.map((m, i) => {
            const codePreview = truncateCode(m.code, MAX_EXAMPLE_LINES);
            return `### Example ${i + 1} (similarity: ${(m.similarity * 100).toFixed(0)}%)\nPrompt: ${m.prompt}\n\nCode:\n\`\`\`python\n${codePreview}\n\`\`\``;
          }).join("\n\n");
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
          const { matches } = await hybridSearchKnowledge(query, 3);
          if (matches.length === 0) {
            return "No matching knowledge entries found.";
          }
          return matches.map((m, i) => {
            const header = `### Reference ${i + 1}: ${m.title} (${m.sourceType}, ${(m.similarity * 100).toFixed(0)}% match)`;
            const desc = m.description ? m.description + "\n\n" : "";
            // Truncate code entries, keep reference entries full (they contain load-bearing data)
            const codeContent = m.sourceType === "reference"
              ? m.code
              : truncateCode(m.code, MAX_KNOWLEDGE_CODE_LINES);
            const content = m.sourceType === "reference"
              ? `${codeContent}\n`
              : `\`\`\`python\n${codeContent}\n\`\`\`\n`;
            return `${header}\n${desc}${content}Source: ${m.sourceUrl}`;
          }).join("\n\n");
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, "search_knowledge tool error");
          return "Knowledge search unavailable.";
        }
      },
    },

    list_files: {
      type: "function" as const,
      description: "List files in the project with line counts. Cheaper than viewing each file individually.",
      inputSchema: zodSchema(z.object({
        directory: z.string().optional().describe("Optional directory to filter by (e.g., 'components')"),
      })),
      execute: async ({ directory }: { directory?: string }) => {
        const files = fs.getFiles();
        const filtered = directory
          ? files.filter(f => f.path.startsWith(directory + "/") || f.path === directory)
          : files;
        if (filtered.length === 0) return "(empty project)";
        return filtered
          .map(f => `  ${f.path} (${f.content.split("\n").length} lines)`)
          .join("\n");
      },
    },

    submit_result: {
      type: "function" as const,
      description: "Submit your result when you're satisfied with the rendered output. Call this after a successful render to complete the task.",
      inputSchema: zodSchema(z.object({
        summary: z.string().describe("Brief summary of what was built or changed"),
      })),
      execute: async ({ summary }: { summary: string }) => {
        onSubmit();
        logger.info({ summary }, "agent submitted result");
        return `Result submitted: ${summary}`;
      },
    },

    text_editor: {
      type: "function" as const,
      description: `A text editor for viewing and editing Python files in the project directory.

Commands:
- view: View file contents with line numbers. Optionally specify view_range as [startLine, endLine].
- create: Create a new file with the given content. Fails if the file already exists — use str_replace to edit.
- str_replace: Replace exactly one occurrence of old_str with new_str in the file. The old_str must match exactly one location; include enough surrounding context to make it unique.
- insert: Insert new text after the specified line number. Use insert_line=0 to prepend.
- overwrite: Replace entire contents of an existing file. Prefer str_replace for targeted edits.

All paths are relative (e.g., "main.py", "components/base.py"). Only .py files are allowed.
Always view a file before editing it to see the current line numbers and content.`,
      inputSchema: zodSchema(z.object({
        command: z.enum(["view", "create", "str_replace", "insert", "overwrite"]).describe("The editor command to execute"),
        path: z.string().describe("Relative file path (e.g., 'main.py')"),
        file_text: z.string().optional().describe("Full file content for 'create' or 'overwrite' command"),
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
          case "view":
            return fs.view(filePath, params.view_range as [number, number] | undefined);
          case "create":
            if (!params.file_text) return "ERROR: file_text is required for create command.";
            return fs.create(filePath, params.file_text);
          case "str_replace":
            if (params.old_str === undefined) return "ERROR: old_str is required for str_replace command.";
            if (params.new_str === undefined) return "ERROR: new_str is required for str_replace command.";
            return fs.strReplace(filePath, params.old_str, params.new_str);
          case "insert": {
            const insertText = params.new_str;
            if (params.insert_line === undefined) return "ERROR: insert_line is required for insert command.";
            if (!insertText) return "ERROR: new_str is required for insert command.";
            return fs.insert(filePath, params.insert_line, insertText);
          }
          case "overwrite":
            if (!params.file_text) return "ERROR: file_text is required for overwrite command.";
            return fs.overwrite(filePath, params.file_text);
          default:
            return `ERROR: Unknown command: ${command}`;
        }
      },
    },
  };

  // Add render_project and validate_and_render unless disabled (sub-agents)
  if (!options.disableRender) {
    tools.render_project = {
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
        onProgress?.("rendering", "Rendering 3D model...");
        const result = await doRender(wrapProjectFiles(), baseFileName, signal);
        if (result.success) {
          onRenderSuccess(result.files);
        }
        return result.success
          ? `${result.text}\n\nYou can now call submit_result if you're satisfied, or make further edits.`
          : result.text;
      },
    };

    tools.validate_and_render = {
      type: "function" as const,
      description: "Validate and render in one step. Validates first; if validation passes, renders immediately. Use this when you're confident the code is ready. Saves a round-trip compared to calling validate_code then render_project separately.",
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

        // Step 1: Validate
        onProgress?.("validating", "Validating code...");
        try {
          const valResult = await doValidate(projectFiles);
          if (!valResult.valid) {
            return valResult.text;
          }
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, "validate_and_render: validation error");
          return `Validation service unavailable: ${err instanceof Error ? err.message : String(err)}`;
        }

        // Step 2: Render (validation passed)
        onProgress?.("rendering", "Validation passed. Rendering 3D model...");
        const renderResult = await doRender(projectFiles, baseFileName, signal);
        if (renderResult.success) {
          onRenderSuccess(renderResult.files);
          return `Validation PASSED.\n${renderResult.text}\n\nYou can now call submit_result if you're satisfied, or make further edits.`;
        }
        return `Validation PASSED but ${renderResult.text}`;
      },
    };
  }

  return tools;
}
