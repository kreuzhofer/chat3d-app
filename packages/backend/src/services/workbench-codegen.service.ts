/**
 * Workbench Code Generation Pipeline
 *
 * Single-prompt generation pipeline:
 *   system prompt + few-shot examples + user prompt
 *   → LLM codegen → Build123d render → STL screenshots → VLM evaluate
 *   → auto-approve or fix loop (up to MAX_FIX_ITERATIONS)
 */

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { config } from "../config.js";
import { pool } from "../db/connection.js";
import { extractExecutableCode } from "./llm.service.js";
import { renderBuild123d, type RenderedFile } from "./rendering.service.js";
import {
  renderModelScreenshots,
  type RenderedScreenshot,
} from "./stl-rendering-client.service.js";
import { evaluateModel, type EvaluationResult } from "./visual-eval.service.js";
import { getActiveSystemPrompt, WorkbenchSeederError } from "./workbench-seeder.service.js";

const MAX_FIX_ITERATIONS = 5;
const AUTO_APPROVE_THRESHOLD = 7;

// ── Types ────────────────────────────────────────────────────────────

export interface GenerateResult {
  exampleId: string;
  promptId: string;
  iteration: number;
  code: string;
  renderStatus: "success" | "error";
  renderError: string | null;
  evalScore: number | null;
  evalIssues: string[] | null;
  evalSuggestions: string[] | null;
  approvalStatus: "pending" | "auto_approved";
  llmModel: string;
  vlmModel: string | null;
}

interface PromptContext {
  promptId: string;
  prompt: string;
  categoryId: string;
  categoryName: string;
  complexity: number;
}

interface FewShotExample {
  prompt: string;
  code: string;
}

// ── Provider resolution ──────────────────────────────────────────────

type CodegenProvider = "mock" | "openai" | "anthropic" | "xai" | "ollama";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveCodegenModel(): { model: any; label: string } {
  const provider = config.query.codegenProvider as CodegenProvider;
  const modelName = config.query.codegenModelName;

  if (provider === "mock") {
    return { model: null, label: "mock" };
  }

  if (provider === "openai") {
    if (!config.query.openAiApiKey) {
      throw new WorkbenchSeederError("OPENAI_API_KEY is required for codegen", 500);
    }
    return {
      model: createOpenAI({ apiKey: config.query.openAiApiKey })(modelName),
      label: `openai/${modelName}`,
    };
  }

  if (provider === "anthropic") {
    if (!config.query.anthropicApiKey) {
      throw new WorkbenchSeederError("ANTHROPIC_API_KEY is required for codegen", 500);
    }
    return {
      model: createAnthropic({ apiKey: config.query.anthropicApiKey })(modelName),
      label: `anthropic/${modelName}`,
    };
  }

  if (provider === "xai") {
    if (!config.query.xaiApiKey) {
      throw new WorkbenchSeederError("XAI_API_KEY is required for codegen", 500);
    }
    return {
      model: createXai({ apiKey: config.query.xaiApiKey })(modelName),
      label: `xai/${modelName}`,
    };
  }

  if (provider === "ollama") {
    const normalizedBaseUrl = config.query.ollamaBaseUrl.replace(/\/+$/, "");
    const baseUrlWithVersion = normalizedBaseUrl.endsWith("/v1")
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1`;
    const ollama = createOpenAICompatible({
      name: "ollama",
      baseURL: baseUrlWithVersion,
      apiKey: config.query.ollamaToken.trim() === "" ? undefined : config.query.ollamaToken.trim(),
    });
    return {
      model: ollama.chatModel(modelName),
      label: `ollama/${modelName}`,
    };
  }

  throw new WorkbenchSeederError(`Unsupported codegen provider: ${provider}`, 500);
}

// ── Prompt building ──────────────────────────────────────────────────

function buildInitialPrompt(
  systemPromptContent: string,
  fewShots: FewShotExample[],
  userPrompt: string,
): string {
  const sections: string[] = [systemPromptContent, ""];

  if (fewShots.length > 0) {
    sections.push("## Approved Examples for Reference", "");
    for (const example of fewShots) {
      sections.push(
        `### User request: "${example.prompt}"`,
        "```python",
        example.code,
        "```",
        "",
      );
    }
  }

  sections.push(
    "## Requirements",
    "- Export one STEP file using export_step(). Use any reasonable filename.",
    "- Code must be executable as-is with no missing imports.",
    "- Use only Build123d classes and functions from the reference above.",
    "",
    `User request: ${userPrompt}`,
  );

  return sections.join("\n");
}

