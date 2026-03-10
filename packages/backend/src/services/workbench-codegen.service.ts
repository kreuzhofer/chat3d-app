/**
 * Workbench Code Generation Pipeline
 *
 * Agent-based generation pipeline:
 *   spec generation → agent codegen (tool-use loop) → VLM evaluate → persist
 */

import { runWithUsageContext } from "./usage-tracking.service.js";
import { createLogger } from "../utils/logger.js";
import { prisma } from "../db/prisma.js";
import {
  getModelForPurpose,
  getModelForPurposeWithFallback,
  createProviderModel as createProviderModelFromConfig,
  type LlmModelConfig,
} from "./llm-config.service.js";

const logger = createLogger("workbench");
import { renderBuild123d, type RenderedFile } from "./rendering.service.js";
import {
  renderModelScreenshots,
  type RenderedScreenshot,
} from "./stl-rendering-client.service.js";
import { evaluateModel, type EvaluationResult } from "./visual-eval.service.js";
import { CODEGEN_SYSTEM_PROMPT, buildReducedSystemPrompt, buildTieredSystemPrompt, detectPromptOperations } from "../prompts/system-prompts.js";
import { WorkbenchSeederError } from "./workbench-seeder.service.js";
import { findSimilarExamples } from "./workbench-embeddings.service.js";
import { validatePrompt } from "./workbench-prompt-validation.service.js";
import {
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
  getSimpleMaxFixCap,
  isSpecGenerationEnabled,
  isTieredPromptEnabled,
  getAgentMaxSteps,
} from "./generation-settings.service.js";
import { generateSpec, type SpecResult } from "./spec-generation.service.js";
import { runAgentCodegen, runMultiAgentCodegen } from "./agent-codegen.service.js";
import crypto from "node:crypto";

export const MAX_FIX_ITERATIONS = 5;
export const AUTO_APPROVE_THRESHOLD = 8;

/** Timeout for the entire per-prompt pipeline (15 minutes). */
const PIPELINE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Code template that wraps LLM-generated modeling code.
 * The LLM produces only the Build123d modeling code ending with `root_part = ...`.
 * This template adds the import and all export calls around it.
 */
