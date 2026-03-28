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
import { runResearch, type ResearchPackage } from "./research-agent.service.js";
import type { RenderedScreenshot } from "./stl-rendering-client.service.js";
import { renderModelScreenshots } from "./stl-rendering-client.service.js";
import { runFullEvaluation, type FullEvalResult } from "./eval-orchestrator.service.js";
import { validatePrompt } from "./workbench-prompt-validation.service.js";
import {
  getAutoApproveThreshold,
  isSpecGenerationEnabled,
  isSpecEnrichmentEnabled,
  getAgentMaxSteps,
  getCodeEvalWeight,
  getPipelineTimeoutMs,
} from "./generation-settings.service.js";
import { storeSpecAndEmbedding } from "./workbench-embeddings.service.js";
import { generateSpec, type SpecResult } from "./spec-generation.service.js";
import { enrichSpec } from "./spec-enrichment.service.js";
import { runAgentCodegen, runMultiAgentCodegen } from "./agent-codegen.service.js";
import { insertExample, persistWorkbenchFiles } from "./workbench-persist.service.js";
import {
  loadPromptContext,
  resolveCodegenModel,
  shouldAutoApprove,
  earlyExitResult,
  NULL_SCREENSHOTS,
} from "./workbench-pipeline-helpers.service.js";
import { persistAbortedPipeline, persistRejectedPrompt } from "./workbench-pipeline-persist.service.js";
import crypto from "node:crypto";

export { wrapInTemplate, stripTemplateBoilerplate } from "../utils/workbench-code-utils.js";
export { reRenderForExample } from "./workbench-rerender.service.js";
// Re-export extracted helpers for backward compat
export { resolveCodegenModel } from "./workbench-pipeline-helpers.service.js";

const logger = createLogger("workbench");

export type ProgressCallback = (state: string, detail: string) => void;
export type TracePublisher = (trace: import("@chat3d/shared").GenerationTrace) => void;

/** Options for generateForPrompt. */
export interface GenerateOptions {
  onProgress?: ProgressCallback;
  tracePublisher?: TracePublisher;
  externalSignal?: AbortSignal;
  /** Override the codegen model (for experiments). */
  codegenModelOverride?: LlmModelConfig;
  /** Tag resulting workbench_example with an experiment run. */
  experimentRunId?: string;
  /** Override the max workbench examples injected (for few-shot experiments). */
  ragMaxExamplesOverride?: number;
}

export interface GenerateResult {
  exampleId: string | null; promptId: string; iteration: number; code: string;
  renderStatus: "success" | "error" | "skipped"; renderError: string | null;
  evalScore: number | null; evalIssues: string[] | null; evalSuggestions: string[] | null;
  evalChecklistResults: Array<{ question: string; pass: boolean | null; detail: string }> | null;
  approvalStatus: "pending" | "auto_approved" | "rejected";
  llmModel: string; vlmModel: string | null;
  disambiguationNeeded?: boolean; disambiguationQuestions?: string[];
}

export async function generateForPrompt(
  promptId: string,
  options?: GenerateOptions,
): Promise<GenerateResult> {
  return runWithUsageContext({ workbenchExampleId: promptId }, async () => {
    logger.info({ promptId }, "starting generation for prompt");

    const timeoutMs = await getPipelineTimeoutMs("workbench");
    const pipelineController = new AbortController();
    const pipelineTimeout = setTimeout(() => pipelineController.abort(), timeoutMs);

    const externalSignal = options?.externalSignal;
    if (externalSignal) {
      if (externalSignal.aborted) {
        pipelineController.abort();
      } else {
        externalSignal.addEventListener("abort", () => pipelineController.abort(), { once: true });
      }
    }

    try {
      return await _generateForPromptInner(promptId, pipelineController.signal, options);
    } finally {
      clearTimeout(pipelineTimeout);
    }
  });
}