function buildFixPrompt(
  systemPromptContent: string,
  fewShots: FewShotExample[],
  userPrompt: string,
  failedCode: string,
  iteration: number,
  renderError: string | null,
  evalIssues: string[] | null,
  evalSuggestions: string[] | null,
): string {
  const sections: string[] = [systemPromptContent, ""];

  if (fewShots.length > 0) {
    sections.push("## Approved Examples for Reference", "");
    for (const example of fewShots) {
      sections.push(
        `### User request: "${example.prompt}"`,
        "```python",
        example.code,
        "```",
        "",
      );
    }
  }

  sections.push(
    `## Previous code (attempt ${iteration}):`,
    "```python",
    failedCode,
    "```",
    "",
    "## Problems to fix:",
  );

  if (renderError) {
    sections.push(`- Render error: ${renderError}`);
  }
  if (evalIssues && evalIssues.length > 0) {
    for (const issue of evalIssues) {
      sections.push(`- ${issue}`);
    }
  }

  sections.push("");

  if (evalSuggestions && evalSuggestions.length > 0) {
    sections.push("## Suggested corrections:");
    for (const suggestion of evalSuggestions) {
      sections.push(`- ${suggestion}`);
    }
    sections.push("");
  }

  sections.push(
    "Fix the code. Preserve the intended geometry described in the original request.",
    "Return only the corrected Python code in a fenced code block.",
    "",
    "## Requirements",
    "- Export one STEP file using export_step(). Use any reasonable filename.",
    "- Code must be executable as-is with no missing imports.",
    "",
    `## Original request:`,
    userPrompt,
  );

  return sections.join("\n");
}

// ── Few-shot example retrieval ───────────────────────────────────────

async function fetchFewShotExamples(categoryId: string, limit = 6): Promise<FewShotExample[]> {
  const result = await pool.query<{ prompt: string; code: string }>(
    `SELECT p.prompt, e.code
     FROM workbench_examples e
     JOIN workbench_example_prompts p ON p.id = e.prompt_id
     WHERE p.category_id = $1
       AND e.approval_status IN ('auto_approved', 'human_approved')
     ORDER BY e.eval_score DESC NULLS LAST, e.created_at DESC
     LIMIT $2`,
    [categoryId, limit],
  );
  return result.rows;
}

// ── Prompt context loading ───────────────────────────────────────────

async function loadPromptContext(promptId: string): Promise<PromptContext> {
  const result = await pool.query<{
    prompt_id: string;
    prompt: string;
    category_id: string;
    category_name: string;
    complexity: number;
  }>(
    `SELECT p.id AS prompt_id, p.prompt, c.id AS category_id, c.name AS category_name, c.complexity
     FROM workbench_example_prompts p
     JOIN workbench_categories c ON c.id = p.category_id
     WHERE p.id = $1`,
    [promptId],
  );

  if (result.rows.length === 0) {
    throw new WorkbenchSeederError("Prompt not found", 404);
  }

  const row = result.rows[0];
  return {
    promptId: row.prompt_id,
    prompt: row.prompt,
    categoryId: row.category_id,
    categoryName: row.category_name,
    complexity: row.complexity,
  };
}

// ── DB persistence ───────────────────────────────────────────────────

