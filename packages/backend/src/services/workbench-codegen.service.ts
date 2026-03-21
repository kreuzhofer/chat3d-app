/**
 * Workbench Code Generation Pipeline
 *
 * Incremental trace persistence: saved at pipeline start, updated after each phase.
 */

import { runWithUsageContext } from "./usage-tracking.service.js";
import { createLogger } from "../utils/logger.js";
import { prisma } from "../db/prisma.js";
import {
  getModelForPurposeWithFallback,
  calculateCostUsd,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { TraceBuilder, runWithTrace } from "./trace-builder.service.js";
import {
  createTraceEarly,
  updateTraceIncremental,
  finalizeTrace,
} from "./trace-persistence.service.js";
import { flattenForEval } from "../utils/code-flatten.js";
import type { RenderedScreenshot } from "./stl-rendering-client.service.js";
import { renderModelScreenshots } from "./stl-rendering-client.service.js";
import { runFullEvaluation, type FullEvalResult } from "./eval-orchestrator.service.js";
import { WorkbenchCatalogError } from "./workbench-catalog.service.js";
import { validatePrompt } from "./workbench-prompt-validation.service.js";
import {
  getAutoApproveThreshold,
  isSpecGenerationEnabled,
  getAgentMaxSteps,
  getCodeEvalWeight,
} from "./generation-settings.service.js";
import { generateSpec, type SpecResult } from "./spec-generation.service.js";
import { runAgentCodegen, runMultiAgentCodegen } from "./agent-codegen.service.js";
import { insertExample, persistWorkbenchFiles } from "./workbench-persist.service.js";
import crypto from "node:crypto";

export { wrapInTemplate, stripTemplateBoilerplate } from "../utils/workbench-code-utils.js";
export { reRenderForExample } from "./workbench-rerender.service.js";

const logger = createLogger("workbench");
const PIPELINE_TIMEOUT_MS = 15 * 60 * 1000;

export type ProgressCallback = (state: string, detail: string) => void;
export type TracePublisher = (trace: import("@chat3d/shared").GenerationTrace) => void;

export interface GenerateResult {
  exampleId: string | null; promptId: string; iteration: number; code: string;
  renderStatus: "success" | "error" | "skipped"; renderError: string | null;
  evalScore: number | null; evalIssues: string[] | null; evalSuggestions: string[] | null;
  evalChecklistResults: Array<{ question: string; pass: boolean; detail: string }> | null;
  approvalStatus: "pending" | "auto_approved" | "rejected";
  llmModel: string; vlmModel: string | null;
  disambiguationNeeded?: boolean; disambiguationQuestions?: string[];
}

interface PromptContext {
  promptId: string; prompt: string; categoryId: string; categoryName: string; complexity: number;
}

/** Null screenshot paths for failed/aborted examples. */
const NULL_SCREENSHOTS = {
  screenshotFront: null, screenshotBack: null, screenshotLeft: null, screenshotRight: null,
  screenshotTop: null, screenshotBottom: null, screenshotOrtho45: null,
  screenshotOrtho45Bottom: null, screenshotIso: null, screenshotIsoBack: null,
} as const;

/** Build an early-exit GenerateResult (rejected, aborted, disambiguation, etc.). */
function earlyExitResult(b: { exampleId: string | null; promptId: string; iteration: number; code: string; renderError: string | null; approvalStatus: "pending" | "rejected"; llmModel: string; disambiguationNeeded?: boolean; disambiguationQuestions?: string[] }): GenerateResult {
  return { ...b, renderStatus: b.renderError ? "error" : "skipped", evalScore: null, evalIssues: null, evalSuggestions: null, evalChecklistResults: null, vlmModel: null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveCodegenModel(): Promise<{ model: any; label: string; config: LlmModelConfig }> {
  const cfg = await getModelForPurposeWithFallback("workbench_codegen", "agent_codegen");
  const { createProviderModel: create } = await import("./llm-config.service.js");
  const model = create(cfg);
  return { model, label: cfg.label, config: cfg };
}

async function loadPromptContext(promptId: string): Promise<PromptContext> {
  const row = await prisma.workbenchExamplePrompt.findUnique({
    where: { id: promptId },
    include: { category: true },
  });
  if (!row) throw new WorkbenchCatalogError("Prompt not found", 404);
  return {
    promptId: row.id,
    prompt: row.prompt,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    complexity: row.category.complexity,
  };
}

function shouldAutoApprove(score: number | null, threshold: number, checklistResults?: Array<{ pass: boolean }> | null): boolean {
  if (score === null || score < threshold) return false;
  if (!checklistResults || checklistResults.length === 0) return true;
  return checklistResults.filter(r => r.pass).length / checklistResults.length >= 0.8;
}

export async function generateForPrompt(
  promptId: string,
  onProgress?: ProgressCallback,
  tracePublisher?: TracePublisher,
  externalSignal?: AbortSignal,
): Promise<GenerateResult> {
  return runWithUsageContext({ workbenchExampleId: promptId }, async () => {
    logger.info({ promptId }, "starting generation for prompt");

    const pipelineController = new AbortController();
    const pipelineTimeout = setTimeout(() => pipelineController.abort(), PIPELINE_TIMEOUT_MS);

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

async function _generateForPromptInner(
  promptId: string,
  pipelineSignal: AbortSignal,
  onProgress?: ProgressCallback,
  tracePublisher?: TracePublisher,
): Promise<GenerateResult> {
  // 1. Load context and resolve model
  const ctx = await loadPromptContext(promptId);
  const { label: llmModelLabel, config: codegenModelConfig } = await resolveCodegenModel();

  // Initialize trace builder
  const traceBuilder = new TraceBuilder("single_agent");
  if (tracePublisher) traceBuilder.setOnChange(tracePublisher);
  traceBuilder.startPhase("root", "root", "Workbench Generation Pipeline");

  // Create trace row early for incremental persistence
  const traceId = await createTraceEarly({
    promptId,
    pipelineType: "single_agent",
    trace: traceBuilder.snapshot(),
  });

  return runWithTrace(traceBuilder, async () => {
    try {
      return await _runPipeline(ctx, llmModelLabel, codegenModelConfig, traceBuilder, traceId, pipelineSignal, onProgress);
    } catch (err) {
      // Classify and persist error on the current phase + root
      traceBuilder.endPhaseWithError(err);
      traceBuilder.endPhase("failed", {
        error: err instanceof Error ? err.message : String(err),
        errorInfo: TraceBuilder.classifyError(err),
      });
      const snapshot = traceBuilder.build();
      const summary = traceBuilder.computeSummary();
      updateTraceIncremental(traceId, snapshot, summary);
      throw err;
    }
  });
}

async function _runPipeline(
  ctx: PromptContext,
  llmModelLabel: string,
  codegenModelConfig: LlmModelConfig,
  traceBuilder: TraceBuilder,
  traceId: string | null,
  pipelineSignal: AbortSignal,
  onProgress?: ProgressCallback,
): Promise<GenerateResult> {
  // 2. Validate prompt
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
  updateTraceIncremental(traceId, traceBuilder.snapshot());

  if (!validation.valid) {
    return _persistRejectedPrompt(ctx, validation, llmModelLabel, traceBuilder, traceId, onProgress);
  }

  // 2b. Spec generation
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
      updateTraceIncremental(traceId, traceBuilder.snapshot());
      await prisma.workbenchExamplePrompt.update({
        where: { id: ctx.promptId },
        data: { disambiguationQuestions: specResult.disambiguationQuestions, disambiguationStatus: "needs_review", specInterpretation: specResult.interpretation },
      });
      traceBuilder.endPhase("completed");
      updateTraceIncremental(traceId, traceBuilder.build(), traceBuilder.computeSummary());
      return earlyExitResult({ exampleId: null, promptId: ctx.promptId, iteration: 0, code: "", renderError: null, approvalStatus: "pending", llmModel: llmModelLabel, disambiguationNeeded: true, disambiguationQuestions: specResult.disambiguationQuestions });
    }

    traceBuilder.addUsage({
      inputTokens: specResult.promptTokens, outputTokens: specResult.completionTokens,
      costUsd: calculateCostUsd(specModelCfg, specResult.promptTokens, specResult.completionTokens),
    });
    traceBuilder.endPhase("completed");
    updateTraceIncremental(traceId, traceBuilder.snapshot());
  }

  // 3. Agent codegen
  const dynAutoApprove = await getAutoApproveThreshold("workbench");
  const wbAgentModelConfig = await getModelForPurposeWithFallback("workbench_codegen", "agent_codegen");
  const wbAgMaxSteps = await getAgentMaxSteps("workbench");
  const wbUseMultiAgent = specResult?.complexity === "complex";
  if (wbUseMultiAgent) traceBuilder.setPipelineType("multi_agent");

  onProgress?.("codegen", wbUseMultiAgent
    ? "Orchestrating multi-agent build for complex model..."
    : "Agent is working on your model...");

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
    traceId,
  };

  const agResult = wbUseMultiAgent
    ? await runMultiAgentCodegen(wbAgInput)
    : await runAgentCodegen(wbAgInput);
  updateTraceIncremental(traceId, traceBuilder.snapshot());

  if (pipelineSignal.aborted) {
    return _persistAbortedPipeline(ctx, agResult, wbAgentModelConfig, traceBuilder, traceId);
  }

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
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "screenshot failed (non-fatal)");
      traceBuilder.endPhase("failed", { error: err instanceof Error ? err.message : String(err) });
    }
    updateTraceIncremental(traceId, traceBuilder.snapshot());
  }

  let agFullEval: FullEvalResult | null = null;
  const agStlFile = agResult.renderedFiles.find(f => f.filename.toLowerCase().endsWith(".stl"));
  const agCodeEvalWeight = await getCodeEvalWeight("workbench");
  const agAllCode = flattenForEval(agResult.files.length > 1 ? agResult.files : [{ path: "main.py", content: agResult.code }]);
  if (agScreenshots.length > 0 || agAllCode.trim()) {
    onProgress?.("evaluating", "Evaluating quality...");
    const vlmImages = agScreenshots.filter(s => s.angle !== "isometric").map(s => ({ angle: s.angle, base64: s.base64 }));
    agFullEval = await runFullEvaluation({
      code: agAllCode, userPrompt: ctx.prompt,
      specInterpretation: specResult?.interpretation,
      codeAssertions: specResult?.codeAssertions,
      images: vlmImages, categoryName: ctx.categoryName, complexity: ctx.complexity,
      verificationChecklist: specResult?.verificationChecklist,
      stlBase64: agStlFile?.contentBase64, modelFormat: "stl",
      codeEvalWeight: agCodeEvalWeight,
    });
    updateTraceIncremental(traceId, traceBuilder.snapshot());
  }

  const agTotalPromptTokens = agResult.usage.promptTokens + (agFullEval?.totalPromptTokens ?? 0) + (specResult?.promptTokens ?? 0);
  const agTotalCompletionTokens = agResult.usage.completionTokens + (agFullEval?.totalCompletionTokens ?? 0) + (specResult?.completionTokens ?? 0);
  const agScore = agFullEval?.compositeScore ?? null;
  const agApproved = agFullEval?.assertionsFailed
    ? false
    : shouldAutoApprove(agScore, dynAutoApprove, agFullEval?.checklistResults);

  const storedCode = agAllCode;
  const exampleId = crypto.randomUUID();
  const filePaths = await persistWorkbenchFiles({
    categoryId: ctx.categoryId, exampleId,
    renderedFiles: agResult.renderedFiles, code: storedCode, screenshots: agScreenshots,
  });

  const agMergedIssues = [...(agFullEval?.vlmIssues ?? []), ...(agFullEval?.codeIssues ?? [])];
  const renderStatus = agResult.renderSuccess ? "success" as const : "error" as const;
  const renderError = agResult.renderSuccess ? null : "Agent codegen failed to render";
  const approvalStatus = agApproved ? "auto_approved" as const : "pending" as const;
  const evalIssues = agMergedIssues.length > 0 ? agMergedIssues : null;

  await insertExample({
    id: exampleId, promptId: ctx.promptId, iteration: agResult.stepCount, code: storedCode,
    renderStatus, renderError,
    stlPath: filePaths.stlPath, stepPath: filePaths.stepPath, threemfPath: filePaths.threemfPath,
    screenshotFront: filePaths.screenshotFrontPath, screenshotBack: filePaths.screenshotBackPath,
    screenshotLeft: filePaths.screenshotLeftPath, screenshotRight: filePaths.screenshotRightPath,
    screenshotTop: filePaths.screenshotTopPath, screenshotBottom: filePaths.screenshotBottomPath,
    screenshotOrtho45: filePaths.screenshotOrtho45Path, screenshotOrtho45Bottom: filePaths.screenshotOrtho45BottomPath,
    screenshotIso: filePaths.screenshotIsoPath, screenshotIsoBack: filePaths.screenshotIsoBackPath,
    evalScore: agScore, evalIssues, evalSuggestions: agFullEval?.vlmSuggestions ?? null,
    evalChecklistResults: agFullEval?.checklistResults ?? null, approvalStatus,
    llmModel: wbAgentModelConfig.label, vlmModel: agFullEval?.vlmModel ?? null,
    promptTokens: agTotalPromptTokens, completionTokens: agTotalCompletionTokens,
    visualScore: agFullEval?.visualScore ?? null, codeEvalScore: agFullEval?.codeScore ?? null,
    assertionPassRate: agFullEval?.assertionPassRate ?? null, evalSource: agFullEval?.source ?? null,
  });

  // Finalize trace
  traceBuilder.endPhase("completed");
  await finalizeTrace(traceId, { workbenchExampleId: exampleId, trace: traceBuilder.build(), summary: traceBuilder.computeSummary() });

  return {
    exampleId, promptId: ctx.promptId, iteration: agResult.stepCount, code: storedCode,
    renderStatus, renderError, evalScore: agScore, evalIssues,
    evalSuggestions: agFullEval?.vlmSuggestions ?? null, evalChecklistResults: agFullEval?.checklistResults ?? null,
    approvalStatus, llmModel: wbAgentModelConfig.label, vlmModel: agFullEval?.vlmModel ?? null,
  };
}