async function _generateForPromptInner(
  promptId: string,
  pipelineSignal: AbortSignal,
  options?: GenerateOptions,
): Promise<GenerateResult> {
  // 1. Load context and resolve model (use override if provided)
  const ctx = await loadPromptContext(promptId);
  let llmModelLabel: string;
  let codegenModelConfig: LlmModelConfig;
  if (options?.codegenModelOverride) {
    codegenModelConfig = options.codegenModelOverride;
    llmModelLabel = codegenModelConfig.label;
  } else {
    const resolved = await resolveCodegenModel();
    llmModelLabel = resolved.label;
    codegenModelConfig = resolved.config;
  }

  // Initialize trace builder
  const traceBuilder = new TraceBuilder("single_agent");
  if (options?.tracePublisher) traceBuilder.setOnChange(options.tracePublisher);
  traceBuilder.startPhase("root", "root", "Workbench Generation Pipeline");

  // Create trace row early for incremental persistence
  const traceId = await createTraceEarly({
    promptId,
    pipelineType: "single_agent",
    trace: traceBuilder.snapshot(),
  });

  // Create placeholder example early so the trace can be linked to it.
  // Updated with actual results at the end of the pipeline; stays as "pending"
  // if the pipeline aborts.
  const earlyExampleId = crypto.randomUUID();
  await insertExample({
    id: earlyExampleId,
    promptId,
    iteration: 0,
    code: "",
    renderStatus: "pending",
    renderError: null,
    stlPath: null, stepPath: null, threemfPath: null,
    ...NULL_SCREENSHOTS,
    evalScore: null, evalIssues: null, evalSuggestions: null, evalChecklistResults: null,
    approvalStatus: "pending",
    llmModel: llmModelLabel, vlmModel: null,
    promptTokens: 0, completionTokens: 0,
    experimentRunId: options?.experimentRunId,
  });
  // Link trace to example immediately (without finalizing)
  if (traceId) {
    prisma.generationTrace.update({
      where: { id: traceId },
      data: { workbenchExampleId: earlyExampleId },
    }).catch(() => {}); // non-fatal, fire-and-forget
  }

  return runWithTrace(traceBuilder, async () => {
    try {
      return await _runPipeline(ctx, llmModelLabel, codegenModelConfig, traceBuilder, traceId, pipelineSignal, options, earlyExampleId);
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
  options?: GenerateOptions,
  earlyExampleId?: string,
): Promise<GenerateResult> {
  const onProgress = options?.onProgress;
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
    return persistRejectedPrompt(ctx, validation, llmModelLabel, traceBuilder, traceId, onProgress, options?.experimentRunId);
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

  // 3. Research phase — identify techniques and find relevant examples/knowledge
  let researchPackage: ResearchPackage | null = null;
  if (specResult && !pipelineSignal.aborted) {
    traceBuilder.startPhase("research", "research", "Technique Research");
    onProgress?.("researching", "Finding relevant techniques and examples...");
    try {
      const { detectPromptOperations } = await import("../prompts/system-prompts.js");
      const ops = detectPromptOperations(ctx.prompt, specResult.interpretation);
      researchPackage = options?.ragMaxExamplesOverride === 0
        ? null  // Skip research entirely when zero examples requested
        : await runResearch({
            promptText: ctx.prompt,
            interpretation: specResult.interpretation,
            semanticContext: specResult.semanticContext,
            constructionSpec: specResult.constructionSpec,
            complexity: specResult.complexity,
            detectedOperations: ops,
            signal: pipelineSignal,
            ragMaxExamplesOverride: options?.ragMaxExamplesOverride,
          });
      // Compute LLM cost for the research phase
      // Research uses spec_generation model — resolve config for cost calculation
      let researchLlmCost = 0;
      if (researchPackage.llmTokens) {
        try {
          const researchModelCfg = await getModelForPurposeWithFallback("spec_generation");
          researchLlmCost = calculateCostUsd(researchModelCfg, researchPackage.llmTokens.prompt, researchPackage.llmTokens.completion);
        } catch { /* cost tracking is non-critical */ }
      }
      traceBuilder.addUsage({
        inputTokens: researchPackage.llmTokens?.prompt ?? 0,
        outputTokens: researchPackage.llmTokens?.completion ?? 0,
        costUsd: researchLlmCost,
      });
      traceBuilder.endPhase("completed");
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "research phase failed (continuing without)");
      traceBuilder.endPhase("failed", { error: err instanceof Error ? err.message : String(err) });
    }
    updateTraceIncremental(traceId, traceBuilder.snapshot());
  }

  // 3b. Enrichment pass — refine constructionSpec with researched dimensions
  if (specResult && researchPackage && researchPackage.knowledge.length > 0 && !pipelineSignal.aborted) {
    const enrichmentEnabled = await isSpecEnrichmentEnabled();
    if (enrichmentEnabled && specResult.constructionSpec) {
      traceBuilder.startPhase("enrichment", "spec_enrichment", "Spec Enrichment");
      onProgress?.("enriching", "Enriching specification with reference data...");
      try {
        const enrichModelCfg = await getModelForPurposeWithFallback("spec_generation", "conversation");
        const enriched = await enrichSpec(specResult, researchPackage);
        if (enriched.constructionSpec) {
          specResult = { ...specResult, constructionSpec: enriched.constructionSpec, verificationCriteria: enriched.verificationCriteria };
        }
        traceBuilder.addUsage({
          inputTokens: enriched.promptTokens,
          outputTokens: enriched.completionTokens,
          costUsd: calculateCostUsd(enrichModelCfg, enriched.promptTokens, enriched.completionTokens),
        });
        traceBuilder.endPhase("completed");
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "spec enrichment failed (continuing with rough spec)");
        traceBuilder.endPhase("failed", { error: err instanceof Error ? err.message : String(err) });
      }
      updateTraceIncremental(traceId, traceBuilder.snapshot());
    }
  }

  // 4. Agent codegen — codegenModelConfig is already resolved (from experiment override or purpose map)
  const dynAutoApprove = await getAutoApproveThreshold("workbench");
  const wbAgentModelConfig = codegenModelConfig;
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
    researchPackage,
    ragMaxExamplesOverride: options?.ragMaxExamplesOverride,
    traceId,
    constructionSpec: specResult?.constructionSpec,
  };

  const agResult = wbUseMultiAgent
    ? await runMultiAgentCodegen(wbAgInput)
    : await runAgentCodegen(wbAgInput);
  updateTraceIncremental(traceId, traceBuilder.snapshot());

  if (pipelineSignal.aborted) {
    return persistAbortedPipeline(ctx, agResult, wbAgentModelConfig, traceBuilder, traceId, options?.experimentRunId);
  }

  const agAllCode = flattenForEval(agResult.files.length > 1 ? agResult.files : [{ path: "main.py", content: agResult.code }]);

  // Always take screenshots (needed for workbench UI display)
  let agScreenshots: RenderedScreenshot[] = [];
  if (agResult.renderSuccess && agResult.renderedFiles.length > 0) {
    traceBuilder.startPhase("screenshots", "screenshots", "Screenshots");
    onProgress?.("evaluating", "Taking screenshots...");
    try {
      const stlFile = agResult.renderedFiles.find(f => f.filename.toLowerCase().endsWith(".stl"));
      if (stlFile) {
        const ssResult = await renderModelScreenshots(
          { modelData: stlFile.contentBase64, format: "stl" },
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

  // Always run the full eval pipeline (assertions + code review + composite with adaptive weight).
  // When the agent already submitted (has VLM score), skip the expensive VLM call by passing
  // the agent's score through. This gives us code review + assertions + adaptive weighting
  // without the redundant VLM call.
  let agFullEval: FullEvalResult | null = null;

  if (agScreenshots.length > 0 || agAllCode.trim()) {
    onProgress?.("evaluating", "Evaluating quality...");
    const agStlFile = agResult.renderedFiles.find(f => f.filename.toLowerCase().endsWith(".stl"));
    const agCodeEvalWeight = await getCodeEvalWeight("workbench");
    const vlmImages = agScreenshots.filter(s => s.angle !== "isometric").map(s => ({ angle: s.angle, base64: s.base64 }));

    // Pass agent's VLM score to skip re-calling VLM when agent already submitted
    const agentVlmScore = (agResult.submitted && agResult.evalResult)
      ? { score: agResult.evalResult.score, issues: agResult.evalResult.issues, suggestions: agResult.evalResult.suggestions, vlmModel: agResult.evalResult.vlmModel }
      : undefined;
    if (agentVlmScore) {
      logger.info({ agentScore: agentVlmScore.score }, "running full eval with agent VLM score (skipping VLM call)");
    }

    agFullEval = await runFullEvaluation({
      code: agAllCode, userPrompt: ctx.prompt,
      specInterpretation: specResult?.interpretation,
      codeAssertions: specResult?.codeAssertions,
      images: vlmImages, categoryName: ctx.categoryName, complexity: ctx.complexity,
      verificationChecklist: specResult?.verificationChecklist,
      constructionSpec: specResult?.constructionSpec,
      annotatedCriteria: specResult?.verificationCriteria,
      stlBase64: agStlFile?.contentBase64, modelFormat: "stl",
      codeEvalWeight: agCodeEvalWeight,
      agentVlmScore,
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
  const exampleId = earlyExampleId ?? crypto.randomUUID();
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
    experimentRunId: options?.experimentRunId,
  });

  // Store construction spec + embedding for future remix candidates (always, regardless of remix_enabled)
  if (specResult?.constructionSpec) {
    storeSpecAndEmbedding(ctx.promptId, specResult.constructionSpec)
      .catch(err => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "failed to store spec embedding (non-fatal)"));
  }

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

