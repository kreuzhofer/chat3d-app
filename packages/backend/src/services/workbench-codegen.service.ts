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
  getModelForPurposeWithFallback,
  createProviderModel as createProviderModelFromConfig,
  calculateCostUsd,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { TraceBuilder, runWithTrace } from "./trace-builder.service.js";
import { persistTrace } from "./trace-persistence.service.js";

const logger = createLogger("workbench");
import { renderBuild123d, type RenderedFile } from "./rendering.service.js";
import {
  renderModelScreenshots,
  type RenderedScreenshot,
} from "./stl-rendering-client.service.js";
import { runFullEvaluation, type FullEvalResult } from "./eval-orchestrator.service.js";
import { WorkbenchSeederError } from "./workbench-seeder.service.js";
import { validatePrompt } from "./workbench-prompt-validation.service.js";
import { writeStorageFile } from "./file-storage.service.js";
import {
  getAutoApproveThreshold,
  isSpecGenerationEnabled,
  getAgentMaxSteps,
  getCodeEvalWeight,
} from "./generation-settings.service.js";
import { generateSpec, type SpecResult } from "./spec-generation.service.js";
import { runAgentCodegen, runMultiAgentCodegen } from "./agent-codegen.service.js";
import crypto from "node:crypto";

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

/** Callback for publishing live trace snapshots via SSE. */
export type TracePublisher = (trace: import("@chat3d/shared").GenerationTrace) => void;

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
  visualScore?: number | null;
  codeEvalScore?: number | null;
  assertionPassRate?: number | null;
  evalSource?: string | null;
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
      visualScore: data.visualScore ?? null,
      codeEvalScore: data.codeEvalScore ?? null,
      assertionPassRate: data.assertionPassRate ?? null,
      evalSource: data.evalSource ?? null,
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

export async function generateForPrompt(
  promptId: string,
  onProgress?: ProgressCallback,
  tracePublisher?: TracePublisher,
  externalSignal?: AbortSignal,
): Promise<GenerateResult> {
  return runWithUsageContext({ workbenchExampleId: promptId }, async () => {
    logger.info({ promptId }, "starting generation for prompt");

    // Pipeline-level timeout — aborts the entire pipeline if it takes too long
    const pipelineController = new AbortController();
    const pipelineTimeout = setTimeout(() => pipelineController.abort(), PIPELINE_TIMEOUT_MS);

    // If an external signal is provided (e.g. from job cancellation), wire it to abort the pipeline
    if (externalSignal) {
      if (externalSignal.aborted) {
        pipelineController.abort();
      } else {
        externalSignal.addEventListener("abort", () => pipelineController.abort(), { once: true });
      }
    }

    try {
      return await _generateForPromptInner(promptId, pipelineController.signal, onProgress, tracePublisher);
    } finally {
      clearTimeout(pipelineTimeout);
    }
  });
}