async function _persistAbortedPipeline(
  ctx: PromptContext,
  agResult: Awaited<ReturnType<typeof runAgentCodegen>>,
  modelConfig: LlmModelConfig,
  traceBuilder: TraceBuilder,
  traceId: string | null,
): Promise<GenerateResult> {
  logger.info({ promptId: ctx.promptId, stepCount: agResult.stepCount }, "pipeline aborted — skipping screenshots/eval");
  const exampleId = crypto.randomUUID();
  const code = flattenForEval(agResult.files.length > 1 ? agResult.files : [{ path: "main.py", content: agResult.code }]);
  const renderError = "Pipeline aborted (timeout or cancellation)";
  await insertExample({
    id: exampleId, promptId: ctx.promptId, iteration: agResult.stepCount, code,
    renderStatus: "error", renderError,
    stlPath: null, stepPath: null, threemfPath: null, ...NULL_SCREENSHOTS,
    evalScore: null, evalIssues: null, evalSuggestions: null, evalChecklistResults: null,
    approvalStatus: "pending", llmModel: modelConfig.label, vlmModel: null,
    promptTokens: agResult.usage.promptTokens, completionTokens: agResult.usage.completionTokens,
  });
  const abortInfo = TraceBuilder.classifyError(new Error(renderError));
  traceBuilder.endPhase("failed", { error: renderError, errorInfo: abortInfo });
  await finalizeTrace(traceId, { workbenchExampleId: exampleId, trace: traceBuilder.build(), summary: traceBuilder.computeSummary() });
  return earlyExitResult({ exampleId, promptId: ctx.promptId, iteration: agResult.stepCount, code, renderError, approvalStatus: "pending", llmModel: modelConfig.label });
}

