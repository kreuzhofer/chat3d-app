/**
 * Workbench Code Generation Pipeline
 *
 * Single-prompt generation pipeline:
 *   system prompt + few-shot examples + user prompt
 *   → LLM codegen → Build123d render → STL screenshots → VLM evaluate
 *   → auto-approve or fix loop (up to MAX_FIX_ITERATIONS)
 */

import { generateText } from "ai";
import { asQuotaError } from "../utils/llm-errors.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import { withLlmRetry } from "../utils/llm-retry.js";
import { createLogger } from "../utils/logger.js";
import { pool } from "../db/connection.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  buildGenerateOptions,
  calculateCostUsd,
  type LlmModelConfig,
} from "./llm-config.service.js";

const logger = createLogger("workbench");
import { extractExecutableCode } from "./llm.service.js";
import { renderBuild123d, type RenderedFile } from "./rendering.service.js";
import {
  renderModelScreenshots,
  type RenderedScreenshot,
} from "./stl-rendering-client.service.js";
import { evaluateModel, type EvaluationResult } from "./visual-eval.service.js";
import { getActiveSystemPrompt, WorkbenchSeederError } from "./workbench-seeder.service.js";
import { findSimilarExamples } from "./workbench-embeddings.service.js";
import { validatePrompt } from "./workbench-prompt-validation.service.js";
import {
  classifyRenderError,
  buildEscalatedGuidance,
  renderWithInfraRetry,
  type ClassifiedRenderError,
  type RenderErrorContext,
} from "../utils/render-errors.js";
import { writeStorageFile } from "./file-storage.service.js";
import crypto from "node:crypto";

export const MAX_FIX_ITERATIONS = 5;
export const AUTO_APPROVE_THRESHOLD = 8;

/** Timeout for a single LLM generateText call (5 minutes). */
const LLM_CALL_TIMEOUT_MS = 5 * 60 * 1000;

/** Timeout for the entire per-prompt pipeline including all iterations (15 minutes). */
const PIPELINE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Code template that wraps LLM-generated modeling code.
 * The LLM produces only the Build123d modeling code ending with `root_part = ...`.
 * This template adds the import and all export calls around it.
 */
const CODE_TEMPLATE = `from build123d import *
import math
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
export function wrapInTemplate(rawCode: string, baseFileName: string): string {
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
  approvalStatus: "pending" | "auto_approved" | "rejected";
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

export interface FewShotExample {
  prompt: string;
  code: string;
}

// ── Provider resolution ──────────────────────────────────────────────

/**
 * Resolve the codegen model from the DB-driven llm_purpose_map.
 * Returns the Vercel AI SDK model instance, label, and full config (for cost calculation).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveCodegenModel(): Promise<{ model: any; label: string; config: LlmModelConfig }> {
  const cfg = await getModelForPurpose("workbench_codegen");
  const model = createProviderModelFromConfig(cfg);
  return { model, label: cfg.label, config: cfg };
}

// ── Prompt building ──────────────────────────────────────────────────

export function buildInitialPrompt(
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
    "- Generate ONLY the Build123d modeling code. Do NOT include `from build123d import *` or export calls. The template pre-imports `math`. You may also import `itertools`, `functools`, `copy`, or `numpy`.",
    "- Assign the final solid to `root_part` (e.g. `root_part = part.part`).",
    "- Use only Build123d classes and functions from the reference above.",
    "",
    `User request: ${userPrompt}`,
  );

  return sections.join("\n");
}

export function buildFixPrompt(
  systemPromptContent: string,
  fewShots: FewShotExample[],
  userPrompt: string,
  failedCode: string,
  iteration: number,
  renderError: string | null,
  evalIssues: string[] | null,
  evalSuggestions: string[] | null,
  renderErrorContext?: RenderErrorContext | null,
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

  // When classified error context is available, inject category + raw error + guidance
  if (renderErrorContext) {
    const { classified, escalationGuidance } = renderErrorContext;
    sections.push(`- Render error (${classified.category}): ${classified.rawMessage}`);
    // Inject domain-specific fix guidance
    const guidance = escalationGuidance ?? classified.fixGuidance;
    if (guidance) {
      sections.push("", "## Fix guidance:", guidance);
    }
  } else if (renderError) {
    // Fallback: raw error string (backward compatibility)
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
    "- Generate ONLY the Build123d modeling code. Do NOT include `from build123d import *` or export calls. The template pre-imports `math`. You may also import `itertools`, `functools`, `copy`, or `numpy`.",
    "- Assign the final solid to `root_part` (e.g. `root_part = part.part`).",
    "",
    `## Original request:`,
    userPrompt,
  );

  return sections.join("\n");
}

