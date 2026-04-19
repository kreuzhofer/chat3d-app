/**
 * Shared validation, render, and VLM eval helpers for the agent codegen pipeline.
 * Extracted from agent-tools.service.ts to keep files under 400 lines.
 */

import { createLogger } from "../utils/logger.js";
import {
  renderBuild123dProject,
  validateBuild123dProject,
  type ProjectFile,
  type RenderedFile,
  RenderingServiceError,
} from "./rendering.service.js";
import { renderModelScreenshots } from "./stl-rendering-client.service.js";
import { evaluateModel } from "./visual-eval.service.js";

export interface AgentEvalResult {
  score: number;
  visualScore: number | null;
  codeScore: number | null;
  assertionPassRate: number | null;
  vlmModel: string;
  codeReviewModel: string | null;
  issues: string[];
  suggestions: string[];
  /** Screenshots taken during this evaluation (base64 PNGs). */
  screenshots: import("./stl-rendering-client.service.js").RenderedScreenshot[];
}

const logger = createLogger("agent-render");

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
      const isMeshError = err.message.includes("mesh is invalid") || err.message.includes("mesh is not valid");
      const meshHint = isMeshError
        ? "\n\nThis means your geometry has self-intersections or degenerate faces. Common fixes:\n- Reduce fillet/chamfer radii\n- Increase wall thickness in offset/shell operations\n- Add clearance between boolean cuts\n- Simplify complex boolean chains\nIf this error persists after 2 attempts, REWRITE the geometry with a simpler construction approach."
        : "";
      return {
        success: false,
        text: `Render FAILED.\n\nError: ${err.message}${meshHint}\n\nPlease fix the code and validate again before re-rendering.`,
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

// ── VLM evaluation helper ──────────────────────────────────────────

export interface VlmEvalDeps {
  getLastRenderedFiles: () => RenderedFile[];
  userPrompt: string;
  onEvalComplete?: (result: AgentEvalResult) => void;
  onProgress?: (state: string, detail: string) => void;
}

/**
 * Run VLM evaluation on the last rendered files.
 * Returns formatted text result or an error string starting with "ERROR:".
 */
export async function runVlmEval(deps: VlmEvalDeps): Promise<string> {
  const renderedFiles = deps.getLastRenderedFiles();
  if (renderedFiles.length === 0) {
    return "ERROR: No rendered model available. Render the project first.";
  }
  deps.onProgress?.("evaluating", "Running visual evaluation...");
  const stlFile = renderedFiles.find(f => f.filename.toLowerCase().endsWith(".stl"));
  const threemfFile = renderedFiles.find(f => f.filename.toLowerCase().endsWith(".3mf"));
  const source = stlFile ?? threemfFile;
  if (!source) {
    return "ERROR: No STL or 3MF file found in rendered output.";
  }
  try {
    const ssResult = await renderModelScreenshots({
      modelData: source.contentBase64,
      format: stlFile ? "stl" : "3mf",
    });
    if (ssResult.images.length === 0) {
      return "ERROR: Screenshot service returned no images.";
    }
    const images = ssResult.images.map(s => ({ angle: s.angle, base64: s.base64 }));
    const evalResult = await evaluateModel({
      userPrompt: deps.userPrompt,
      categoryName: "User Generated",
      complexity: 5,
      images,
      stlBase64: stlFile?.contentBase64,
    });
    deps.onEvalComplete?.({
      score: evalResult.score,
      visualScore: evalResult.score,
      codeScore: null,
      assertionPassRate: null,
      vlmModel: evalResult.vlmModel,
      codeReviewModel: null,
      issues: evalResult.issues, suggestions: evalResult.suggestions,
      screenshots: ssResult.images,
    });
    const issueText = evalResult.issues.length > 0
      ? `\nIssues:\n${evalResult.issues.map(i => `- ${i}`).join("\n")}\n` : "";
    const suggText = evalResult.suggestions.length > 0
      ? `\nSuggestions:\n${evalResult.suggestions.map(s => `- ${s}`).join("\n")}` : "";
    return `Visual evaluation score: ${evalResult.score}/10${issueText}${suggText}`;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "VLM eval error");
    return `ERROR: Visual evaluation failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
