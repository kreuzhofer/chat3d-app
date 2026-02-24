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
import { findSimilarExamples } from "./workbench-embeddings.service.js";

const MAX_FIX_ITERATIONS = 5;
const AUTO_APPROVE_THRESHOLD = 8;

/**
 * Code template that wraps LLM-generated modeling code.
 * The LLM produces only the Build123d modeling code ending with `root_part = ...`.
 * This template adds the import and all export calls around it.
 */
const CODE_TEMPLATE = `from build123d import *
###CODE###
export_step(root_part, "###FILENAME###.step")
exporter = Mesher()
exporter.add_shape(root_part)
exporter.write("###FILENAME###.3mf")
exporter.write("###FILENAME###.stl")
`;

/**
 * Wrap raw LLM-generated modeling code in the execution template.
 * The raw code is stored in the DB for training data; the wrapped version
 * is sent to Build123d for rendering.
 */
function wrapInTemplate(rawCode: string, baseFileName: string): string {
  return CODE_TEMPLATE
    .replace("###CODE###", rawCode)
    .replaceAll("###FILENAME###", baseFileName);
}

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
  const provider = config.workbench.codegenProvider as CodegenProvider;
  const modelName = config.workbench.codegenModelName;

  if (provider === "mock") {
    return { model: null, label: "mock" };
  }

  if (provider === "openai") {
    if (!config.query.openAiApiKey) {
      throw new WorkbenchSeederError("OPENAI_API_KEY is required for codegen", 500);
    }
    return {
      model: createOpenAI({ apiKey: config.query.openAiApiKey, baseURL: config.query.openAiBaseUrl })(modelName),
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
    "- Generate ONLY the Build123d modeling code. Do NOT include imports or exports.",
    "- Assign the final solid to `root_part` (e.g. `root_part = part.part`).",
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
    "Return only the corrected Build123d modeling code in a fenced code block.",
    "",
    "## Requirements",
    "- Generate ONLY the Build123d modeling code. Do NOT include imports or exports.",
    "- Assign the final solid to `root_part` (e.g. `root_part = part.part`).",
    "",
    `## Original request:`,
    userPrompt,
  );

  return sections.join("\n");
}

// ── Few-shot example retrieval ───────────────────────────────────────

/**
 * Fallback: category-scoped selection by eval score.
 * Used when vector search is unavailable (no embeddings or API error).
 */
async function fetchFewShotExamplesByCategory(categoryId: string, limit = 6): Promise<FewShotExample[]> {
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

/**
 * Primary: vector similarity search across all categories.
 * Falls back to category-scoped selection if vector search fails or returns empty.
 */
async function fetchFewShotExamples(
  promptText: string,
  categoryId: string,
  limit = 6,
): Promise<FewShotExample[]> {
  try {
    const results = await findSimilarExamples(promptText, limit);
    if (results.length > 0) {
      console.log(
        `[workbench] vector search returned ${results.length} examples ` +
        `(similarity: ${results[results.length - 1].similarity.toFixed(3)}–${results[0].similarity.toFixed(3)})`,
      );
      return results.map(({ prompt, code }) => ({ prompt, code }));
    }
    console.log(`[workbench] vector search returned 0 results, falling back to category query`);
  } catch (error) {
    console.warn(`[workbench] vector search failed, falling back to category query: ${error}`);
  }

  return fetchFewShotExamplesByCategory(categoryId, limit);
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

/**
 * Strip template boilerplate that the LLM might include despite instructions.
 * We want to store only the modeling code (no imports, no exports).
 */
function stripTemplateBoilerplate(code: string): string {
  return code
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === "from build123d import *") return false;
      if (trimmed.startsWith("export_step(")) return false;
      if (trimmed.startsWith("exporter = Mesher(")) return false;
      if (trimmed.startsWith("exporter.add_shape(")) return false;
      if (trimmed.startsWith("exporter.write(")) return false;
      return true;
    })
    .join("\n")
    .trim();
}