/**
 * Build a prompt for modifying existing working code based on a user's
 * follow-up request in chat. Unlike `buildFixPrompt` (which addresses
 * render errors or VLM-identified issues), this prompt frames the
 * previous code as a *working baseline* and instructs the LLM to make
 * targeted modifications while preserving all unrelated geometry.
 */
export function buildModificationPrompt(
  systemPromptContent: string,
  fewShots: FewShotExample[],
  userPrompt: string,
  baselineCode: string,
  conversationSummary: string,
  conversationHistory?: string,
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
    "## Working Baseline Code",
    "The following Build123d code produces a working 3D model. Your task is to MODIFY",
    "this code to incorporate the user's requested changes while PRESERVING all existing",
    "geometry, features, and structure that the user has not asked to change.",
    "```python",
    baselineCode,
    "```",
    "",
  );

  if (conversationSummary) {
    sections.push(
      "## Conversation Context",
      conversationSummary,
      "",
    );
  }

  if (conversationHistory) {
    sections.push(conversationHistory, "");
  }

  sections.push(
    "## Modification Request",
    userPrompt,
    "",
    "## Requirements",
    "- Generate ONLY the Build123d modeling code. Do NOT include `from build123d import *` or export calls. The template pre-imports `math`. You may also import `itertools`, `functools`, `copy`, or `numpy`.",
    "- Assign the final solid to `root_part` (e.g. `root_part = part.part`).",
    "- Use only Build123d classes and functions from the reference above.",
    "- IMPORTANT: Start from the baseline code above and make targeted modifications. Do NOT rewrite from scratch. Preserve all working geometry, dimensions, and features unless the user explicitly asked to change them.",
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
      logger.info(
        { count: results.length, similarityMin: results[results.length - 1].similarity.toFixed(3), similarityMax: results[0].similarity.toFixed(3) },
        "vector search returned examples",
      );
      return results.map(({ prompt, code }) => ({ prompt, code }));
    }
    logger.info("vector search returned 0 results, falling back to category query");
  } catch (error) {
    logger.warn({ err: error }, "vector search failed, falling back to category query");
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
  id: string;
  promptId: string;
  iteration: number;
  code: string;
  renderStatus: string;
  renderError: string | null;
  stlPath: string | null;
  stepPath: string | null;
  threemfPath: string | null;
  screenshotFront: string | null;
  screenshotBack: string | null;
  screenshotLeft: string | null;
  screenshotRight: string | null;
  screenshotTop: string | null;
  screenshotBottom: string | null;
  screenshotOrtho45: string | null;
  screenshotOrtho45Bottom: string | null;
  screenshotIso: string | null;
  screenshotIsoBack: string | null;
  evalScore: number | null;
  evalIssues: string[] | null;
  evalSuggestions: string[] | null;
  approvalStatus: string;
  rejectionNote?: string | null;
  llmModel: string;
  vlmModel: string | null;
  promptTokens: number;
  completionTokens: number;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO workbench_examples (
       id, prompt_id, iteration, code, render_status, render_error,
       stl_path, step_path, threemf_path,
       screenshot_front, screenshot_back, screenshot_left, screenshot_right,
       screenshot_top, screenshot_bottom, screenshot_ortho_45, screenshot_ortho_45_bottom,
       screenshot_iso, screenshot_iso_back,
       eval_score, eval_issues, eval_suggestions,
       approval_status, rejection_note, llm_model, vlm_model,
       prompt_tokens, completion_tokens
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
     RETURNING id`,
    [
      data.id,
      data.promptId,
      data.iteration,
      data.code,
      data.renderStatus,
      data.renderError,
      data.stlPath,
      data.stepPath,
      data.threemfPath,
      data.screenshotFront,
      data.screenshotBack,
      data.screenshotLeft,
      data.screenshotRight,
      data.screenshotTop,
      data.screenshotBottom,
      data.screenshotOrtho45,
      data.screenshotOrtho45Bottom,
      data.screenshotIso,
      data.screenshotIsoBack,
      data.evalScore,
      data.evalIssues ? JSON.stringify(data.evalIssues) : null,
      data.evalSuggestions ? JSON.stringify(data.evalSuggestions) : null,
      data.approvalStatus,
      data.rejectionNote ?? null,
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
export function stripTemplateBoilerplate(code: string): string {
  return code
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === "from build123d import *") return false;
      if (trimmed === "import math") return false;
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
  modelConfig?: LlmModelConfig,
  pipelineSignal?: AbortSignal,
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

  const extraOpts = modelConfig ? buildGenerateOptions(modelConfig) : {};

  if (modelConfig) {
    logger.info(
      { provider: modelConfig.provider, model: modelConfig.modelName, thinkingEffort: modelConfig.thinkingEffort, supportsThinking: modelConfig.supportsThinking, extraOpts },
      "workbench generateText call options",
    );
  }

  // Wrap with per-provider semaphore + rate limit retry
  const doGenerate = () =>
    withLlmRetry(async () => {
      // Combine per-call timeout with optional pipeline-level signal
      const callController = new AbortController();
      const callTimeout = setTimeout(() => callController.abort(), LLM_CALL_TIMEOUT_MS);

      // If the pipeline-level signal fires, abort this call too
      const onPipelineAbort = () => callController.abort();
      pipelineSignal?.addEventListener("abort", onPipelineAbort, { once: true });

      try {
        return await generateText({
          model: providerModel,
          prompt,
          abortSignal: callController.signal,
          ...extraOpts,
        });
      } catch (error) {
        if (callController.signal.aborted) {
          const reason = pipelineSignal?.aborted
            ? `Pipeline timeout (${PIPELINE_TIMEOUT_MS / 1000}s)`
            : `LLM call timeout (${LLM_CALL_TIMEOUT_MS / 1000}s)`;
          throw new Error(reason);
        }
        throw error;
      } finally {
        clearTimeout(callTimeout);
        pipelineSignal?.removeEventListener("abort", onPipelineAbort);
      }
    }, { provider: modelConfig?.provider });

  const semaphore = modelConfig
    ? getLlmSemaphore(modelConfig.provider, modelConfig.maxConcurrent)
    : null;
  const result = semaphore
    ? await semaphore.run(doGenerate)
    : await doGenerate();

  if (result.reasoningText) {
    logger.info(
      { provider: modelConfig?.provider, model: modelConfig?.modelName, reasoningLength: result.reasoningText.length },
      "workbench thinking output received",
    );
    logger.trace(
      { provider: modelConfig?.provider, model: modelConfig?.modelName, reasoning: result.reasoningText },
      "workbench thinking output content",
    );
  } else {
    logger.debug(
      { provider: modelConfig?.provider, model: modelConfig?.modelName, reasoningBlocks: result.reasoning?.length ?? 0 },
      "no thinking output in workbench response",
    );
  }

  if (!result.text || result.text.trim() === "") {
    throw new Error("LLM returned empty output");
  }

  // Extract code from fenced block, then strip any boilerplate the LLM added
  const rawCode = extractExecutableCode(result.text);
  const cleanCode = stripTemplateBoilerplate(rawCode);

  return {
    code: cleanCode,
    promptTokens: result.usage?.inputTokens ?? 0,
    completionTokens: result.usage?.outputTokens ?? 0,
  };
}

// ── Screenshot extraction helper ─────────────────────────────────────

function findScreenshot(
  images: RenderedScreenshot[],
  angle: string,
): string | null {
  return images.find((img) => img.angle === angle)?.base64 ?? null;
}

// ── Find STL file from Build123d render output ───────────────────────

function findFileByExtension(files: RenderedFile[], ext: string): RenderedFile | undefined {
  return files.find((f) => f.filename.toLowerCase().endsWith(ext));
}

function mapExtension(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".stl")) return "stl";
  if (lower.endsWith(".step") || lower.endsWith(".stp")) return "step";
  if (lower.endsWith(".3mf")) return "3mf";
  if (lower.endsWith(".b123d")) return "b123d";
  return "bin";
}

/**
 * Persist rendered files and screenshots to domain-scoped storage.
 * Returns the relative paths stored in the workbench directory.
 */
interface PersistedFilePaths {
  stlPath: string | null;
  stepPath: string | null;
  threemfPath: string | null;
  screenshotFrontPath: string | null;
  screenshotBackPath: string | null;
  screenshotLeftPath: string | null;
  screenshotRightPath: string | null;
  screenshotTopPath: string | null;
  screenshotBottomPath: string | null;
  screenshotOrtho45Path: string | null;
  screenshotOrtho45BottomPath: string | null;
  screenshotIsoPath: string | null;
  screenshotIsoBackPath: string | null;
}

async function persistWorkbenchFiles(opts: {
  categoryId: string;
  exampleId: string;
  renderedFiles: RenderedFile[];
  code: string;
  screenshots: RenderedScreenshot[];
}): Promise<PersistedFilePaths> {
  const prefix = `workbench/${opts.categoryId}/${opts.exampleId}`;

  // Persist rendered 3D files
  let stlPath: string | null = null;
  let stepPath: string | null = null;
  let threemfPath: string | null = null;

  for (const file of opts.renderedFiles) {
    const ext = mapExtension(file.filename);
    const relativePath = `${prefix}.${ext}`;
    await writeStorageFile({ relativePath, contentBase64: file.contentBase64 });
    if (ext === "stl") stlPath = relativePath;
    else if (ext === "step") stepPath = relativePath;
    else if (ext === "3mf") threemfPath = relativePath;
  }

  // Persist code as .b123d
  if (opts.code.trim()) {
    await writeStorageFile({
      relativePath: `${prefix}.b123d`,
      contentBase64: Buffer.from(opts.code, "utf-8").toString("base64"),
    });
  }

  // Persist screenshots — map angle names to file paths
  const pathsByAngle: Record<string, string> = {};
  for (const ss of opts.screenshots) {
    const ssPath = `${prefix}-screenshot-${ss.angle}.png`;
    await writeStorageFile({ relativePath: ssPath, contentBase64: ss.base64 });
    pathsByAngle[ss.angle] = ssPath;
  }

  return {
    stlPath,
    stepPath,
    threemfPath,
    screenshotFrontPath: pathsByAngle["front"] ?? null,
    screenshotBackPath: pathsByAngle["back"] ?? null,
    screenshotLeftPath: pathsByAngle["left"] ?? null,
    screenshotRightPath: pathsByAngle["right"] ?? null,
    screenshotTopPath: pathsByAngle["top"] ?? null,
    screenshotBottomPath: pathsByAngle["bottom"] ?? null,
    screenshotOrtho45Path: pathsByAngle["ortho_45"] ?? null,
    screenshotOrtho45BottomPath: pathsByAngle["ortho_45_bottom"] ?? null,
    screenshotIsoPath: pathsByAngle["isometric"] ?? null,
    screenshotIsoBackPath: pathsByAngle["isometric_back"] ?? null,
  };
}

// ── Main pipeline ────────────────────────────────────────────────────

export async function generateForPrompt(promptId: string): Promise<GenerateResult> {
  logger.info({ promptId }, "starting generation for prompt");

  // Pipeline-level timeout — aborts the entire pipeline if it takes too long
  const pipelineController = new AbortController();
  const pipelineTimeout = setTimeout(() => pipelineController.abort(), PIPELINE_TIMEOUT_MS);

  try {
    return await _generateForPromptInner(promptId, pipelineController.signal);
  } finally {
    clearTimeout(pipelineTimeout);
  }
}

async function _generateForPromptInner(promptId: string, pipelineSignal: AbortSignal): Promise<GenerateResult> {

  // 1. Load context and resolve model
  const ctx = await loadPromptContext(promptId);
  logger.info({ prompt: ctx.prompt.slice(0, 80), category: ctx.categoryName, complexity: ctx.complexity }, "loaded prompt context");

  const { model: providerModel, label: llmModelLabel, config: codegenConfig } = await resolveCodegenModel();
  logger.info({ model: llmModelLabel }, "codegen model resolved");

  // 2. Validate prompt before expensive codegen pipeline
  const validation = await validatePrompt(ctx.prompt);
  if (!validation.valid) {
    logger.info({ reason: validation.reason }, "prompt rejected by validation");
    const exampleId = crypto.randomUUID();
    await insertExample({
      id: exampleId,
      promptId: ctx.promptId,
      iteration: 0,
      code: "-- PROMPT VALIDATION REJECTED --",
      renderStatus: "error",
      renderError: `Prompt validation failed: ${validation.reason}`,
      stlPath: null,
      stepPath: null,
      threemfPath: null,
      screenshotFront: null,
      screenshotBack: null,
      screenshotLeft: null,
      screenshotRight: null,
      screenshotTop: null,
      screenshotBottom: null,
      screenshotOrtho45: null,
      screenshotOrtho45Bottom: null,
      screenshotIso: null,
      screenshotIsoBack: null,
      evalScore: null,
      evalIssues: null,
      evalSuggestions: null,
      approvalStatus: "rejected",
      rejectionNote: validation.reason,
      llmModel: llmModelLabel,
      vlmModel: null,
      promptTokens: validation.promptTokens,
      completionTokens: validation.completionTokens,
    });
    return {
      exampleId,
      promptId: ctx.promptId,
      iteration: 0,
      code: "-- PROMPT VALIDATION REJECTED --",
      renderStatus: "error",
      renderError: `Prompt validation failed: ${validation.reason}`,
      evalScore: null,
      evalIssues: null,
      evalSuggestions: null,
      approvalStatus: "rejected",
      llmModel: llmModelLabel,
      vlmModel: null,
    };
  }

  // 3. Load system prompt and few-shot examples
  const systemPromptRow = await getActiveSystemPrompt();
  logger.info({ chars: systemPromptRow.content.length }, "system prompt loaded");

  const fewShots = await fetchFewShotExamples(ctx.prompt, ctx.categoryId);
  logger.info({ count: fewShots.length }, "few-shot examples loaded");

  let currentCode = "";
  let renderError: string | null = null;
  let renderErrorCtx: RenderErrorContext | null = null;
  let evalResult: EvaluationResult | null = null;
  let renderedFiles: RenderedFile[] = [];
  let screenshots: RenderedScreenshot[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  // Track classified render errors across iterations for escalation logic
  const errorHistory: ClassifiedRenderError[] = [];

  // Track best successful result across iterations so we can fall back
  // if a fix attempt regresses the score.
  let best: {
    code: string;
    score: number;
    evalResult: EvaluationResult | null;
    screenshots: RenderedScreenshot[];
    iteration: number;
    promptTokens: number;
    completionTokens: number;
  } | null = null;

  for (let iteration = 1; iteration <= MAX_FIX_ITERATIONS; iteration++) {
    logger.info({ iteration, maxIterations: MAX_FIX_ITERATIONS }, "starting iteration");

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
            renderErrorCtx,
          );

    logger.info({ promptChars: prompt.length }, "LLM prompt built");
    if (iteration > 1) {
      const issues = evalResult?.issues ?? [];
      const suggestions = evalResult?.suggestions ?? [];
      logger.info({ issues, suggestions }, "fix feedback — issues and suggestions");
      if (renderError) logger.info({ renderError, category: renderErrorCtx?.classified.category ?? "none" }, "fix feedback — render error");
    }
    const codeResult = await generateCode(prompt, providerModel, codegenConfig, pipelineSignal);
    currentCode = codeResult.code;
    totalPromptTokens += codeResult.promptTokens;
    totalCompletionTokens += codeResult.completionTokens;
    logger.info({ codeChars: currentCode.length, promptTokens: codeResult.promptTokens, completionTokens: codeResult.completionTokens }, "LLM returned code");

    // Reset per-iteration state
    renderError = null;
    renderErrorCtx = null;
    evalResult = null;
    renderedFiles = [];
    screenshots = [];

    // 3. Render with Build123d — wrap raw code in template for execution
    //    Uses infrastructure retry to avoid wasting iterations on service hiccups.
    const baseFileName = `wb-${ctx.promptId.slice(0, 8)}-iter${iteration}`;
    const executableCode = wrapInTemplate(currentCode, baseFileName);
    logger.debug({ code: executableCode }, "executable code for Build123d");

    const renderOutcome = await renderWithInfraRetry(
      () => renderBuild123d({ code: executableCode, baseFileName }),
      {
        onRetry: (attempt, classified) => {
          logger.info(
            { attempt, category: classified.category, promptId: ctx.promptId, iteration },
            "infrastructure retry for Build123d",
          );
        },
      },
    );

    if (renderOutcome.ok) {
      renderedFiles = renderOutcome.result.files;
      logger.info({ fileCount: renderedFiles.length, files: renderedFiles.map((f) => f.filename) }, "Build123d render success");
    } else {
      // Classify and track the render error
      const classified = renderOutcome.error;
      errorHistory.push(classified);
      renderError = classified.rawMessage;
      const escalation = buildEscalatedGuidance(classified, errorHistory.slice(0, -1));
      renderErrorCtx = { classified, escalationGuidance: escalation };
      logger.warn(
        { promptId: ctx.promptId, iteration, renderError, category: classified.category },
        "render failed",
      );

      // If this is the last iteration, persist the failure and return
      if (iteration >= MAX_FIX_ITERATIONS) {
        const exampleId = crypto.randomUUID();
        await insertExample({
          id: exampleId,
          promptId: ctx.promptId,
          iteration,
          code: currentCode,
          renderStatus: "error",
          renderError,
          stlPath: null,
          stepPath: null,
          threemfPath: null,
          screenshotFront: null,
          screenshotBack: null,
          screenshotLeft: null,
          screenshotRight: null,
          screenshotTop: null,
          screenshotBottom: null,
          screenshotOrtho45: null,
          screenshotOrtho45Bottom: null,
          screenshotIso: null,
          screenshotIsoBack: null,
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
    let screenshotFailed = false;
    const stlFile = findFileByExtension(renderedFiles, ".stl");
    if (stlFile) {
      logger.info({ dataLength: stlFile.contentBase64.length }, "sending STL to rendering service for screenshots");
      try {
        const screenshotResult = await renderModelScreenshots({
          modelData: stlFile.contentBase64,
          format: "stl",
          width: 512,
          height: 512,
        });
        screenshots = screenshotResult.images;
        logger.info({ angles: screenshots.map((s) => s.angle) }, "screenshots received");
      } catch (error) {
        logger.warn({ err: error, promptId: ctx.promptId, iteration }, "screenshot failed after retries — this is a service issue, not a code issue");
        screenshotFailed = true;
      }
    } else {
      logger.warn("no STL file available, skipping screenshots");
    }

    // 5. VLM Evaluate — send labeled images, exclude isometric (thumbnail-only)
    const vlmImages = screenshots
      .filter((s) => s.angle !== "isometric")
      .map((s) => ({ angle: s.angle, base64: s.base64 }));
    logger.info({ imageCount: vlmImages.length }, "starting VLM evaluation");
    if (vlmImages.length > 0) {
      evalResult = await evaluateModel({
        userPrompt: ctx.prompt,
        categoryName: ctx.categoryName,
        complexity: ctx.complexity,
        images: vlmImages,
      });
      // Accumulate VLM eval tokens into the total
      totalPromptTokens += evalResult.promptTokens;
      totalCompletionTokens += evalResult.completionTokens;
      logger.info({ score: evalResult.score, looksCorrect: evalResult.looksCorrect, vlmTokens: evalResult.promptTokens + evalResult.completionTokens }, "VLM evaluation result");
    } else {
      logger.warn("skipping VLM evaluation, no screenshots");
    }

    // 5b. If screenshots failed due to a service issue (not a code issue), persist
    // the render-successful result and stop. Retrying with AI regeneration is pointless
    // because the code rendered fine — only the screenshot service is down.
    if (screenshotFailed) {
      logger.info(
        { promptId: ctx.promptId, iteration },
        "screenshot service failed — persisting render result without eval (no AI retry)",
      );

      const exampleId = crypto.randomUUID();
      // Persist rendered files to disk (no screenshots since service failed)
      const filePaths = await persistWorkbenchFiles({
        categoryId: ctx.categoryId,
        exampleId,
        renderedFiles,
        code: currentCode,
        screenshots: [],
      });

      await insertExample({
        id: exampleId,
        promptId: ctx.promptId,
        iteration,
        code: currentCode,
        renderStatus: "success",
        renderError: null,
        stlPath: filePaths.stlPath,
        stepPath: filePaths.stepPath,
        threemfPath: filePaths.threemfPath,
        screenshotFront: null,
        screenshotBack: null,
        screenshotLeft: null,
        screenshotRight: null,
        screenshotTop: null,
        screenshotBottom: null,
        screenshotOrtho45: null,
        screenshotOrtho45Bottom: null,
        screenshotIso: null,
        screenshotIsoBack: null,
        evalScore: null,
        evalIssues: ["Screenshot service unavailable — evaluation skipped"],
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
        renderStatus: "success",
        renderError: null,
        evalScore: null,
        evalIssues: ["Screenshot service unavailable — evaluation skipped"],
        evalSuggestions: null,
        approvalStatus: "pending",
        llmModel: llmModelLabel,
        vlmModel: null,
      };
    }

    // 6. Track best result and decide whether to continue fixing
    const score = evalResult?.score ?? null;
    const approved = score !== null && score >= AUTO_APPROVE_THRESHOLD;
    const hasIssues = (evalResult?.issues ?? []).length > 0;
    logger.info({ score, threshold: AUTO_APPROVE_THRESHOLD, approved, hasIssues, lastIteration: iteration >= MAX_FIX_ITERATIONS }, "iteration evaluation summary");

    // Track the best successful result so we never regress
    if (score !== null && (best === null || score > best.score)) {
      best = {
        code: currentCode,
        score,
        evalResult,
        screenshots: [...screenshots],
        iteration,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
      };
      logger.info({ score, iteration }, "new best result");
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
        screenshots,
        iteration,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
      };
      const finalScore = final.score;
      const finalApproved = finalScore !== null && finalScore >= AUTO_APPROVE_THRESHOLD;

      const exampleId = crypto.randomUUID();
      // Persist rendered files and screenshots to disk
      const filePaths = await persistWorkbenchFiles({
        categoryId: ctx.categoryId,
        exampleId,
        renderedFiles,
        code: final.code,
        screenshots: final.screenshots,
      });

      await insertExample({
        id: exampleId,
        promptId: ctx.promptId,
        iteration: final.iteration,
        code: final.code,
        renderStatus: "success",
        renderError: null,
        stlPath: filePaths.stlPath,
        stepPath: filePaths.stepPath,
        threemfPath: filePaths.threemfPath,
        screenshotFront: filePaths.screenshotFrontPath,
        screenshotBack: filePaths.screenshotBackPath,
        screenshotLeft: filePaths.screenshotLeftPath,
        screenshotRight: filePaths.screenshotRightPath,
        screenshotTop: filePaths.screenshotTopPath,
        screenshotBottom: filePaths.screenshotBottomPath,
        screenshotOrtho45: filePaths.screenshotOrtho45Path,
        screenshotOrtho45Bottom: filePaths.screenshotOrtho45BottomPath,
        screenshotIso: filePaths.screenshotIsoPath,
        screenshotIsoBack: filePaths.screenshotIsoBackPath,
        evalScore: finalScore,
        evalIssues: final.evalResult?.issues ?? null,
        evalSuggestions: final.evalResult?.suggestions ?? null,
        approvalStatus: finalApproved ? "auto_approved" : "pending",
        llmModel: llmModelLabel,
        vlmModel: final.evalResult?.vlmModel ?? null,
        promptTokens: final.promptTokens,
        completionTokens: final.completionTokens,
      });

      logger.info(
        { promptId: ctx.promptId, iteration: final.iteration, score: finalScore, status: finalApproved ? "auto_approved" : "pending", totalIterations: iteration },
        "example persisted",
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
    logger.info(
      { promptId: ctx.promptId, iteration, score, issueCount: (evalResult?.issues ?? []).length },
      "retrying with fix attempt",
    );
  }

  // Should not reach here, but just in case
  throw new Error("Unexpected end of generation pipeline");
}

// ── Re-render pipeline (no AI codegen, no fix loop) ──────────────────

/**
 * Re-render an existing example's code without running AI codegen.
 * Wraps the code in the template, renders via Build123d, takes screenshots,
 * runs VLM evaluation once (no fix loop), and persists as a new example.
 * If rendering fails, stops immediately — no AI retry.
 */
export async function reRenderForExample(exampleId: string): Promise<GenerateResult> {
  logger.info({ exampleId }, "starting re-render for example");

  // 1. Load existing example to get the code and prompt context
  const { getExample: getExampleDetail } = await import("./workbench-examples.service.js");
  const existingExample = await getExampleDetail(exampleId);
  const code = existingExample.code;

  if (!code || code.trim() === "") {
    throw new WorkbenchSeederError("Example has no code to re-render", 400);
  }

  const ctx = await loadPromptContext(existingExample.promptId);
  logger.info({ prompt: ctx.prompt.slice(0, 80), category: ctx.categoryName }, "loaded prompt context for re-render");

  // 2. Render with Build123d — wrap raw code in template for execution
  const baseFileName = `wb-${ctx.promptId.slice(0, 8)}-rerender`;
  const executableCode = wrapInTemplate(code, baseFileName);
  logger.debug({ code: executableCode }, "executable code for Build123d re-render");

  let renderedFiles: RenderedFile[] = [];
  let renderError: string | null = null;

  try {
    const renderResult = await renderBuild123d({
      code: executableCode,
      baseFileName,
    });
    renderedFiles = renderResult.files;
    logger.info({ fileCount: renderedFiles.length, files: renderedFiles.map((f) => f.filename) }, "Build123d re-render success");
  } catch (error) {
    renderError = error instanceof Error ? error.message : String(error);
    logger.warn({ exampleId, renderError }, "re-render failed — stopping (no AI retry)");

    // Persist failure as a new example and return immediately
    const failedExampleId = crypto.randomUUID();
    await insertExample({
      id: failedExampleId,
      promptId: ctx.promptId,
      iteration: 0,
      code,
      renderStatus: "error",
      renderError,
      stlPath: null,
      stepPath: null,
      threemfPath: null,
      screenshotFront: null,
      screenshotBack: null,
      screenshotLeft: null,
      screenshotRight: null,
      screenshotTop: null,
      screenshotBottom: null,
      screenshotOrtho45: null,
      screenshotOrtho45Bottom: null,
      screenshotIso: null,
      screenshotIsoBack: null,
      evalScore: null,
      evalIssues: null,
      evalSuggestions: null,
      approvalStatus: "pending",
      llmModel: "manual",
      vlmModel: null,
      promptTokens: 0,
      completionTokens: 0,
    });

    return {
      exampleId: failedExampleId,
      promptId: ctx.promptId,
      iteration: 0,
      code,
      renderStatus: "error",
      renderError,
      evalScore: null,
      evalIssues: null,
      evalSuggestions: null,
      approvalStatus: "pending",
      llmModel: "manual",
      vlmModel: null,
    };
  }

  // 3. Screenshot via STL rendering service
  let screenshots: RenderedScreenshot[] = [];
  const stlFile = findFileByExtension(renderedFiles, ".stl");
  if (stlFile) {
    logger.info({ dataLength: stlFile.contentBase64.length }, "sending STL to rendering service for screenshots (re-render)");
    try {
      const screenshotResult = await renderModelScreenshots({
        modelData: stlFile.contentBase64,
        format: "stl",
        width: 512,
        height: 512,
      });
      screenshots = screenshotResult.images;
      logger.info({ angles: screenshots.map((s) => s.angle) }, "screenshots received (re-render)");
    } catch (error) {
      logger.warn({ err: error, exampleId }, "screenshot failed during re-render");
    }
  } else {
    logger.warn("no STL file available, skipping screenshots (re-render)");
  }

  // 4. VLM Evaluate — single pass, no loop — send labeled images, exclude isometric (thumbnail-only)
  let evalResult: EvaluationResult | null = null;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const vlmImages = screenshots
    .filter((s) => s.angle !== "isometric")
    .map((s) => ({ angle: s.angle, base64: s.base64 }));
  if (vlmImages.length > 0) {
    logger.info({ imageCount: vlmImages.length }, "starting VLM evaluation (re-render)");
    evalResult = await evaluateModel({
      userPrompt: ctx.prompt,
      categoryName: ctx.categoryName,
      complexity: ctx.complexity,
      images: vlmImages,
    });
    totalPromptTokens = evalResult.promptTokens;
    totalCompletionTokens = evalResult.completionTokens;
    logger.info({ score: evalResult.score, looksCorrect: evalResult.looksCorrect }, "VLM evaluation result (re-render)");
  } else {
    logger.warn("skipping VLM evaluation, no screenshots (re-render)");
  }

  // 5. Persist files to disk and create new example
  const score = evalResult?.score ?? null;
  const approved = score !== null && score >= AUTO_APPROVE_THRESHOLD;

  const newExampleId = crypto.randomUUID();
  const filePaths = await persistWorkbenchFiles({
    categoryId: ctx.categoryId,
    exampleId: newExampleId,
    renderedFiles,
    code,
    screenshots,
  });

  await insertExample({
    id: newExampleId,
    promptId: ctx.promptId,
    iteration: 0,
    code,
    renderStatus: "success",
    renderError: null,
    stlPath: filePaths.stlPath,
    stepPath: filePaths.stepPath,
    threemfPath: filePaths.threemfPath,
    screenshotFront: filePaths.screenshotFrontPath,
    screenshotBack: filePaths.screenshotBackPath,
    screenshotLeft: filePaths.screenshotLeftPath,
    screenshotRight: filePaths.screenshotRightPath,
    screenshotTop: filePaths.screenshotTopPath,
    screenshotBottom: filePaths.screenshotBottomPath,
    screenshotOrtho45: filePaths.screenshotOrtho45Path,
    screenshotOrtho45Bottom: filePaths.screenshotOrtho45BottomPath,
    screenshotIso: filePaths.screenshotIsoPath,
    screenshotIsoBack: filePaths.screenshotIsoBackPath,
    evalScore: score,
    evalIssues: evalResult?.issues ?? null,
    evalSuggestions: evalResult?.suggestions ?? null,
    approvalStatus: approved ? "auto_approved" : "pending",
    llmModel: "manual",
    vlmModel: evalResult?.vlmModel ?? null,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
  });

  logger.info(
    { exampleId: newExampleId, promptId: ctx.promptId, score, status: approved ? "auto_approved" : "pending" },
    "re-render example persisted",
  );

  return {
    exampleId: newExampleId,
    promptId: ctx.promptId,
    iteration: 0,
    code,
    renderStatus: "success",
    renderError: null,
    evalScore: score,
    evalIssues: evalResult?.issues ?? null,
    evalSuggestions: evalResult?.suggestions ?? null,
    approvalStatus: approved ? "auto_approved" : "pending",
    llmModel: "manual",
    vlmModel: evalResult?.vlmModel ?? null,
  };
}
