/**
 * Agent tool definitions for the codegen loop.
 * Factory function builds all tools: text_editor, validate_code,
 * render_project, validate_and_render, evaluate_model, search_examples,
 * search_knowledge, lookup_api, list_files, and submit_result.
 */
import { zodSchema } from "ai";
import { z } from "zod";
import { createLogger } from "../utils/logger.js";
import { AgentFilesystem } from "./agent-filesystem.service.js";
import { hybridSearchKnowledge } from "./knowledge-search.service.js";
import type { ProjectFile, RenderedFile } from "./rendering.service.js";
import { doValidate, doRender, runVlmEval, type AgentEvalResult } from "./agent-render-helpers.service.js";
import { checkAssertions } from "./code-eval-assertions.service.js";
import { evaluateCode } from "./code-eval.service.js";
import { runFullEvaluation } from "./eval-orchestrator.service.js";
import { renderModelScreenshots } from "./stl-rendering-client.service.js";
import { flattenForEval } from "../utils/code-flatten.js";
import type { CodeAssertion } from "./spec-generation.service.js";
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

// Re-export for backward compatibility
export type { ValidationResult, RenderResult, AgentEvalResult } from "./agent-render-helpers.service.js";
export { doValidate, doRender } from "./agent-render-helpers.service.js";

import { truncateCode } from "../utils/code-truncate.js";

const MAX_EXAMPLE_LINES = 20;
const MAX_KNOWLEDGE_CODE_LINES = 30;

export interface AgentToolDeps {
  fs: AgentFilesystem;
  wrapProjectFiles: () => ProjectFile[];
  baseFileName: string;
  signal?: AbortSignal;
  onProgress?: (state: string, detail: string) => void;
  onRenderSuccess: (files: RenderedFile[]) => void;
  onSubmit: () => void;
  /** Getter for the most recently rendered files (for evaluate_model / submit_result) */
  getLastRenderedFiles: () => RenderedFile[];
  /** The user's prompt text (for VLM evaluation context) */
  userPrompt: string;
  /** Minimum VLM score to accept submission (from chat.auto_approve_threshold) */
  evalThreshold: number;
  /** Callback when VLM evaluation completes */
  onEvalComplete?: (result: AgentEvalResult) => void;
  /** Getter for the most recent eval result (set by onEvalComplete) */
  getLastEvalResult?: () => AgentEvalResult | null;
  /** Code assertions from spec generation (for evaluate_code tool) */
  codeAssertions?: CodeAssertion[];
  /** Spec interpretation (for code review context) */
  specInterpretation?: string;
  /** Construction spec (for full eval code review + VLM context) */
  constructionSpec?: string;
  /** Verification checklist (for VLM eval) */
  verificationChecklist?: string[];
  /** Annotated criteria with visibility routing (for eval routing) */
  annotatedCriteria?: import("./spec-generation.service.js").AnnotatedCriterion[];
  /** Category name (for VLM context — avoids hardcoded "User Generated") */
  categoryName?: string;
  /** Prompt complexity (for VLM context — avoids hardcoded 5) */
  complexity?: number;
  /** Code eval weight for composite scoring */
  codeEvalWeight?: number;
}