async function _generateForPromptInner(promptId: string, pipelineSignal: AbortSignal, onProgress?: ProgressCallback, tracePublisher?: TracePublisher): Promise<GenerateResult> {

  // 1. Load context and resolve model
  const ctx = await loadPromptContext(promptId);
  logger.debug({ prompt: ctx.prompt, category: ctx.categoryName, complexity: ctx.complexity }, "loaded prompt context");

  const { label: llmModelLabel, config: codegenModelConfig } = await resolveCodegenModel();
  logger.info({ model: llmModelLabel }, "codegen model resolved");

  // Initialize trace builder for this pipeline run
  const traceBuilder = new TraceBuilder("single_agent");
  if (tracePublisher) {
    traceBuilder.setOnChange(tracePublisher);
  }
  traceBuilder.startPhase("root", "root", "Workbench Generation Pipeline");

  // Run the entire pipeline within trace context so inner services can access getTraceBuilder()
  return runWithTrace(traceBuilder, async () => {

  // 2. Validate prompt before expensive codegen pipeline
  traceBuilder.startPhase("validation", "prompt_validation", "Prompt Validation");
  onProgress?.("validating", "Validating prompt...");
  const validation = await validatePrompt(ctx.prompt);
  traceBuilder.addUsage({
    inputTokens: validation.promptTokens,
    outputTokens: validation.completionTokens,
    costUsd: calculateCostUsd(codegenModelConfig, validation.promptTokens, validation.completionTokens),
  });
  traceBuilder.setModel(codegenModelConfig.label, codegenModelConfig.provider);
  traceBuilder.endPhase(validation.valid ? "completed" : "failed");

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
    traceBuilder.startPhase("spec", "spec_generation", "Spec Generation");
    onProgress?.("analyzing", "Analyzing prompt specification...");
    const specModelCfg = await getModelForPurposeWithFallback("spec_generation", "conversation");
    traceBuilder.setModel(specModelCfg.label, specModelCfg.provider);
    specResult = await generateSpec(ctx.prompt);

    if (specResult.disambiguationNeeded) {
      traceBuilder.endPhase("skipped");
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

    logger.info({ interpretation: specResult.interpretation, checklistCount: specResult.verificationChecklist.length }, "spec generated");
    traceBuilder.addUsage({
      inputTokens: specResult.promptTokens,
      outputTokens: specResult.completionTokens,
      costUsd: calculateCostUsd(specModelCfg, specResult.promptTokens, specResult.completionTokens),
    });
    traceBuilder.endPhase("completed");
  }

  // 3. Load dynamic settings
  const dynAutoApprove = await getAutoApproveThreshold("workbench");

  // ── Agent codegen ──
  const wbAgentModelConfig = await getModelForPurposeWithFallback("workbench_codegen", "agent_codegen");
  logger.info({ model: wbAgentModelConfig.label }, "resolved workbench_codegen model");

  {
    const wbAgMaxSteps = await getAgentMaxSteps("workbench");
    const wbUseMultiAgent = specResult?.complexity === "complex";
    if (wbUseMultiAgent) traceBuilder.setPipelineType("multi_agent");
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
      evalThreshold: dynAutoApprove,
      codeAssertions: specResult?.codeAssertions,
      specInterpretation: specResult?.interpretation,
    };

    // Agent codegen phase (traced internally via getTraceBuilder())
    const agResult = wbUseMultiAgent
      ? await runMultiAgentCodegen(wbAgInput)
      : await runAgentCodegen(wbAgInput);

    // Take screenshots if render succeeded
    let agScreenshots: RenderedScreenshot[] = [];
    if (agResult.renderSuccess && agResult.renderedFiles.length > 0) {
      traceBuilder.startPhase("screenshots", "screenshots", "Screenshots");
      onProgress?.("evaluating", "Taking screenshots...");
      try {
        const stlFile = agResult.renderedFiles.find(f => f.filename.toLowerCase().endsWith(".stl"));
        if (stlFile) {
          const ssResult = await renderModelScreenshots(
            { modelData: stlFile.contentBase64, format: "stl", width: 512, height: 512 },
          );
          agScreenshots = ssResult.images;
        }
        traceBuilder.endPhase("completed");
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "agent: screenshot failed (non-fatal)");
        traceBuilder.endPhase("failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Full evaluation (VLM + code eval + assertions in parallel)
    let agFullEval: FullEvalResult | null = null;
    const agStlFile = agResult.renderedFiles.find(f => f.filename.toLowerCase().endsWith(".stl"));
    const agCodeEvalWeight = await getCodeEvalWeight("workbench");
    // Combine all project files for code eval (not just main.py)
    const agAllCode = agResult.files.length > 1
      ? agResult.files.map(f => `# --- ${f.path} ---\n${f.content}`).join("\n\n")
      : agResult.code;
    if (agScreenshots.length > 0 || agAllCode.trim()) {
      // eval_orchestration phase (traced internally via getTraceBuilder())
      onProgress?.("evaluating", "Evaluating quality...");
      const vlmImages = agScreenshots.filter(s => s.angle !== "isometric").map(s => ({ angle: s.angle, base64: s.base64 }));
      agFullEval = await runFullEvaluation({
        code: agAllCode,
        userPrompt: ctx.prompt,
        specInterpretation: specResult?.interpretation,
        codeAssertions: specResult?.codeAssertions,
        images: vlmImages,
        categoryName: ctx.categoryName,
        complexity: ctx.complexity,
        verificationChecklist: specResult?.verificationChecklist,
        stlBase64: agStlFile?.contentBase64,
        modelFormat: "stl",
        codeEvalWeight: agCodeEvalWeight,
      });
    }

    const agTotalPromptTokens = agResult.usage.promptTokens + (agFullEval?.totalPromptTokens ?? 0) + (specResult?.promptTokens ?? 0);
    const agTotalCompletionTokens = agResult.usage.completionTokens + (agFullEval?.totalCompletionTokens ?? 0) + (specResult?.completionTokens ?? 0);
    const agScore = agFullEval?.compositeScore ?? null;
    const agApproved = agFullEval?.assertionsFailed
      ? false // assertion failures → never auto-approve
      : shouldAutoApprove(agScore, dynAutoApprove, agFullEval?.checklistResults);

    const exampleId = crypto.randomUUID();
    const filePaths = await persistWorkbenchFiles({
      categoryId: ctx.categoryId,
      exampleId,
      renderedFiles: agResult.renderedFiles,
      code: agResult.code,
      screenshots: agScreenshots,
    });

    const agMergedIssues = [
      ...(agFullEval?.vlmIssues ?? []),
      ...(agFullEval?.codeIssues ?? []),
    ];

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
      evalIssues: agMergedIssues.length > 0 ? agMergedIssues : null,
      evalSuggestions: agFullEval?.vlmSuggestions ?? null,
      evalChecklistResults: agFullEval?.checklistResults ?? null,
      approvalStatus: agApproved ? "auto_approved" : "pending",
      llmModel: wbAgentModelConfig.label,
      vlmModel: agFullEval?.vlmModel ?? null,
      promptTokens: agTotalPromptTokens,
      completionTokens: agTotalCompletionTokens,
      visualScore: agFullEval?.visualScore ?? null,
      codeEvalScore: agFullEval?.codeScore ?? null,
      assertionPassRate: agFullEval?.assertionPassRate ?? null,
      evalSource: agFullEval?.source ?? null,
    });

    logger.info(
      { promptId: ctx.promptId, steps: agResult.stepCount, score: agScore, source: agFullEval?.source, status: agApproved ? "auto_approved" : "pending" },
      "agent example persisted",
    );

    // Persist execution trace (fire-and-forget)
    traceBuilder.endPhase("completed"); // close root
    const trace = traceBuilder.build();
    const summary = traceBuilder.computeSummary();
    persistTrace({
      workbenchExampleId: exampleId,
      pipelineType: trace.pipelineType,
      trace,
      summary,
    }).catch(err => logger.warn({ err }, "trace persistence failed (non-fatal)"));

    return {
      exampleId,
      promptId: ctx.promptId,
      iteration: agResult.stepCount,
      code: agResult.code,
      renderStatus: agResult.renderSuccess ? "success" : "error",
      renderError: agResult.renderSuccess ? null : "Agent codegen failed to render",
      evalScore: agScore,
      evalIssues: agMergedIssues.length > 0 ? agMergedIssues : null,
      evalSuggestions: agFullEval?.vlmSuggestions ?? null,
      evalChecklistResults: agFullEval?.checklistResults ?? null,
      approvalStatus: agApproved ? "auto_approved" : "pending",
      llmModel: wbAgentModelConfig.label,
      vlmModel: agFullEval?.vlmModel ?? null,
    };
  }

  }); // end runWithTrace
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
  logger.debug({ prompt: ctx.prompt, category: ctx.categoryName }, "loaded prompt context for re-render");

  const rrAutoApprove = await getAutoApproveThreshold("workbench");

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

  // 4. Full evaluation — VLM + code eval in parallel (no assertions for re-renders)
  onProgress?.("evaluating", "Evaluating quality...");
  let rrFullEval: FullEvalResult | null = null;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const vlmImages = screenshots
    .filter((s) => s.angle !== "isometric")
    .map((s) => ({ angle: s.angle, base64: s.base64 }));
  const rrCodeEvalWeight = await getCodeEvalWeight("workbench");
  if (vlmImages.length > 0 || code.trim()) {
    logger.info({ imageCount: vlmImages.length }, "starting full evaluation (re-render)");
    rrFullEval = await runFullEvaluation({
      code,
      userPrompt: ctx.prompt,
      images: vlmImages,
      categoryName: ctx.categoryName,
      complexity: ctx.complexity,
      stlBase64: stlFile?.contentBase64,
      modelFormat: "stl",
      codeEvalWeight: rrCodeEvalWeight,
    });
    totalPromptTokens = rrFullEval.totalPromptTokens;
    totalCompletionTokens = rrFullEval.totalCompletionTokens;
    logger.info({ compositeScore: rrFullEval.compositeScore, source: rrFullEval.source }, "full evaluation result (re-render)");
  } else {
    logger.warn("skipping evaluation, no screenshots and no code (re-render)");
  }

  // 5. Persist files to disk and create new example
  const score = rrFullEval?.compositeScore ?? null;
  const approved = rrFullEval?.assertionsFailed
    ? false
    : shouldAutoApprove(score, rrAutoApprove, rrFullEval?.checklistResults);

  const rrMergedIssues = [
    ...(rrFullEval?.vlmIssues ?? []),
    ...(rrFullEval?.codeIssues ?? []),
  ];

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
    evalIssues: rrMergedIssues.length > 0 ? rrMergedIssues : null,
    evalSuggestions: rrFullEval?.vlmSuggestions ?? null,
    evalChecklistResults: rrFullEval?.checklistResults ?? null,
    approvalStatus: approved ? "auto_approved" : "pending",
    llmModel: "manual",
    vlmModel: rrFullEval?.vlmModel ?? null,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
    visualScore: rrFullEval?.visualScore ?? null,
    codeEvalScore: rrFullEval?.codeScore ?? null,
    assertionPassRate: rrFullEval?.assertionPassRate ?? null,
    evalSource: rrFullEval?.source ?? null,
  });

  onProgress?.("completed", "Done");
  logger.info(
    { exampleId: newExampleId, promptId: ctx.promptId, score, source: rrFullEval?.source, status: approved ? "auto_approved" : "pending" },
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
    evalIssues: rrMergedIssues.length > 0 ? rrMergedIssues : null,
    evalSuggestions: rrFullEval?.vlmSuggestions ?? null,
    evalChecklistResults: rrFullEval?.checklistResults ?? null,
    approvalStatus: approved ? "auto_approved" : "pending",
    llmModel: "manual",
    vlmModel: rrFullEval?.vlmModel ?? null,
  };
}