const CODE_TEMPLATE = `from build123d import *
import math
from bd_warehouse.thread import IsoThread, AcmeThread, MetricTrapezoidalThread
from bd_warehouse.fastener import (
    CounterSunkScrew, HexHeadScrew, SocketHeadCapScrew, SetScrew,
    PanHeadScrew, ButtonHeadScrew,
    HexNut, HexNutWithFlange, SquareNut, DomedCapNut,
    Washer, PlainWasher, ChamferedWasher,
)
from bd_warehouse.bearing import SingleRowDeepGrooveBallBearing
from bd_warehouse.gear import SpurGear
from bd_warehouse.pipe import Pipe, PipeSection
from bd_warehouse.sprocket import Sprocket
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
  exampleId: string | null;
  promptId: string;
  iteration: number;
  code: string;
  renderStatus: "success" | "error" | "skipped";
  renderError: string | null;
  evalScore: number | null;
  evalIssues: string[] | null;
  evalSuggestions: string[] | null;
  evalChecklistResults: Array<{ question: string; pass: boolean; detail: string }> | null;
  approvalStatus: "pending" | "auto_approved" | "rejected";
  llmModel: string;
  vlmModel: string | null;
  disambiguationNeeded?: boolean;
  disambiguationQuestions?: string[];
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
  const cfg = await getModelForPurposeWithFallback("workbench_codegen", "agent_codegen");
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
    "- Generate ONLY the Build123d modeling code. Do NOT include `from build123d import *` or export calls. The template pre-imports `math` and `bd_warehouse` classes (threads, fasteners, bearings, gears, pipes). You may also import `itertools`, `functools`, `copy`, or `numpy`.",
    "- Assign the final solid to `root_part` (e.g. `root_part = part.part`).",
    "- MANDATORY: For screws, bolts, nuts, threads, gears, bearings, and other standard mechanical components, you MUST use bd_warehouse classes (CounterSunkScrew, HexHeadScrew, IsoThread, HexNut, SpurGear, etc.). NEVER build these manually with Cone, Cylinder, Helix, or sweep. Map user dimensions to the closest standard size (e.g., 'M6 screw' → size=\"M6-1\").",
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
    /** Issues from code-level evaluation (parameter mismatches, missing features). */
    codeEvalIssues?: string[] | null;
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
    sections.push("", "## Visual evaluation issues (from rendered model):");
    for (const issue of evalIssues) {
      sections.push(`- ${issue}`);
    }
  }

  const codeEvalIssues = options?.codeEvalIssues;
  if (codeEvalIssues && codeEvalIssues.length > 0) {
    sections.push("", "## Code review issues (from code analysis, NOT visual):");
    for (const issue of codeEvalIssues) {
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
    "- Generate ONLY the Build123d modeling code. Do NOT include `from build123d import *` or export calls. The template pre-imports `math` and `bd_warehouse` classes (threads, fasteners, bearings, gears, pipes). You may also import `itertools`, `functools`, `copy`, or `numpy`.",
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
  options?: { errorHistory?: ClassifiedRenderError[]; useReducedSystemPrompt?: boolean; codeEvalIssues?: string[] | null },
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
    sections.push("", "## Visual evaluation issues (from rendered model):");
    for (const issue of evalIssues) {
      sections.push(`- ${issue}`);
    }
  }

  const codeEvalIssues = options?.codeEvalIssues;
  if (codeEvalIssues && codeEvalIssues.length > 0) {
    sections.push("", "## Code review issues (from code analysis, NOT visual):");
    for (const issue of codeEvalIssues) {
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
    "- Generate ONLY the Build123d modeling code. Do NOT include `from build123d import *` or export calls. The template pre-imports `math` and `bd_warehouse` classes (threads, fasteners, bearings, gears, pipes). You may also import `itertools`, `functools`, `copy`, or `numpy`.",
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
    "- Generate ONLY the Build123d modeling code. Do NOT include `from build123d import *` or export calls. The template pre-imports `math` and `bd_warehouse` classes (threads, fasteners, bearings, gears, pipes). You may also import `itertools`, `functools`, `copy`, or `numpy`.",
    "- Assign the final solid to `root_part` (e.g. `root_part = part.part`).",
    "- MANDATORY: For screws, bolts, nuts, threads, gears, bearings, and other standard mechanical components, you MUST use bd_warehouse classes (CounterSunkScrew, HexHeadScrew, IsoThread, HexNut, SpurGear, etc.). NEVER build these manually with Cone, Cylinder, Helix, or sweep. Map user dimensions to the closest standard size (e.g., 'M6 screw' → size=\"M6-1\").",
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
  detectedOperations?: Set<string>,
): Promise<FewShotExample[]> {
  try {
    const { matches: results } = await findSimilarExamples(promptText, limit, detectedOperations);
    if (results.length > 0) {
      logger.info(
        { count: results.length, similarityMin: results[results.length - 1].similarity.toFixed(3), similarityMax: results[0].similarity.toFixed(3), opsBoost: detectedOperations?.size ?? 0 },
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

// ── Approval logic ──────────────────────────────────────────────────

/**
 * Determine auto-approval: score must meet threshold AND, if checklist
 * results exist, at least 80% of items must pass.
 */
function shouldAutoApprove(
  score: number | null,
  threshold: number,
  checklistResults?: Array<{ pass: boolean }> | null,
): boolean {
  if (score === null || score < threshold) return false;
  if (!checklistResults || checklistResults.length === 0) return true;
  const passCount = checklistResults.filter((r) => r.pass).length;
  const passRate = passCount / checklistResults.length;
  return passRate >= 0.8;
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
  evalChecklistResults: Array<{ question: string; pass: boolean; detail: string }> | null;
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
      evalChecklistResults: data.evalChecklistResults ?? undefined,
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
  const artifactPrefix = `workbench/${opts.categoryId}/artifacts/${opts.exampleId}`;
  const codePrefix = `workbench/${opts.categoryId}/code/${opts.exampleId}`;

  // Persist rendered 3D files to artifacts/
  let stlPath: string | null = null;
  let stepPath: string | null = null;
  let threemfPath: string | null = null;

  for (const file of opts.renderedFiles) {
    const ext = mapExtension(file.filename);
    const relativePath = `${artifactPrefix}.${ext}`;
    await writeStorageFile({ relativePath, contentBase64: file.contentBase64 });
    if (ext === "stl") stlPath = relativePath;
    else if (ext === "step") stepPath = relativePath;
    else if (ext === "3mf") threemfPath = relativePath;
  }

  // Persist code as .b123d to code/
  if (opts.code.trim()) {
    await writeStorageFile({
      relativePath: `${codePrefix}.b123d`,
      contentBase64: Buffer.from(opts.code, "utf-8").toString("base64"),
    });
  }

  // Persist screenshots to artifacts/
  const pathsByAngle: Record<string, string> = {};
  for (const ss of opts.screenshots) {
    const ssPath = `${artifactPrefix}-screenshot-${ss.angle}.png`;
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
  return runWithUsageContext({ workbenchExampleId: promptId }, async () => {
    logger.info({ promptId }, "starting generation for prompt");

    // Pipeline-level timeout — aborts the entire pipeline if it takes too long
    const pipelineController = new AbortController();
    const pipelineTimeout = setTimeout(() => pipelineController.abort(), PIPELINE_TIMEOUT_MS);

    try {
      return await _generateForPromptInner(promptId, pipelineController.signal, onProgress);
    } finally {
      clearTimeout(pipelineTimeout);
    }
  });
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
      evalChecklistResults: null,
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
      evalChecklistResults: null,
      approvalStatus: "rejected",
      llmModel: llmModelLabel,
      vlmModel: null,
    };
  }

  // 2b. Spec generation (disambiguation check)
  let specResult: SpecResult | null = null;
  const specEnabled = await isSpecGenerationEnabled("workbench");
  if (specEnabled) {
    onProgress?.("analyzing", "Analyzing prompt specification...");
    specResult = await generateSpec(ctx.prompt);

    if (specResult.disambiguationNeeded) {
      logger.info({ questions: specResult.disambiguationQuestions }, "prompt needs disambiguation — skipping codegen");
      onProgress?.("skipped", "Prompt needs clarification");

      // Store disambiguation info on the prompt
      await prisma.workbenchExamplePrompt.update({
        where: { id: ctx.promptId },
        data: {
          disambiguationQuestions: specResult.disambiguationQuestions,
          disambiguationStatus: "needs_review",
          specInterpretation: specResult.interpretation,
        },
      });

      return {
        exampleId: null,
        promptId: ctx.promptId,
        iteration: 0,
        code: "",
        renderStatus: "skipped",
        renderError: null,
        evalScore: null,
        evalIssues: null,
        evalSuggestions: null,
        evalChecklistResults: null,
        approvalStatus: "pending",
        llmModel: llmModelLabel,
        vlmModel: null,
        disambiguationNeeded: true,
        disambiguationQuestions: specResult.disambiguationQuestions,
      };
    }

    logger.info({ interpretation: specResult.interpretation.slice(0, 100), checklistCount: specResult.verificationChecklist.length }, "spec generated");
  }

  // 3. Load dynamic settings + few-shot examples
  let [dynMaxFix, dynAutoApprove, dynLooksCorrect, dynFewShotLimit, tieredEnabled] = await Promise.all([
    getMaxFixIterations("workbench"),
    getAutoApproveThreshold("workbench"),
    getLooksCorrectThreshold("workbench"),
    getFewShotExampleLimit("workbench"),
    isTieredPromptEnabled("workbench"),
  ]);

  // Cap fix iterations for simple prompts
  if (specResult?.complexity === "simple") {
    const simpleCap = await getSimpleMaxFixCap("workbench");
    if (dynMaxFix > simpleCap) {
      logger.info({ original: dynMaxFix, capped: simpleCap, complexity: specResult.complexity }, "capping fix iterations for simple prompt");
      dynMaxFix = simpleCap;
    }
  }

  // Detect operations for both few-shot retrieval boost and tiered prompt
  const detectedOps = detectPromptOperations(ctx.prompt, specResult?.interpretation);

  const fewShots = await fetchFewShotExamples(ctx.prompt, ctx.categoryId, dynFewShotLimit, detectedOps);
  logger.info({ count: fewShots.length, ops: [...detectedOps] }, "few-shot examples loaded");

  // Resolve system prompt: tiered (operation-aware) or full
  const systemPromptContent = tieredEnabled
    ? buildTieredSystemPrompt({
        promptText: ctx.prompt,
        interpretation: specResult?.interpretation,
        fewShotCount: fewShots.length,
      })
    : CODEGEN_SYSTEM_PROMPT;
  logger.info({ chars: systemPromptContent.length, fullChars: CODEGEN_SYSTEM_PROMPT.length, tiered: tieredEnabled }, "system prompt loaded");

  // ── Agent codegen ──
  const wbAgentModelConfig = await getModelForPurposeWithFallback("workbench_codegen", "agent_codegen");
  logger.info({ model: wbAgentModelConfig.label }, "resolved workbench_codegen model");

  {
    const wbAgMaxSteps = await getAgentMaxSteps("workbench");
    const wbUseMultiAgent = specResult?.complexity === "complex";
    const wbAgDetail = wbUseMultiAgent
      ? "Orchestrating multi-agent build for complex model..."
      : "Agent is working on your model...";
    onProgress?.("codegen", wbAgDetail);
    logger.info({ mode: wbUseMultiAgent ? "multi-agent" : "single-agent", complexity: specResult?.complexity }, "workbench agent mode selected");

    const wbAgInput = {
      promptText: ctx.prompt,
      interpretation: specResult?.interpretation,
      isModification: false,
      baseFileName: crypto.randomUUID(),
      maxSteps: wbAgMaxSteps,
      modelConfig: wbAgentModelConfig,
      complexity: specResult?.complexity,
      signal: pipelineSignal,
      onProgress: (state: string, detail: string) => onProgress?.(state, detail),
    };

    const agResult = wbUseMultiAgent
      ? await runMultiAgentCodegen(wbAgInput)
      : await runAgentCodegen(wbAgInput);

    // Take screenshots if render succeeded
    let agScreenshots: RenderedScreenshot[] = [];
    if (agResult.renderSuccess && agResult.renderedFiles.length > 0) {
      onProgress?.("evaluating", "Taking screenshots...");
      try {
        const stlFile = agResult.renderedFiles.find(f => f.filename.toLowerCase().endsWith(".stl"));
        if (stlFile) {
          const ssResult = await renderModelScreenshots(
            { modelData: stlFile.contentBase64, format: "stl", width: 512, height: 512 },
          );
          agScreenshots = ssResult.images;
        }
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "agent: screenshot failed (non-fatal)");
      }
    }

    // VLM evaluation (pass STL data for zoom capability)
    let agEvalResult: EvaluationResult | null = null;
    const agStlFile = agResult.renderedFiles.find(f => f.filename.toLowerCase().endsWith(".stl"));
    if (agScreenshots.length > 0) {
      onProgress?.("evaluating", "Evaluating quality...");
      const vlmImages = agScreenshots.filter(s => s.angle !== "isometric").map(s => ({ angle: s.angle, base64: s.base64 }));
      if (vlmImages.length > 0) {
        agEvalResult = await evaluateModel({
          userPrompt: ctx.prompt,
          categoryName: ctx.categoryName,
          complexity: ctx.complexity,
          images: vlmImages,
          looksCorrectThreshold: dynLooksCorrect,
          verificationChecklist: specResult?.verificationChecklist,
          stlBase64: agStlFile?.contentBase64,
          modelFormat: "stl",
        });
      }
    }

    const agTotalPromptTokens = agResult.usage.promptTokens + (agEvalResult?.promptTokens ?? 0) + (specResult?.promptTokens ?? 0);
    const agTotalCompletionTokens = agResult.usage.completionTokens + (agEvalResult?.completionTokens ?? 0) + (specResult?.completionTokens ?? 0);
    const agScore = agEvalResult?.score ?? null;
    const agApproved = shouldAutoApprove(agScore, dynAutoApprove, agEvalResult?.checklistResults);

    const exampleId = crypto.randomUUID();
    const filePaths = await persistWorkbenchFiles({
      categoryId: ctx.categoryId,
      exampleId,
      renderedFiles: agResult.renderedFiles,
      code: agResult.code,
      screenshots: agScreenshots,
    });

    await insertExample({
      id: exampleId,
      promptId: ctx.promptId,
      iteration: agResult.stepCount,
      code: agResult.code,
      renderStatus: agResult.renderSuccess ? "success" : "error",
      renderError: agResult.renderSuccess ? null : "Agent codegen failed to render",
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
      evalScore: agScore,
      evalIssues: agEvalResult?.issues ?? null,
      evalSuggestions: agEvalResult?.suggestions ?? null,
      evalChecklistResults: agEvalResult?.checklistResults ?? null,
      approvalStatus: agApproved ? "auto_approved" : "pending",
      llmModel: wbAgentModelConfig.label,
      vlmModel: agEvalResult?.vlmModel ?? null,
      promptTokens: agTotalPromptTokens,
      completionTokens: agTotalCompletionTokens,
    });

    logger.info(
      { promptId: ctx.promptId, steps: agResult.stepCount, score: agScore, status: agApproved ? "auto_approved" : "pending" },
      "agent example persisted",
    );

    return {
      exampleId,
      promptId: ctx.promptId,
      iteration: agResult.stepCount,
      code: agResult.code,
      renderStatus: agResult.renderSuccess ? "success" : "error",
      renderError: agResult.renderSuccess ? null : "Agent codegen failed to render",
      evalScore: agScore,
      evalIssues: agEvalResult?.issues ?? null,
      evalSuggestions: agEvalResult?.suggestions ?? null,
      evalChecklistResults: agEvalResult?.checklistResults ?? null,
      approvalStatus: agApproved ? "auto_approved" : "pending",
      llmModel: wbAgentModelConfig.label,
      vlmModel: agEvalResult?.vlmModel ?? null,
    };
  }
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
      evalChecklistResults: null,
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
      evalChecklistResults: null,
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
      stlBase64: stlFile?.contentBase64,
      modelFormat: "stl",
    });
    totalPromptTokens = evalResult.promptTokens;
    totalCompletionTokens = evalResult.completionTokens;
    logger.info({ score: evalResult.score, looksCorrect: evalResult.looksCorrect }, "VLM evaluation result (re-render)");
  } else {
    logger.warn("skipping VLM evaluation, no screenshots (re-render)");
  }

  // 5. Persist files to disk and create new example
  const score = evalResult?.score ?? null;
  const approved = shouldAutoApprove(score, rrAutoApprove, evalResult?.checklistResults);

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
    evalChecklistResults: evalResult?.checklistResults ?? null,
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
    evalChecklistResults: evalResult?.checklistResults ?? null,
    approvalStatus: approved ? "auto_approved" : "pending",
    llmModel: "manual",
    vlmModel: evalResult?.vlmModel ?? null,
  };
}