export function buildAgentTools(deps: AgentToolDeps, options: { disableRender?: boolean; enableSearch?: boolean; ragMaxExamplesOverride?: number; excludePromptIds?: string[] }): Record<string, any> {
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
          // Sub-agents write functions (no root_part) — filter that specific error
          if (options.disableRender && !result.valid && result.text.includes("root_part")) {
            const filtered = result.text
              .split("\n")
              .filter(line => !line.includes("root_part"))
              .join("\n")
              .replace(/Errors:\s*\n\s*\n/, "");
            // If root_part was the only error, treat as valid
            const hasOtherErrors = filtered.includes("Syntax error") || filtered.includes("severity");
            if (!hasOtherErrors) {
              return result.text.replace("Validation FAILED", "Validation PASSED (component mode — no root_part needed)")
                .replace(/\nErrors:\n[^\n]*root_part[^\n]*\n?/, "\n");
            }
          }
          return result.text;
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, "validate_code tool error");
          return `Validation service unavailable: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

  };

  // Add search/lookup tools only when enabled (disabled for sub-agents with pre-loaded research)
  if (options.enableSearch) {
    tools.search_examples = {
      type: "function" as const,
      description: "Search the workbench for similar Build123d examples. Use this to see how similar models are built. Returns up to 3 examples with their prompt and code.",
      inputSchema: zodSchema(z.object({
        query: z.string().describe("Natural language description of what you're looking for (e.g., 'gear with rounded teeth', 'box with lid')"),
      })),
      execute: async ({ query }: { query: string }) => {
        try {
          const { getRagMaxExamples, getRagSimilarityThreshold } = await import("./generation-settings.service.js");
          const [globalMaxEx, simThreshold] = await Promise.all([getRagMaxExamples(), getRagSimilarityThreshold()]);
          const maxEx = options.ragMaxExamplesOverride ?? globalMaxEx;
          if (maxEx <= 0) return "Example search disabled for this run (few-shot count = 0).";
          const { matches } = await findSimilarExamples(query, maxEx, undefined, options.excludePromptIds);
          const filtered = matches.filter(m => m.similarity >= simThreshold);
          if (filtered.length === 0) {
            return "No similar examples found in the workbench (above similarity threshold).";
          }
          return filtered.map((m, i) => {
            const codePreview = truncateCode(m.code, MAX_EXAMPLE_LINES);
            return `### Example ${i + 1} (similarity: ${(m.similarity * 100).toFixed(0)}%)\nPrompt: ${m.prompt}\n\nCode:\n\`\`\`python\n${codePreview}\n\`\`\``;
          }).join("\n\n");
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, "search_examples tool error");
          return "Example search unavailable.";
        }
      },
    };

    tools.lookup_api = {
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
    };

    tools.search_knowledge = {
      type: "function" as const,
      description: "Search the Build123d external knowledge base (official docs, repo examples, test patterns, and reference material like specs and dimensions) for working code snippets or technical reference related to a technique or concept. Use when you need to see how a specific API or pattern works, or when you need dimensions/specifications for components.",
      inputSchema: zodSchema(z.object({
        query: z.string().describe("Natural language description of what you want to find (e.g., 'how to create a helix sweep', 'loft between two sketches')"),
      })),
      execute: async ({ query }: { query: string }) => {
        try {
          const { getRagMaxKnowledge } = await import("./generation-settings.service.js");
          const maxKnowledge = await getRagMaxKnowledge();
          const { matches } = await hybridSearchKnowledge(query, maxKnowledge);
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
    };
  } // end enableSearch

  tools.list_files = {
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
    };

  tools.submit_result = {
      type: "function" as const,
      description: options.disableRender
        ? "Submit your component code after validation passes. No render needed — the assembly agent handles rendering."
        : "Submit your result after a successful render. Automatically runs a visual evaluation (VLM) to check quality. If the score is below the acceptance threshold, the submission is REJECTED and you must address the issues before re-submitting.",
      inputSchema: zodSchema(z.object({
        summary: z.string().describe("Brief summary of what was built or changed"),
      })),
      execute: async ({ summary }: { summary: string }) => {
        // Sub-agents (component mode): accept code without render/VLM
        if (options.disableRender) {
          const code = fs.getMainCode();
          if (!code || !code.trim()) {
            return "ERROR: No code in main.py. Write your component code first.";
          }
          onSubmit();
          logger.info({ summary }, "sub-agent submitted component code");
          return `Component submitted: ${summary}`;
        }

        const renderedFiles = deps.getLastRenderedFiles();
        if (renderedFiles.length === 0) {
          return "ERROR: No rendered model available. Render the project first before submitting.";
        }

        // Hard gate: run assertion check before expensive VLM eval
        if (deps.codeAssertions && deps.codeAssertions.length > 0) {
          const submitFiles = fs.getFiles();
          const submitCode = flattenForEval(submitFiles);
          if (submitCode.trim()) {
            try {
              const assertResult = await checkAssertions(submitCode, deps.codeAssertions);
              if (assertResult.failed > 0) {
                const failDetails = assertResult.results
                  .filter(r => r.matched && !r.pass)
                  .map(r => `  ✗ ${r.detail}`)
                  .join("\n");
                logger.info({ failed: assertResult.failed, total: assertResult.checked }, "submission rejected — assertion failures");
                return `SUBMISSION REJECTED — ${assertResult.failed} assertion(s) failed. Fix these parameter errors before submitting:\n${failDetails}\n\nUse evaluate_code to see full details, then fix the code and try again.`;
              }
            } catch (err) {
              logger.warn({ err: err instanceof Error ? err.message : String(err) }, "assertion check failed during submit (continuing)");
            }
          }
        }

        // Run full evaluation pipeline (assertions + code review + VLM + composite)
        // This is the SAME pipeline as post-loop eval — no dual-judge disagreement
        onProgress?.("evaluating", "Running full evaluation (code review + visual)...");
        const submitCode = flattenForEval(fs.getFiles());
        const stlFile = renderedFiles.find(f => f.filename.toLowerCase().endsWith(".stl"));
        const threemfFile = renderedFiles.find(f => f.filename.toLowerCase().endsWith(".3mf"));
        const modelSource = stlFile ?? threemfFile;

        let screenshots: import("./stl-rendering-client.service.js").RenderedScreenshot[] = [];
        if (modelSource) {
          try {
            const ssResult = await renderModelScreenshots({
              modelData: modelSource.contentBase64,
              format: stlFile ? "stl" : "3mf",
            });
            screenshots = ssResult.images;
          } catch (err) {
            logger.warn({ err: err instanceof Error ? err.message : String(err) }, "screenshot failed during submit");
          }
        }

        if (screenshots.length === 0 && !submitCode.trim()) {
          logger.warn({ summary }, "no screenshots and no code — accepting without eval");
          onSubmit();
          return `Result submitted (eval unavailable): ${summary}`;
        }

        try {
          const vlmImages = screenshots.filter(s => s.angle !== "isometric").map(s => ({ angle: s.angle, base64: s.base64 }));
          const fullEval = await runFullEvaluation({
            code: submitCode,
            userPrompt: deps.userPrompt,
            specInterpretation: deps.specInterpretation,
            codeAssertions: deps.codeAssertions,
            images: vlmImages,
            categoryName: deps.categoryName ?? "User Generated",
            complexity: deps.complexity ?? 5,
            verificationChecklist: deps.verificationChecklist,
            constructionSpec: deps.constructionSpec,
            annotatedCriteria: deps.annotatedCriteria,
            stlBase64: stlFile?.contentBase64,
            modelFormat: "stl",
            codeEvalWeight: deps.codeEvalWeight ?? 0.5,
          });

          const compositeScore = fullEval.compositeScore;
          const allIssues = [...fullEval.codeIssues, ...fullEval.vlmIssues];

          // Store eval result for pipeline reuse (screenshots + scores)
          deps.onEvalComplete?.({
            score: compositeScore,
            vlmModel: fullEval.vlmModel ?? "unknown",
            issues: allIssues,
            suggestions: fullEval.vlmSuggestions,
            screenshots,
          });

          if (fullEval.assertionsFailed) {
            logger.info({ compositeScore, summary }, "submission rejected — assertion failures");
            const failText = allIssues.map(i => `- ${i}`).join("\n");
            return `SUBMISSION REJECTED — assertion failures detected (score: ${compositeScore}/10).\n\nIssues:\n${failText}\n\nFix the parameter errors and try again.`;
          }

          if (compositeScore < deps.evalThreshold) {
            logger.info({ compositeScore, threshold: deps.evalThreshold, codeScore: fullEval.codeScore, visualScore: fullEval.visualScore, summary }, "submission rejected — composite score below threshold");
            const issueText = allIssues.length > 0 ? `\n\nIssues:\n${allIssues.map(i => `- ${i}`).join("\n")}` : "";
            const suggText = fullEval.vlmSuggestions.length > 0 ? `\n\nSuggestions:\n${fullEval.vlmSuggestions.map(s => `- ${s}`).join("\n")}` : "";
            return `SUBMISSION REJECTED — composite score ${compositeScore}/10 (code: ${fullEval.codeScore ?? "?"}, visual: ${fullEval.visualScore ?? "?"}) is below the acceptance threshold of ${deps.evalThreshold}/10.${issueText}${suggText}\n\nAddress the issues above, then validate, render, and submit again.`;
          }

          onSubmit();
          logger.info({ summary, compositeScore, codeScore: fullEval.codeScore, visualScore: fullEval.visualScore }, "agent submitted result (full eval)");
          return `Result submitted (composite: ${compositeScore}/10, code: ${fullEval.codeScore ?? "?"}, visual: ${fullEval.visualScore ?? "?"}): ${summary}`;
        } catch (err) {
          // Full eval failed — fall back to accepting without score
          logger.warn({ err: err instanceof Error ? err.message : String(err), summary }, "full eval failed during submit — accepting without score");
          onSubmit();
          return `Result submitted (eval failed, accepted best-effort): ${summary}`;
        }
      },
    };

  tools.evaluate_model = {
      type: "function" as const,
      description: "Evaluate the rendered 3D model against the user's prompt using a vision model (VLM). Takes screenshots and scores the model 1-10. Only call after a successful render. Use this to check quality before submitting — submit_result also runs evaluation automatically.",
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        return runVlmEval({
          getLastRenderedFiles: deps.getLastRenderedFiles,
          userPrompt: deps.userPrompt,
          onEvalComplete: deps.onEvalComplete,
          onProgress,
        });
      },
    };

  tools.evaluate_code = {
      type: "function" as const,
      description: "Review your code for correctness against the user's prompt. Runs two checks: (1) Assertion check — verifies numeric parameters (dimensions, counts) match the spec (free, instant). (2) Code review — an LLM reviews the code for parameter accuracy, feature completeness, and logical correctness (cheap, ~5s). Call this BEFORE rendering to catch dimensional errors early. You do NOT need a rendered model for this.",
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const allFiles = fs.getFiles();
        if (allFiles.length === 0) {
          return "ERROR: No files in the project. Create main.py first.";
        }
        const allCode = flattenForEval(allFiles);

        onProgress?.("evaluating", "Reviewing code...");
        const parts: string[] = [];

        // Phase 1: Assertions (free, deterministic) — check all code
        if (deps.codeAssertions && deps.codeAssertions.length > 0) {
          try {
            const summary = await checkAssertions(allCode, deps.codeAssertions);
            if (summary.failed > 0) {
              parts.push(`ASSERTION CHECK: ${summary.failed}/${summary.checked} FAILED`);
              for (const r of summary.results.filter(r => r.matched && !r.pass)) {
                parts.push(`  ✗ ${r.detail}`);
              }
              for (const r of summary.results.filter(r => r.matched && r.pass)) {
                parts.push(`  ✓ ${r.detail}`);
              }
            } else if (summary.checked > 0) {
              parts.push(`ASSERTION CHECK: All ${summary.checked} passed ✓`);
              for (const r of summary.results.filter(r => r.matched)) {
                parts.push(`  ✓ ${r.detail}`);
              }
            } else {
              parts.push("ASSERTION CHECK: No parameters matched (inconclusive)");
            }
            if (summary.unmatched > 0) {
              parts.push(`  (${summary.unmatched} assertions could not be matched to code variables)`);
            }
          } catch (err) {
            parts.push(`ASSERTION CHECK: Error — ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          parts.push("ASSERTION CHECK: No assertions defined for this prompt");
        }

        // Phase 2: Code review LLM
        try {
          const review = await evaluateCode({
            userPrompt: deps.userPrompt,
            code: allCode,
            specInterpretation: deps.specInterpretation,
          });
          parts.push(`\nCODE REVIEW: Score ${review.score}/10`);
          if (review.issues.length > 0) {
            for (const issue of review.issues) {
              parts.push(`  • ${issue}`);
            }
          } else {
            parts.push("  No issues found.");
          }
        } catch (err) {
          parts.push(`\nCODE REVIEW: Error — ${err instanceof Error ? err.message : String(err)}`);
        }

        return parts.join("\n");
      },
    };

  tools.text_editor = {
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