async function generateCode(
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providerModel: any,
): Promise<{ code: string; promptTokens: number; completionTokens: number }> {
  if (providerModel === null) {
    // Mock mode — raw modeling code only (no imports/exports)
    const code = `
# Simple box
with BuildPart() as part:
    Box(20, 20, 20)

root_part = part.part
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

  // Extract code from fenced block, then strip any boilerplate the LLM added
  const rawCode = extractExecutableCode(result.text);
  const cleanCode = stripTemplateBoilerplate(rawCode);

  return {
    code: cleanCode,
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
  console.log(`[workbench] ═══════════════════════════════════════════════════`);
  console.log(`[workbench] Starting generation for prompt ${promptId}`);

  // 1. Load context
  const ctx = await loadPromptContext(promptId);
  console.log(`[workbench] prompt="${ctx.prompt.slice(0, 80)}…" category=${ctx.categoryName} complexity=${ctx.complexity}`);

  const systemPromptRow = await getActiveSystemPrompt();
  console.log(`[workbench] system prompt loaded (${systemPromptRow.content.length} chars)`);

  const fewShots = await fetchFewShotExamples(ctx.prompt, ctx.categoryId);
  console.log(`[workbench] few-shot examples: ${fewShots.length}`);

  const { model: providerModel, label: llmModelLabel } = resolveCodegenModel();
  console.log(`[workbench] codegen model: ${llmModelLabel}`);

  let currentCode = "";
  let renderError: string | null = null;
  let evalResult: EvaluationResult | null = null;
  let renderedFiles: RenderedFile[] = [];
  let screenshots: RenderedScreenshot[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  // Track best successful result across iterations so we can fall back
  // if a fix attempt regresses the score.
  let best: {
    code: string;
    score: number;
    evalResult: EvaluationResult | null;
    stlFilename: string | null;
    stepFilename: string | null;
    screenshots: RenderedScreenshot[];
    iteration: number;
    promptTokens: number;
    completionTokens: number;
  } | null = null;

  for (let iteration = 1; iteration <= MAX_FIX_ITERATIONS; iteration++) {
    console.log(`[workbench] ── iteration ${iteration}/${MAX_FIX_ITERATIONS} ──`);

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

    console.log(`[workbench] LLM prompt length: ${prompt.length} chars`);
    if (iteration > 1) {
      const issues = evalResult?.issues ?? [];
      const suggestions = evalResult?.suggestions ?? [];
      console.log(`[workbench] fix feedback — issues: ${JSON.stringify(issues)}`);
      console.log(`[workbench] fix feedback — suggestions: ${JSON.stringify(suggestions)}`);
      if (renderError) console.log(`[workbench] fix feedback — renderError: ${renderError}`);
    }
    const codeResult = await generateCode(prompt, providerModel);
    currentCode = codeResult.code;
    totalPromptTokens += codeResult.promptTokens;
    totalCompletionTokens += codeResult.completionTokens;
    console.log(`[workbench] LLM returned code (${currentCode.length} chars, tokens: prompt=${codeResult.promptTokens} completion=${codeResult.completionTokens})`);

    // Reset per-iteration state
    renderError = null;
    evalResult = null;
    renderedFiles = [];
    screenshots = [];

    // 3. Render with Build123d — wrap raw code in template for execution
    const baseFileName = `wb-${ctx.promptId.slice(0, 8)}-iter${iteration}`;
    const executableCode = wrapInTemplate(currentCode, baseFileName);
    console.log(`[workbench] wrapped code for Build123d (${executableCode.length} chars):`);
    console.log(executableCode);
    try {
      const renderResult = await renderBuild123d({
        code: executableCode,
        baseFileName,
      });
      renderedFiles = renderResult.files;
      console.log(`[workbench] Build123d render success — ${renderedFiles.length} files: ${renderedFiles.map((f) => f.filename).join(", ")}`);
    } catch (error) {
      renderError = error instanceof Error ? error.message : String(error);
      console.warn(
        `[workbench] Render FAILED for prompt ${ctx.promptId} iteration ${iteration}: ${renderError}`,
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

    // 4. Screenshot via STL rendering service (STL only — faster, no ZIP decompression)
    const stlFile = findFileByExtension(renderedFiles, ".stl");
    if (stlFile) {
      console.log(`[workbench] sending stl to STL rendering service for screenshots (data length=${stlFile.contentBase64.length})`);
      try {
        const screenshotResult = await renderModelScreenshots({
          modelData: stlFile.contentBase64,
          format: "stl",
          width: 256,
          height: 256,
        });
        screenshots = screenshotResult.images;
        console.log(`[workbench] screenshots received: ${screenshots.map((s) => s.angle).join(", ")}`);
      } catch (error) {
        console.warn(
          `[workbench] Screenshot FAILED for prompt ${ctx.promptId} iteration ${iteration}: ${error}`,
        );
        // Continue with empty screenshots — VLM eval will score low
      }
    } else {
      console.warn(`[workbench] no STL file available — skipping screenshots`);
    }

    // 5. VLM Evaluate
    const imageBase64s = screenshots.map((s) => s.base64);
    console.log(`[workbench] VLM evaluation: ${imageBase64s.length} images to evaluate`);
    if (imageBase64s.length > 0) {
      evalResult = await evaluateModel({
        userPrompt: ctx.prompt,
        categoryName: ctx.categoryName,
        complexity: ctx.complexity,
        images: imageBase64s,
      });
      console.log(`[workbench] VLM result: score=${evalResult.score} looksCorrect=${evalResult.looksCorrect}`);
    } else {
      console.warn(`[workbench] skipping VLM evaluation — no screenshots`);
    }

    const stepFile = findFileByExtension(renderedFiles, ".step") ?? findFileByExtension(renderedFiles, ".stp");

    // 6. Track best result and decide whether to continue fixing
    const score = evalResult?.score ?? null;
    const approved = score !== null && score >= AUTO_APPROVE_THRESHOLD;
    const hasIssues = (evalResult?.issues ?? []).length > 0;
    console.log(`[workbench] score=${score} threshold=${AUTO_APPROVE_THRESHOLD} approved=${approved} hasIssues=${hasIssues} lastIteration=${iteration >= MAX_FIX_ITERATIONS}`);

    // Track the best successful result so we never regress
    if (score !== null && (best === null || score > best.score)) {
      best = {
        code: currentCode,
        score,
        evalResult,
        stlFilename: stlFile?.filename ?? null,
        stepFilename: stepFile?.filename ?? null,
        screenshots: [...screenshots],
        iteration,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
      };
      console.log(`[workbench] new best: score=${score} iteration=${iteration}`);
    }

    // Stop if: perfect score with no issues, or last iteration
    // Continue fixing if: below threshold, OR above threshold but VLM reported issues
    const shouldStop = (approved && !hasIssues) || iteration >= MAX_FIX_ITERATIONS;

    if (shouldStop) {
      // Use the best result across all iterations (guards against regressions)
      const final = best ?? {
        code: currentCode,
        score,
        evalResult,
        stlFilename: stlFile?.filename ?? null,
        stepFilename: stepFile?.filename ?? null,
        screenshots,
        iteration,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
      };
      const finalScore = final.score;
      const finalApproved = finalScore !== null && finalScore >= AUTO_APPROVE_THRESHOLD;

      const exampleId = await insertExample({
        promptId: ctx.promptId,
        iteration: final.iteration,
        code: final.code,
        renderStatus: "success",
        renderError: null,
        stlPath: final.stlFilename,
        stepPath: final.stepFilename,
        screenshotFront: findScreenshot(final.screenshots, "front"),
        screenshotTop: findScreenshot(final.screenshots, "top"),
        screenshotIso: findScreenshot(final.screenshots, "isometric"),
        evalScore: finalScore,
        evalIssues: final.evalResult?.issues ?? null,
        evalSuggestions: final.evalResult?.suggestions ?? null,
        approvalStatus: finalApproved ? "auto_approved" : "pending",
        llmModel: llmModelLabel,
        vlmModel: final.evalResult?.vlmModel ?? null,
        promptTokens: final.promptTokens,
        completionTokens: final.completionTokens,
      });

      console.log(
        `[workbench] prompt=${ctx.promptId} persisted iteration=${final.iteration} score=${finalScore} status=${finalApproved ? "auto_approved" : "pending"} (best of ${iteration} iterations)`,
      );

      return {
        exampleId,
        promptId: ctx.promptId,
        iteration: final.iteration,
        code: final.code,
        renderStatus: "success",
        renderError: null,
        evalScore: finalScore,
        evalIssues: final.evalResult?.issues ?? null,
        evalSuggestions: final.evalResult?.suggestions ?? null,
        approvalStatus: finalApproved ? "auto_approved" : "pending",
        llmModel: llmModelLabel,
        vlmModel: final.evalResult?.vlmModel ?? null,
      };
    }

    // Continue fixing — either below threshold or has issues to address
    console.log(
      `[workbench] prompt=${ctx.promptId} iteration=${iteration} score=${score} issues=${(evalResult?.issues ?? []).length} — retrying`,
    );
  }

  // Should not reach here, but just in case
  throw new Error("Unexpected end of generation pipeline");
}