/** Insert a rejected-prompt example and finalize trace. */
async function _persistRejectedPrompt(
  ctx: PromptContext,
  validation: { reason?: string; promptTokens: number; completionTokens: number },
  llmModelLabel: string,
  traceBuilder: TraceBuilder,
  traceId: string | null,
  onProgress?: ProgressCallback,
): Promise<GenerateResult> {
  logger.info({ reason: validation.reason }, "prompt rejected by validation");
  onProgress?.("failed", `Prompt validation failed: ${validation.reason}`);
  const exampleId = crypto.randomUUID();
  const renderError = `Prompt validation failed: ${validation.reason}`;
  await insertExample({
    id: exampleId, promptId: ctx.promptId, iteration: 0,
    code: "-- PROMPT VALIDATION REJECTED --", renderStatus: "error", renderError,
    stlPath: null, stepPath: null, threemfPath: null, ...NULL_SCREENSHOTS,
    evalScore: null, evalIssues: null, evalSuggestions: null, evalChecklistResults: null,
    approvalStatus: "rejected", rejectionNote: validation.reason,
    llmModel: llmModelLabel, vlmModel: null,
    promptTokens: validation.promptTokens, completionTokens: validation.completionTokens,
  });
  traceBuilder.endPhase("completed");
  await finalizeTrace(traceId, { workbenchExampleId: exampleId, trace: traceBuilder.build(), summary: traceBuilder.computeSummary() });
  return earlyExitResult({ exampleId, promptId: ctx.promptId, iteration: 0, code: "-- PROMPT VALIDATION REJECTED --", renderError, approvalStatus: "rejected", llmModel: llmModelLabel });
}