async function insertExample(data: {
  promptId: string;
  iteration: number;
  code: string;
  renderStatus: string;
  renderError: string | null;
  stlPath: string | null;
  stepPath: string | null;
  screenshotFront: string | null;
  screenshotTop: string | null;
  screenshotIso: string | null;
  evalScore: number | null;
  evalIssues: string[] | null;
  evalSuggestions: string[] | null;
  approvalStatus: string;
  llmModel: string;
  vlmModel: string | null;
  promptTokens: number;
  completionTokens: number;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO workbench_examples (
       prompt_id, iteration, code, render_status, render_error,
       stl_path, step_path,
       screenshot_front, screenshot_top, screenshot_iso,
       eval_score, eval_issues, eval_suggestions,
       approval_status, llm_model, vlm_model,
       prompt_tokens, completion_tokens
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING id`,
    [
      data.promptId,
      data.iteration,
      data.code,
      data.renderStatus,
      data.renderError,
      data.stlPath,
      data.stepPath,
      data.screenshotFront,
      data.screenshotTop,
      data.screenshotIso,
      data.evalScore,
      data.evalIssues ? JSON.stringify(data.evalIssues) : null,
      data.evalSuggestions ? JSON.stringify(data.evalSuggestions) : null,
      data.approvalStatus,
      data.llmModel,
      data.vlmModel,
      data.promptTokens,
      data.completionTokens,
    ],
  );
  return result.rows[0].id;
}

// ── Code generation ──────────────────────────────────────────────────

async function generateCode(
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providerModel: any,
): Promise<{ code: string; promptTokens: number; completionTokens: number }> {
  if (providerModel === null) {
    // Mock mode
    const code = `
from build123d import *
with BuildPart() as model:
    Box(20, 20, 20)
export_step(model.part, "model.step")
    `.trim();
    return { code, promptTokens: 0, completionTokens: 0 };
  }

  const result = await generateText({
    model: providerModel,
    prompt,
  });

  if (!result.text || result.text.trim() === "") {
    throw new Error("LLM returned empty output");
  }

  return {
    code: extractExecutableCode(result.text),
    promptTokens: result.usage?.promptTokens ?? 0,
    completionTokens: result.usage?.completionTokens ?? 0,
  };
}

// ── Screenshot extraction helper ─────────────────────────────────────

function findScreenshot(
  images: RenderedScreenshot[],
  angle: "front" | "top" | "isometric",
): string | null {
  return images.find((img) => img.angle === angle)?.base64 ?? null;
}

// ── Find STL file from Build123d render output ───────────────────────

function findFileByExtension(files: RenderedFile[], ext: string): RenderedFile | undefined {
  return files.find((f) => f.filename.toLowerCase().endsWith(ext));
}

// ── Main pipeline ────────────────────────────────────────────────────

export async function generateForPrompt(promptId: string): Promise<GenerateResult> {
  // 1. Load context
  const ctx = await loadPromptContext(promptId);
  const systemPromptRow = await getActiveSystemPrompt();
  const fewShots = await fetchFewShotExamples(ctx.categoryId);
  const { model: providerModel, label: llmModelLabel } = resolveCodegenModel();

  let currentCode = "";
  let renderError: string | null = null;
  let evalResult: EvaluationResult | null = null;
  let renderedFiles: RenderedFile[] = [];
  let screenshots: RenderedScreenshot[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  for (let iteration = 1; iteration <= MAX_FIX_ITERATIONS; iteration++) {
    // 2. Generate code
    const prompt =
      iteration === 1
        ? buildInitialPrompt(systemPromptRow.content, fewShots, ctx.prompt)
        : buildFixPrompt(
            systemPromptRow.content,
            fewShots,
            ctx.prompt,
            currentCode,
            iteration - 1,
            renderError,
            evalResult?.issues ?? null,
            evalResult?.suggestions ?? null,
          );

    const codeResult = await generateCode(prompt, providerModel);
    currentCode = codeResult.code;
    totalPromptTokens += codeResult.promptTokens;
    totalCompletionTokens += codeResult.completionTokens;

    // Reset per-iteration state
    renderError = null;
    evalResult = null;
    renderedFiles = [];
    screenshots = [];

    // 3. Render with Build123d
    try {
      const renderResult = await renderBuild123d({
        code: currentCode,
        baseFileName: `wb-${ctx.promptId.slice(0, 8)}-iter${iteration}`,
      });
      renderedFiles = renderResult.files;
    } catch (error) {
      renderError = error instanceof Error ? error.message : String(error);
      console.warn(
        `[workbench] Render failed for prompt ${ctx.promptId} iteration ${iteration}: ${renderError}`,
      );

      // If this is the last iteration, persist the failure and return
      if (iteration >= MAX_FIX_ITERATIONS) {
        const exampleId = await insertExample({
          promptId: ctx.promptId,
          iteration,
          code: currentCode,
          renderStatus: "error",
          renderError,
          stlPath: null,
          stepPath: null,
          screenshotFront: null,
          screenshotTop: null,
          screenshotIso: null,
          evalScore: null,
          evalIssues: null,
          evalSuggestions: null,
          approvalStatus: "pending",
          llmModel: llmModelLabel,
          vlmModel: null,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
        });

        return {
          exampleId,
          promptId: ctx.promptId,
          iteration,
          code: currentCode,
          renderStatus: "error",
          renderError,
          evalScore: null,
          evalIssues: null,
          evalSuggestions: null,
          approvalStatus: "pending",
          llmModel: llmModelLabel,
          vlmModel: null,
        };
      }

      // Otherwise, loop back for fix attempt
      continue;
    }

    // 4. Screenshot via STL rendering service
    const stlFile = findFileByExtension(renderedFiles, ".stl");
    const threemfFile = findFileByExtension(renderedFiles, ".3mf");

    // Prefer 3MF (preserves color), fall back to STL
    const modelFile = threemfFile ?? stlFile;
    if (modelFile) {
      try {
        const format = threemfFile ? "3mf" as const : "stl" as const;
        const screenshotResult = await renderModelScreenshots({
          modelData: modelFile.contentBase64,
          format,
        });
        screenshots = screenshotResult.images;
      } catch (error) {
        console.warn(
          `[workbench] Screenshot failed for prompt ${ctx.promptId} iteration ${iteration}: ${error}`,
        );
        // Continue with empty screenshots — VLM eval will score low
      }
    }

    // 5. VLM Evaluate
    const imageBase64s = screenshots.map((s) => s.base64);
    if (imageBase64s.length > 0) {
      evalResult = await evaluateModel({
        userPrompt: ctx.prompt,
        categoryName: ctx.categoryName,
        complexity: ctx.complexity,
        images: imageBase64s,
      });
    }

    const stepFile = findFileByExtension(renderedFiles, ".step") ?? findFileByExtension(renderedFiles, ".stp");

    // 6. Check auto-approval
    const score = evalResult?.score ?? null;
    const approved = score !== null && score >= AUTO_APPROVE_THRESHOLD;

    if (approved || iteration >= MAX_FIX_ITERATIONS) {
      const exampleId = await insertExample({
        promptId: ctx.promptId,
        iteration,
        code: currentCode,
        renderStatus: "success",
        renderError: null,
        stlPath: stlFile?.filename ?? null,
        stepPath: stepFile?.filename ?? null,
        screenshotFront: findScreenshot(screenshots, "front"),
        screenshotTop: findScreenshot(screenshots, "top"),
        screenshotIso: findScreenshot(screenshots, "isometric"),
        evalScore: score,
        evalIssues: evalResult?.issues ?? null,
        evalSuggestions: evalResult?.suggestions ?? null,
        approvalStatus: approved ? "auto_approved" : "pending",
        llmModel: llmModelLabel,
        vlmModel: evalResult?.vlmModel ?? null,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
      });

      console.log(
        `[workbench] prompt=${ctx.promptId} iteration=${iteration} score=${score} status=${approved ? "auto_approved" : "pending"}`,
      );

      return {
        exampleId,
        promptId: ctx.promptId,
        iteration,
        code: currentCode,
        renderStatus: "success",
        renderError: null,
        evalScore: score,
        evalIssues: evalResult?.issues ?? null,
        evalSuggestions: evalResult?.suggestions ?? null,
        approvalStatus: approved ? "auto_approved" : "pending",
        llmModel: llmModelLabel,
        vlmModel: evalResult?.vlmModel ?? null,
      };
    }

    // Score < threshold — loop back for fix
    console.log(
      `[workbench] prompt=${ctx.promptId} iteration=${iteration} score=${score} — retrying`,
    );
  }

  // Should not reach here, but just in case
  throw new Error("Unexpected end of generation pipeline");
}
