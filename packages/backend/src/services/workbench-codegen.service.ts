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
import { prisma } from "../db/prisma.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  buildGenerateOptions,
  calculateCostUsd,
  buildCacheableSystem,
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
import { CODEGEN_SYSTEM_PROMPT, buildReducedSystemPrompt } from "../prompts/system-prompts.js";
import {
  shouldUseEditMode,
  parseEditResponse,
  applyEdits,
} from "../utils/code-edits.js";
import { WorkbenchSeederError } from "./workbench-seeder.service.js";
import { findSimilarExamples } from "./workbench-embeddings.service.js";
import { validatePrompt } from "./workbench-prompt-validation.service.js";
import {
  classifyRenderError,
  buildEscalatedGuidance,
  renderWithInfraRetry,
  consecutiveSameCategoryCount,
  RenderErrorCategory,
  type ClassifiedRenderError,
  type RenderErrorContext,
} from "../utils/render-errors.js";
import { writeStorageFile } from "./file-storage.service.js";
import {
  getMaxFixIterations,
  getAutoApproveThreshold,
  getLooksCorrectThreshold,
  getFewShotExampleLimit,
} from "./generation-settings.service.js";
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

/**
 * Stage-level progress callback for SSE publishing.
 * The codegen service calls this at each major pipeline stage.
 * The caller (batch service) wires it to SSE publishing.
 */
export type ProgressCallback = (state: string, detail: string) => void;

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
): { system: string; userContent: string } {
  const userSections: string[] = [];

  if (fewShots.length > 0) {
    userSections.push("## Approved Examples for Reference", "");
    for (const example of fewShots) {
      userSections.push(
        `### User request: "${example.prompt}"`,
        "```python",
        example.code,
        "```",
        "",
      );
    }
  }

  userSections.push(
    "## Requirements",
    "- Generate ONLY the Build123d modeling code. Do NOT include `from build123d import *` or export calls. The template pre-imports `math`. You may also import `itertools`, `functools`, `copy`, or `numpy`.",
    "- Assign the final solid to `root_part` (e.g. `root_part = part.part`).",
    "- Use only Build123d classes and functions from the reference above.",
    "- PARAMETER CONVENTION: Define all dimensional values (lengths, widths, heights, radii, angles, counts) as named variables at the top of your code before any BuildPart/BuildSketch blocks. Use descriptive snake_case names. Add a brief inline comment describing each parameter. Do NOT hardcode numeric values directly in constructors like Box(), Cylinder(), extrude(), fillet(), etc. Instead, assign them to variables first and reference the variables.",
    "",
    `User request: ${userPrompt}`,
  );

  return { system: systemPromptContent, userContent: userSections.join("\n") };
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
  options?: {
    /** When true, few-shot examples are omitted (already seen on iteration 1). Default: true (include). */
    includeFewShots?: boolean;
    /** Cumulative error history from all prior iterations for context. */
    errorHistory?: ClassifiedRenderError[];
    /** When true, uses buildReducedSystemPrompt() instead of the passed-in systemPromptContent. */
    useReducedSystemPrompt?: boolean;
  },
): { system: string; userContent: string } {
  const includeFewShots = options?.includeFewShots ?? true;
  const errorHistory = options?.errorHistory ?? [];

  // Optionally use a reduced system prompt for fix iterations
  const effectiveSystem = options?.useReducedSystemPrompt
    ? buildReducedSystemPrompt({
        currentCode: failedCode,
        errorCategory: renderErrorContext?.classified.category as RenderErrorCategory | undefined,
        errorMessage: renderError ?? undefined,
      })
    : systemPromptContent;
  const sections: string[] = [];

  if (includeFewShots && fewShots.length > 0) {
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

  // Cumulative error history: show the LLM what approaches already failed
  if (errorHistory.length > 0) {
    sections.push("## Previous attempts summary:");
    for (let i = 0; i < errorHistory.length; i++) {
      const e = errorHistory[i];
      const snippet = e.rawMessage.length > 120 ? e.rawMessage.slice(0, 120) + "..." : e.rawMessage;
      sections.push(`- Attempt ${i + 1}: [${e.category}] — ${snippet}`);
    }
    sections.push("");
  }

  sections.push(
    `## Previous code (attempt ${iteration}):`,
    "```python",
    failedCode,
    "```",
    "",
    `## ${errorHistory.length > 0 ? `Current attempt (attempt ${iteration}) problems` : "Problems"} to fix:`,
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
    "- PARAMETER CONVENTION: Define all dimensional values (lengths, widths, heights, radii, angles, counts) as named variables at the top of your code before any BuildPart/BuildSketch blocks. Use descriptive snake_case names. Add a brief inline comment describing each parameter. Do NOT hardcode numeric values directly in constructors like Box(), Cylinder(), extrude(), fillet(), etc. Instead, assign them to variables first and reference the variables.",
    "",
    `## Original request:`,
    userPrompt,
  );

  return { system: effectiveSystem, userContent: sections.join("\n") };
}

/**
 * Build a fix prompt that requests edit-format responses (search-and-replace blocks)
 * instead of full code regeneration. Uses a reduced system prompt.
 *
 * The LLM is instructed to return `<<<SEARCH ... === ... >>>SEARCH` blocks for
 * targeted fixes, or `<<<FULL_REWRITE` if a complete rewrite is needed.
 */
export function buildEditFixPrompt(
  systemPromptContent: string,
  userPrompt: string,
  currentCode: string,
  iteration: number,
  renderError: string | null,
  evalIssues: string[] | null,
  evalSuggestions: string[] | null,
  renderErrorContext?: RenderErrorContext | null,
  options?: { errorHistory?: ClassifiedRenderError[]; useReducedSystemPrompt?: boolean },
): { system: string; userContent: string } {
  const errorHistory = options?.errorHistory ?? [];

  // Use reduced system prompt for edit-based fixes (opt-in, default true).
  // Callers may pass false when the provider needs a large prompt for caching
  // (e.g. Opus 4.6 requires ≥ 4096 tokens).
  const useReduced = options?.useReducedSystemPrompt ?? true;
  const system = useReduced
    ? buildReducedSystemPrompt({
        currentCode,
        errorCategory: renderErrorContext?.classified.category as RenderErrorCategory | undefined,
        errorMessage: renderError ?? undefined,
      })
    : systemPromptContent;

  const sections: string[] = [];

  // 1. Current code (fenced block)
  sections.push(
    "## Current code:",
    "```python",
    currentCode,
    "```",
    "",
  );

  // 2. Error history summary (cumulative)
  if (errorHistory.length > 0) {
    sections.push("## Previous attempts summary:");
    for (let i = 0; i < errorHistory.length; i++) {
      const e = errorHistory[i];
      const snippet = e.rawMessage.length > 120 ? e.rawMessage.slice(0, 120) + "..." : e.rawMessage;
      sections.push(`- Attempt ${i + 1}: [${e.category}] — ${snippet}`);
    }
    sections.push("");
  }

  // 3. Current problems + fix guidance
  sections.push(
    `## Problems to fix (attempt ${iteration}):`,
  );

  if (renderErrorContext) {
    const { classified, escalationGuidance } = renderErrorContext;
    sections.push(`- Render error (${classified.category}): ${classified.rawMessage}`);
    const guidance = escalationGuidance ?? classified.fixGuidance;
    if (guidance) {
      sections.push("", "## Fix guidance:", guidance);
    }
  } else if (renderError) {
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

  // 4. Edit format instructions
  sections.push(
    "## Response Format — EDIT MODE",
    "",
    "Make TARGETED fixes using search-and-replace blocks. Do NOT rewrite the entire code.",
    "Return one or more edit blocks in this exact format:",
    "",
    "<<<SEARCH",
    "exact lines to find in the current code",
    "===",
    "replacement lines",
    ">>>SEARCH",
    "",
    "Rules:",
    "- Each SEARCH block must match EXACTLY one location in the current code",
    "- Include enough context lines to make the match unique",
    "- You can return multiple <<<SEARCH...>>>SEARCH blocks for multiple fixes",
    "- Preserve indentation exactly",
    "",
    "If the code needs a COMPLETE rewrite (fundamental structural issue), use:",
    "",
    "<<<FULL_REWRITE",
    "```python",
    "{complete corrected code}",
    "```",
    ">>>FULL_REWRITE",
    "",
    "Only use FULL_REWRITE as a last resort when targeted edits cannot fix the issue.",
    "",
    "## Requirements",
    "- Generate ONLY the Build123d modeling code. Do NOT include `from build123d import *` or export calls. The template pre-imports `math`. You may also import `itertools`, `functools`, `copy`, or `numpy`.",
    "- Assign the final solid to `root_part` (e.g. `root_part = part.part`).",
    "- PARAMETER CONVENTION: Define all dimensional values as named variables at the top of your code. Use descriptive snake_case names with inline comments.",
    "",
    `## Original request:`,
    userPrompt,
  );

  return { system, userContent: sections.join("\n") };
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
): { system: string; userContent: string } {
  const sections: string[] = [];

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
    "- PARAMETER CONVENTION: Define all dimensional values (lengths, widths, heights, radii, angles, counts) as named variables at the top of your code before any BuildPart/BuildSketch blocks. Use descriptive snake_case names. Add a brief inline comment describing each parameter. Do NOT hardcode numeric values directly in constructors like Box(), Cylinder(), extrude(), fillet(), etc. Instead, assign them to variables first and reference the variables.",
  );

  return { system: systemPromptContent, userContent: sections.join("\n") };
}

// ── Few-shot example retrieval ───────────────────────────────────────

/**
 * Fallback: category-scoped selection by eval score.
 * Used when vector search is unavailable (no embeddings or API error).
 */
async function fetchFewShotExamplesByCategory(categoryId: string, limit = 6): Promise<FewShotExample[]> {
  // ORDER BY NULLS LAST → stays as raw SQL
  return prisma.$queryRaw<FewShotExample[]>`
    SELECT p.prompt, e.code
     FROM workbench_examples e
     JOIN workbench_example_prompts p ON p.id = e.prompt_id
     WHERE p.category_id = ${categoryId}::uuid
       AND e.approval_status IN ('auto_approved', 'human_approved')
     ORDER BY e.eval_score DESC NULLS LAST, e.created_at DESC
     LIMIT ${limit}
  `;
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
    const { matches: results } = await findSimilarExamples(promptText, limit);
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
  const row = await prisma.workbenchExamplePrompt.findUnique({
    where: { id: promptId },
    include: { category: true },
  });

  if (!row) {
    throw new WorkbenchSeederError("Prompt not found", 404);
  }

  return {
    promptId: row.id,
    prompt: row.prompt,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    complexity: row.category.complexity,
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
  const created = await prisma.workbenchExample.create({
    data: {
      id: data.id,
      promptId: data.promptId,
      iteration: data.iteration,
      code: data.code,
      renderStatus: data.renderStatus,
      renderError: data.renderError,
      stlPath: data.stlPath,
      stepPath: data.stepPath,
      threemfPath: data.threemfPath,
      screenshotFront: data.screenshotFront,
      screenshotBack: data.screenshotBack,
      screenshotLeft: data.screenshotLeft,
      screenshotRight: data.screenshotRight,
      screenshotTop: data.screenshotTop,
      screenshotBottom: data.screenshotBottom,
      screenshotOrtho45: data.screenshotOrtho45,
      screenshotOrtho45Bottom: data.screenshotOrtho45Bottom,
      screenshotIso: data.screenshotIso,
      screenshotIsoBack: data.screenshotIsoBack,
      evalScore: data.evalScore,
      evalIssues: data.evalIssues ?? undefined,
      evalSuggestions: data.evalSuggestions ?? undefined,
      approvalStatus: data.approvalStatus,
      rejectionNote: data.rejectionNote ?? null,
      llmModel: data.llmModel,
      vlmModel: data.vlmModel,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
    },
    select: { id: true },
  });
  return created.id;
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
  system?: string,
): Promise<{ code: string; rawText: string; promptTokens: number; completionTokens: number }> {
  if (providerModel === null) {
    // Mock mode — raw modeling code only (no imports/exports)
    const code = `
# Simple box
with BuildPart() as part:
    Box(20, 20, 20)

root_part = part.part
    `.trim();
    return { code, rawText: code, promptTokens: 0, completionTokens: 0 };
  }

  const extraOpts = modelConfig ? buildGenerateOptions(modelConfig) : {};
  const cacheableSystem = system && modelConfig ? buildCacheableSystem(modelConfig.provider, system) : undefined;

  if (modelConfig) {
    logger.info(
      { provider: modelConfig.provider, model: modelConfig.modelName, thinkingEffort: modelConfig.thinkingEffort, supportsThinking: modelConfig.supportsThinking, extraOpts, hasCacheableSystem: !!cacheableSystem && typeof cacheableSystem !== "string" },
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
          ...(cacheableSystem ? { system: cacheableSystem } : {}),
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
    rawText: result.text,
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

export async function generateForPrompt(promptId: string, onProgress?: ProgressCallback): Promise<GenerateResult> {
  logger.info({ promptId }, "starting generation for prompt");

  // Pipeline-level timeout — aborts the entire pipeline if it takes too long
  const pipelineController = new AbortController();
  const pipelineTimeout = setTimeout(() => pipelineController.abort(), PIPELINE_TIMEOUT_MS);

  try {
    return await _generateForPromptInner(promptId, pipelineController.signal, onProgress);
  } finally {
    clearTimeout(pipelineTimeout);
  }
}

async function _generateForPromptInner(promptId: string, pipelineSignal: AbortSignal, onProgress?: ProgressCallback): Promise<GenerateResult> {

  // 1. Load context and resolve model
  const ctx = await loadPromptContext(promptId);
  logger.info({ prompt: ctx.prompt.slice(0, 80), category: ctx.categoryName, complexity: ctx.complexity }, "loaded prompt context");

  const { model: providerModel, label: llmModelLabel, config: codegenConfig } = await resolveCodegenModel();
  logger.info({ model: llmModelLabel }, "codegen model resolved");

  // 2. Validate prompt before expensive codegen pipeline
  onProgress?.("validating", "Validating prompt...");
  const validation = await validatePrompt(ctx.prompt);
  if (!validation.valid) {
    logger.info({ reason: validation.reason }, "prompt rejected by validation");
    onProgress?.("failed", `Prompt validation failed: ${validation.reason}`);
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

  // 3. Load dynamic settings + few-shot examples
  const [dynMaxFix, dynAutoApprove, dynLooksCorrect, dynFewShotLimit] = await Promise.all([
    getMaxFixIterations("workbench"),
    getAutoApproveThreshold("workbench"),
    getLooksCorrectThreshold("workbench"),
    getFewShotExampleLimit("workbench"),
  ]);
  logger.info({ chars: CODEGEN_SYSTEM_PROMPT.length }, "system prompt loaded");

  const fewShots = await fetchFewShotExamples(ctx.prompt, ctx.categoryId, dynFewShotLimit);
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

  // Edit-mode tracking
  let previousRenderSucceeded = false;
  let preEditCode: string | null = null;

  for (let iteration = 1; iteration <= dynMaxFix; iteration++) {
    logger.info({ iteration, maxIterations: dynMaxFix }, "starting iteration");

    const isFirst = iteration === 1;
    onProgress?.(
      isFirst ? "codegen" : "fixing",
      isFirst ? "Generating code..." : `Improving model (attempt ${iteration}/${dynMaxFix})...`,
    );

    // Determine whether to use edit mode for this fix iteration
    const wbConsecutiveSame = renderErrorCtx
      ? consecutiveSameCategoryCount(errorHistory, renderErrorCtx.classified.category)
      : 0;
    const useEditMode = !isFirst && shouldUseEditMode({
      iteration,
      previousRenderSucceeded,
      errorCategory: renderErrorCtx?.classified.category ?? null,
      consecutiveSameCategory: wbConsecutiveSame,
    });
    if (useEditMode) {
      preEditCode = currentCode;
      logger.info({ iteration, category: renderErrorCtx?.classified.category ?? "vlm_only" }, "using edit mode for fix iteration");
    }

    // 2. Generate code
    const { system: cgSystem, userContent: cgUserContent } =
      iteration === 1
        ? buildInitialPrompt(CODEGEN_SYSTEM_PROMPT, fewShots, ctx.prompt)
        : useEditMode
          ? buildEditFixPrompt(CODEGEN_SYSTEM_PROMPT, ctx.prompt, currentCode, iteration - 1, renderError, evalResult?.issues ?? null, evalResult?.suggestions ?? null, renderErrorCtx, { errorHistory, useReducedSystemPrompt: false })
          : buildFixPrompt(
              CODEGEN_SYSTEM_PROMPT,
              fewShots,
              ctx.prompt,
              currentCode,
              iteration - 1,
              renderError,
              evalResult?.issues ?? null,
              evalResult?.suggestions ?? null,
              renderErrorCtx,
              { useReducedSystemPrompt: false, errorHistory },
            );

    logger.info({ promptChars: cgUserContent.length, systemChars: cgSystem.length }, "LLM prompt built");
    if (iteration > 1) {
      const issues = evalResult?.issues ?? [];
      const suggestions = evalResult?.suggestions ?? [];
      logger.info({ issues, suggestions }, "fix feedback — issues and suggestions");
      if (renderError) logger.info({ renderError, category: renderErrorCtx?.classified.category ?? "none" }, "fix feedback — render error");
    }
    const codeResult = await generateCode(cgUserContent, providerModel, codegenConfig, pipelineSignal, cgSystem);

    // Extract code: edit mode parses search-and-replace blocks from raw text
    if (useEditMode) {
      const editParsed = parseEditResponse(codeResult.rawText);
      if (editParsed.isFullRewrite && editParsed.fullRewriteCode) {
        currentCode = stripTemplateBoilerplate(editParsed.fullRewriteCode);
        logger.info({ iteration }, "edit mode: LLM chose full rewrite");
      } else if (editParsed.edits.length > 0) {
        const editResult = applyEdits(currentCode, editParsed.edits);
        if (editResult.appliedCount > 0) {
          currentCode = stripTemplateBoilerplate(editResult.resultCode);
          logger.info({ iteration, applied: editResult.appliedCount, failed: editResult.failedSearches.length }, "edit mode: edits applied");
          if (editResult.failedSearches.length > 0) {
            logger.warn({ iteration, failedSearches: editResult.failedSearches }, "edit mode: some edits failed to match");
          }
        } else {
          logger.warn({ iteration }, "edit mode: no edits matched, falling back to full code extraction");
          currentCode = codeResult.code;
        }
      } else {
        logger.info({ iteration }, "edit mode: no edit blocks found, falling back to full code extraction");
        currentCode = codeResult.code;
      }
    } else {
      currentCode = codeResult.code;
    }
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
    onProgress?.("rendering", "Rendering 3D model...");
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
      previousRenderSucceeded = true;
      preEditCode = null;
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

      // If edit mode was used and render failed, revert to pre-edit code
      if (useEditMode && preEditCode) {
        logger.info({ iteration }, "edit mode: reverting to pre-edit code after render failure");
        currentCode = preEditCode;
        preEditCode = null;
      }

      // If this is the last iteration, persist the failure and return
      if (iteration >= dynMaxFix) {
        onProgress?.("failed", renderError ?? "Render failed");
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
    onProgress?.("screenshots", "Taking screenshots...");
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
    onProgress?.("evaluating", `Evaluating quality (attempt ${iteration}/${dynMaxFix})...`);
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
        looksCorrectThreshold: dynLooksCorrect,
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
    const approved = score !== null && score >= dynAutoApprove;
    const hasIssues = (evalResult?.issues ?? []).length > 0;
    logger.info({ score, threshold: dynAutoApprove, approved, hasIssues, lastIteration: iteration >= dynMaxFix }, "iteration evaluation summary");

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
    const shouldStop = (approved && !hasIssues) || iteration >= dynMaxFix;

    if (shouldStop) {
      onProgress?.("completed", "Done");
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
      const finalApproved = finalScore !== null && finalScore >= dynAutoApprove;

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
export async function reRenderForExample(exampleId: string, onProgress?: ProgressCallback): Promise<GenerateResult> {
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

  const [rrAutoApprove, rrLooksCorrect] = await Promise.all([
    getAutoApproveThreshold("workbench"),
    getLooksCorrectThreshold("workbench"),
  ]);

  // 2. Render with Build123d — wrap raw code in template for execution
  onProgress?.("rendering", "Rendering 3D model...");
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
    onProgress?.("failed", renderError);
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
  onProgress?.("screenshots", "Taking screenshots...");
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
  onProgress?.("evaluating", "Evaluating quality...");
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
      looksCorrectThreshold: rrLooksCorrect,
    });
    totalPromptTokens = evalResult.promptTokens;
    totalCompletionTokens = evalResult.completionTokens;
    logger.info({ score: evalResult.score, looksCorrect: evalResult.looksCorrect }, "VLM evaluation result (re-render)");
  } else {
    logger.warn("skipping VLM evaluation, no screenshots (re-render)");
  }

  // 5. Persist files to disk and create new example
  const score = evalResult?.score ?? null;
  const approved = score !== null && score >= rrAutoApprove;

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

  onProgress?.("completed", "Done");
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
