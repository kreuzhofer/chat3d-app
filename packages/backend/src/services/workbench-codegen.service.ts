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
  getMultiAgentPipelineTimeoutMs,
} from "./generation-settings.service.js";
import { PipelineTimeoutError } from "../utils/pipeline-errors.js";
import { storeSpecAndEmbedding } from "./workbench-embeddings.service.js";
import { generateSpec, deriveComplexity, type SpecResult } from "./spec-generation.service.js";
import { enrichSpec } from "./spec-enrichment.service.js";
import { runAgentCodegen, runMultiAgentCodegen } from "./agent-codegen.service.js";
import { insertExample, persistWorkbenchFiles } from "./workbench-persist.service.js";
import {
  loadPromptContext,
  resolveCodegenModel,
  shouldAutoApprove,
  earlyExitResult,
  NULL_SCREENSHOTS,
  type PromptContext,
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
  /** Prompt IDs to exclude from RAG retrieval (experiment contamination prevention). */
  excludePromptIds?: string[];
  /** Pipeline timeout in ms — passed to LLM calls so they don't have a tighter inner wall. */
  pipelineTimeoutMs?: number;
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
  return runWithUsageContext({
    workbenchExampleId: promptId,
    source: "workbench",
  }, async () => {
    logger.info({ promptId }, "starting generation for prompt");

    const startTime = Date.now();
    const timeoutMs = await getPipelineTimeoutMs("workbench");
    const pipelineController = new AbortController();

    let pipelineTimeout: NodeJS.Timeout;
    let activeTimeoutMs = timeoutMs;
    function armTimeout(totalBudgetMs: number) {
      if (pipelineTimeout) clearTimeout(pipelineTimeout);
      activeTimeoutMs = totalBudgetMs;
      const minutes = Math.round(totalBudgetMs / 60_000);
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, totalBudgetMs - elapsed);
      pipelineTimeout = setTimeout(
        () => pipelineController.abort(new PipelineTimeoutError(minutes)),
        remaining,
      );
    }
    armTimeout(timeoutMs);

    const externalSignal = options?.externalSignal;
    if (externalSignal) {
      if (externalSignal.aborted) {
        pipelineController.abort();
      } else {
        externalSignal.addEventListener("abort", () => pipelineController.abort(), { once: true });
      }
    }

    try {
      return await _generateForPromptInner(
        promptId,
        pipelineController.signal,
        { ...options, pipelineTimeoutMs: timeoutMs },
        armTimeout,
      );
    } finally {
      clearTimeout(pipelineTimeout!);
    }
  });
}

async function _generateForPromptInner(
  promptId: string,
  pipelineSignal: AbortSignal,
  options: GenerateOptions | undefined,
  rearmPipelineTimeout: (totalBudgetMs: number) => void,
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
      return await _runPipeline(ctx, llmModelLabel, codegenModelConfig, traceBuilder, traceId, pipelineSignal, options, earlyExampleId, rearmPipelineTimeout);
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
  options: GenerateOptions | undefined,
  earlyExampleId: string | undefined,
  rearmPipelineTimeout: (totalBudgetMs: number) => void,
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

  // 2b. Spec generation — reuse cached spec if available to save tokens
  let specResult: SpecResult | null = null;
  let enrichmentResult: import("./spec-enrichment.service.js").EnrichmentResult | null = null;
  const specEnabled = await isSpecGenerationEnabled("workbench");
  if (specEnabled) {
    const hasCachedSpec = ctx.cachedSpec.constructionSpec && ctx.cachedSpec.specInterpretation;

    if (hasCachedSpec) {
      // Reuse cached spec — skip LLM call
      traceBuilder.startPhase("spec", "spec_generation", "Spec Generation (cached)");
      specResult = {
        interpretation: ctx.cachedSpec.specInterpretation!,
        constructionSpec: ctx.cachedSpec.constructionSpec!,
        codeAssertions: ctx.cachedSpec.codeAssertions ?? [],
        verificationChecklist: ctx.cachedSpec.verificationChecklist ?? [],
        verificationCriteria: ctx.cachedSpec.verificationCriteria ?? [],
        disambiguationNeeded: false,
        disambiguationQuestions: [],
        complexity: deriveComplexity(ctx.prompt, ctx.cachedSpec.specInterpretation!),
        semanticContext: "",
        promptTokens: 0,
        completionTokens: 0,
        // Carry forward the previously-persisted training pair so the
        // post-example persist step writes them back unchanged instead of
        // overwriting with NULL (regression in data-quality td:spec count).
        rawResponse: ctx.cachedSpec.specRawResponse ?? undefined,
        systemPrompt: ctx.cachedSpec.specSystemPrompt ?? undefined,
      };
      logger.info({ promptId: ctx.promptId }, "reusing cached spec — skipping spec LLM call");
      traceBuilder.endPhase("completed");
      updateTraceIncremental(traceId, traceBuilder.snapshot());
    } else {
      // No cached spec — generate fresh
      traceBuilder.startPhase("spec", "spec_generation", "Spec Generation");
      onProgress?.("analyzing", "Analyzing prompt specification...");
      const specModelCfg = await getModelForPurposeWithFallback("spec_generation", "conversation");
      traceBuilder.setModel(specModelCfg.label, specModelCfg.provider);
      specResult = await generateSpec(ctx.prompt);

      if (specResult.disambiguationNeeded && !options?.experimentRunId) {
        // Skip disambiguation gate during experiments — approved prompts are pre-validated
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
            excludePromptIds: options?.excludePromptIds,
            sourceCategoryName: ctx.categoryName,
          });
      // Compute LLM cost for the research phase
      // Research uses spec_generation model — resolve config for cost calculation
      let researchLlmCost = 0;
      if (researchPackage?.llmTokens) {
        try {
          const researchModelCfg = await getModelForPurposeWithFallback("spec_generation", "conversation");
          researchLlmCost = calculateCostUsd(researchModelCfg, researchPackage.llmTokens.prompt, researchPackage.llmTokens.completion);
        } catch { /* cost tracking is non-critical */ }
      }
      traceBuilder.addUsage({
        inputTokens: researchPackage?.llmTokens?.prompt ?? 0,
        outputTokens: researchPackage?.llmTokens?.completion ?? 0,
        costUsd: researchLlmCost,
      });
      traceBuilder.endPhase("completed", {
        researchExamples: researchPackage?.examples.length ?? 0,
        researchKnowledge: researchPackage?.knowledge.length ?? 0,
        researchGaps: researchPackage?.gapWarnings.length ?? 0,
      });
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
        enrichmentResult = enriched;
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
  if (wbUseMultiAgent) {
    traceBuilder.setPipelineType("multi_agent");
    // Multi-agent decomposition + parallel sub-agents + assembly is much
    // wall-clock heavier than single-agent. Bump the pipeline budget so
    // assembly isn't squeezed by the single-agent timeout.
    const multiAgentTimeoutMs = await getMultiAgentPipelineTimeoutMs("workbench");
    const baseTimeoutMs = options?.pipelineTimeoutMs ?? 0;
    if (multiAgentTimeoutMs > baseTimeoutMs) {
      rearmPipelineTimeout(multiAgentTimeoutMs);
      logger.info({ multiAgentTimeoutMin: Math.round(multiAgentTimeoutMs / 60_000) }, "extended pipeline timeout for multi-agent");
    }
  }

  const agCodeEvalWeight = await getCodeEvalWeight("workbench");

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
    excludePromptIds: options?.excludePromptIds,
    pipelineTimeoutMs: options?.pipelineTimeoutMs,
    traceId,
    constructionSpec: specResult?.constructionSpec,
    verificationChecklist: specResult?.verificationChecklist,
    annotatedCriteria: specResult?.verificationCriteria,
    categoryName: ctx.categoryName,
    promptComplexity: ctx.complexity,
    codeEvalWeight: agCodeEvalWeight,
  };

  const agResult = wbUseMultiAgent
    ? await runMultiAgentCodegen(wbAgInput)
    : await runAgentCodegen(wbAgInput);
  updateTraceIncremental(traceId, traceBuilder.snapshot());

  if (pipelineSignal.aborted) {
    return persistAbortedPipeline(ctx, agResult, wbAgentModelConfig, traceBuilder, traceId, options?.experimentRunId);
  }

  const agAllCode = flattenForEval(agResult.files.length > 1 ? agResult.files : [{ path: "main.py", content: agResult.code }]);

  // Reuse agent screenshots if available (from evaluate_model/submit_result), otherwise take new ones
  let agScreenshots: RenderedScreenshot[] = [];
  let screenshotFailed = false;
  if (agResult.screenshots.length > 0) {
    // Agent already took screenshots during its loop — reuse them (saves ~10s + avoids screenshot service failures)
    agScreenshots = agResult.screenshots;
    logger.info({ count: agScreenshots.length }, "reusing agent screenshots — skipping redundant screenshot call");
  } else if (agResult.renderSuccess && agResult.renderedFiles.length > 0) {
    // Fallback: agent didn't take screenshots (e.g., never called evaluate_model) — take them now
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
      screenshotFailed = true;
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "screenshot failed — VLM eval will be skipped, example cannot be auto-approved");
      traceBuilder.endPhase("failed", { error: err instanceof Error ? err.message : String(err) });
    }
    updateTraceIncremental(traceId, traceBuilder.snapshot());
  }

  // When the agent submitted successfully, it already ran the full eval pipeline
  // (assertions + code review + VLM + composite) inside submit_result. Trust that result
  // instead of re-running — eliminates the dual-judge problem and saves tokens.
  // Only run post-loop eval when the agent didn't submit (step limit, abort, etc.).
  let agFullEval: FullEvalResult | null = null;

  if (agResult.submitted && agResult.evalResult) {
    // Reuse agent's in-loop full eval result — same pipeline, same score
    logger.info({ score: agResult.evalResult.score, visualScore: agResult.evalResult.visualScore, codeScore: agResult.evalResult.codeScore }, "reusing agent in-loop eval result — skipping post-loop eval");
    agFullEval = {
      compositeScore: agResult.evalResult.score,
      visualScore: agResult.evalResult.visualScore,
      codeScore: agResult.evalResult.codeScore,
      assertionPassRate: agResult.evalResult.assertionPassRate,
      assertionsFailed: false, // agent wouldn't have submitted if assertions failed
      source: "agent_submitted",
      vlmIssues: agResult.evalResult.issues.filter(i => !i.startsWith("[CODE]")),
      vlmSuggestions: agResult.evalResult.suggestions,
      codeIssues: agResult.evalResult.issues.filter(i => i.startsWith("[CODE]")),
      checklistResults: undefined,
      vlmModel: agResult.evalResult.vlmModel,
      codeReviewModel: agResult.evalResult.codeReviewModel,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      vlmRawResponse: agResult.evalResult.vlmRawResponse,
      vlmReasoning: agResult.evalResult.vlmReasoning,
      vlmSystemPrompt: agResult.evalResult.vlmSystemPrompt,
      codeReviewRawResponse: agResult.evalResult.codeReviewRawResponse,
      codeReviewReasoning: agResult.evalResult.codeReviewReasoning,
      codeReviewSystemPrompt: agResult.evalResult.codeReviewSystemPrompt,
    };
  } else if (agScreenshots.length > 0 || agAllCode.trim()) {
    // Agent didn't submit — run full eval post-loop
    onProgress?.("evaluating", "Evaluating quality...");
    const agStlFile = agResult.renderedFiles.find(f => f.filename.toLowerCase().endsWith(".stl"));
    const vlmImages = agScreenshots.filter(s => s.angle !== "isometric").map(s => ({ angle: s.angle, base64: s.base64 }));

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
    });
    updateTraceIncremental(traceId, traceBuilder.snapshot());
  }

  let totalPipelinePromptTokens = agResult.usage.promptTokens + (agFullEval?.totalPromptTokens ?? 0) + (specResult?.promptTokens ?? 0);
  let totalPipelineCompletionTokens = agResult.usage.completionTokens + (agFullEval?.totalCompletionTokens ?? 0) + (specResult?.completionTokens ?? 0);
  let finalScore = agFullEval?.compositeScore ?? null;
  // VLM is mandatory: if screenshots failed and no agent VLM score, never auto-approve
  const vlmMissing = screenshotFailed && !(agResult.submitted && agResult.evalResult);
  let finalApproved = vlmMissing
    ? false
    : agFullEval?.assertionsFailed
      ? false
      : shouldAutoApprove(finalScore, dynAutoApprove, agFullEval?.checklistResults, agResult.renderSuccess);
  if (vlmMissing) {
    logger.warn({ exampleId: earlyExampleId }, "screenshots failed, VLM eval skipped — blocking auto-approval");
  }

  // ── Fix loop: feed eval failures back to a lightweight fix agent ──
  const MAX_FIX_ATTEMPTS = 2;
  let currentResult = agResult;
  let currentEval = agFullEval;
  let currentScreenshots = agScreenshots;
  let currentCode = agAllCode;

  if (!finalApproved && finalScore !== null && finalScore >= 4 && !pipelineSignal.aborted && !vlmMissing) {
    for (let fixAttempt = 1; fixAttempt <= MAX_FIX_ATTEMPTS; fixAttempt++) {
      const issues = [...(currentEval?.vlmIssues ?? []), ...(currentEval?.codeIssues ?? [])];
      if (issues.length === 0) break;

      logger.info({ fixAttempt, score: finalScore, issueCount: issues.length, promptId: ctx.promptId }, "starting fix attempt — feeding eval issues back to agent");
      onProgress?.("fixing", `Fix attempt ${fixAttempt}/${MAX_FIX_ATTEMPTS}: addressing ${issues.length} eval issues...`);
      traceBuilder.startPhase(`fix-${fixAttempt}`, "fix_agent", `Fix Attempt ${fixAttempt}`);

      const fixFiles = new Map(currentResult.files.map(f => [f.path, f.content]));
      const issueList = issues.map(i => `- ${i}`).join("\n");
      const fixMessage = `Your previous code scored ${finalScore}/10 (need ${dynAutoApprove} to pass). Fix these issues:\n${issueList}\n\nView the existing code, make targeted fixes for the issues above, then validate, render, and resubmit.`;

      try {
        const fixResult = await runAgentCodegen({
          ...wbAgInput,
          isModification: true,
          initialFiles: fixFiles,
          maxSteps: 5,
          userMessageOverride: fixMessage,
          previousMessages: currentResult.conversationHistory,
          traceNodeId: `fix-agent-${fixAttempt}`,
          traceLabel: `Fix Agent ${fixAttempt}`,
          traceSkipAutoEdge: true,
        });

        if (pipelineSignal.aborted) {
          traceBuilder.endPhase("failed", { error: "aborted" });
          break;
        }

        // Re-evaluate with fixed code
        const fixCode = flattenForEval(fixResult.files.length > 1 ? fixResult.files : [{ path: "main.py", content: fixResult.code }]);
        const fixScreenshots = fixResult.screenshots.length > 0 ? fixResult.screenshots : currentScreenshots;
        const fixStl = fixResult.renderedFiles.find(f => f.filename.toLowerCase().endsWith(".stl"));
        const fixVlmImages = fixScreenshots.filter(s => s.angle !== "isometric").map(s => ({ angle: s.angle, base64: s.base64 }));
        const fixCodeEvalWeight = await getCodeEvalWeight("workbench");

        const fixEval = await runFullEvaluation({
          code: fixCode, userPrompt: ctx.prompt,
          specInterpretation: specResult?.interpretation,
          codeAssertions: specResult?.codeAssertions,
          images: fixVlmImages, categoryName: ctx.categoryName, complexity: ctx.complexity,
          verificationChecklist: specResult?.verificationChecklist,
          constructionSpec: specResult?.constructionSpec,
          annotatedCriteria: specResult?.verificationCriteria,
          stlBase64: fixStl?.contentBase64, modelFormat: "stl",
          codeEvalWeight: fixCodeEvalWeight,
        });

        totalPipelinePromptTokens += fixResult.usage.promptTokens + (fixEval?.totalPromptTokens ?? 0);
        totalPipelineCompletionTokens += fixResult.usage.completionTokens + (fixEval?.totalCompletionTokens ?? 0);
        finalScore = fixEval?.compositeScore ?? finalScore;

        const fixApproved = fixEval?.assertionsFailed
          ? false
          : shouldAutoApprove(finalScore, dynAutoApprove, fixEval?.checklistResults, fixResult.renderSuccess);

        logger.info({ fixAttempt, newScore: finalScore, approved: fixApproved, promptId: ctx.promptId }, "fix attempt completed");
        traceBuilder.endPhase("completed");
        updateTraceIncremental(traceId, traceBuilder.snapshot());

        if (fixApproved || (finalScore !== null && finalScore > (currentEval?.compositeScore ?? 0))) {
          // Improved or approved — use fix result
          currentResult = fixResult;
          currentEval = fixEval;
          currentScreenshots = fixScreenshots;
          currentCode = fixCode;
          agFullEval = fixEval;
          finalApproved = fixApproved;
        }
        if (fixApproved) break;
      } catch (err) {
        logger.warn({ fixAttempt, err: err instanceof Error ? err.message : String(err) }, "fix attempt failed");
        traceBuilder.endPhase("failed", { error: err instanceof Error ? err.message : String(err) });
        updateTraceIncremental(traceId, traceBuilder.snapshot());
        break;
      }
    }
  }

  const storedCode = currentCode;
  const exampleId = earlyExampleId ?? crypto.randomUUID();
  const filePaths = await persistWorkbenchFiles({
    categoryId: ctx.categoryId, exampleId,
    renderedFiles: currentResult.renderedFiles, code: storedCode, screenshots: currentScreenshots,
  });

  const mergedIssues = [...(agFullEval?.vlmIssues ?? []), ...(agFullEval?.codeIssues ?? [])];
  const renderStatus = currentResult.renderSuccess ? "success" as const : "error" as const;
  const renderError = currentResult.renderSuccess ? null : "Agent codegen failed to render";
  const approvalStatus = finalApproved ? "auto_approved" as const : "pending" as const;
  const evalIssues = mergedIssues.length > 0 ? mergedIssues : null;

  await insertExample({
    id: exampleId, promptId: ctx.promptId, iteration: currentResult.stepCount, code: storedCode,
    renderStatus, renderError,
    stlPath: filePaths.stlPath, stepPath: filePaths.stepPath, threemfPath: filePaths.threemfPath,
    screenshotFront: filePaths.screenshotFrontPath, screenshotBack: filePaths.screenshotBackPath,
    screenshotLeft: filePaths.screenshotLeftPath, screenshotRight: filePaths.screenshotRightPath,
    screenshotTop: filePaths.screenshotTopPath, screenshotBottom: filePaths.screenshotBottomPath,
    screenshotOrtho45: filePaths.screenshotOrtho45Path, screenshotOrtho45Bottom: filePaths.screenshotOrtho45BottomPath,
    screenshotIso: filePaths.screenshotIsoPath, screenshotIsoBack: filePaths.screenshotIsoBackPath,
    evalScore: finalScore, evalIssues, evalSuggestions: agFullEval?.vlmSuggestions ?? null,
    evalChecklistResults: agFullEval?.checklistResults ?? null, approvalStatus,
    llmModel: wbAgentModelConfig.label, vlmModel: agFullEval?.vlmModel ?? null,
    promptTokens: totalPipelinePromptTokens, completionTokens: totalPipelineCompletionTokens,
    visualScore: agFullEval?.visualScore ?? null, codeEvalScore: agFullEval?.codeScore ?? null,
    assertionPassRate: agFullEval?.assertionPassRate ?? null, evalSource: agFullEval?.source ?? null,
    experimentRunId: options?.experimentRunId,
    vlmRawResponse: agFullEval?.vlmRawResponse ?? null,
    vlmReasoning: agFullEval?.vlmReasoning ?? null,
    vlmSystemPrompt: agFullEval?.vlmSystemPrompt ?? null,
    codeReviewRawResponse: agFullEval?.codeReviewRawResponse ?? null,
    codeReviewReasoning: agFullEval?.codeReviewReasoning ?? null,
    codeReviewSystemPrompt: agFullEval?.codeReviewSystemPrompt ?? null,
    agentConversation: agResult?.conversationHistory ?? null,
    agentSystemPrompt: agResult?.systemPrompt ?? null,
  });

  // Persist all spec outputs on the prompt for future re-render/re-eval use.
  // Awaited so the example never lands in DB without its spec — earlier
  // fire-and-forget pattern produced orphan examples when the update
  // crashed silently.
  if (specResult) {
    try {
      await prisma.workbenchExamplePrompt.update({
        where: { id: ctx.promptId },
        data: {
          specInterpretation: specResult.interpretation,
          codeAssertions: specResult.codeAssertions as unknown as undefined,
          verificationChecklist: specResult.verificationChecklist,
          verificationCriteria: specResult.verificationCriteria as unknown as undefined,
          constructionSpec: specResult.constructionSpec || null,
          specRawResponse: specResult.rawResponse ?? null,
          specSystemPrompt: specResult.systemPrompt ?? null,
          ...(enrichmentResult ? {
            enrichmentRawResponse: enrichmentResult.rawResponse ?? null,
            enrichmentSystemPrompt: enrichmentResult.systemPrompt ?? null,
            enrichmentUserMessage: enrichmentResult.userMessage ?? null,
          } : {}),
        },
      });
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "failed to persist spec fields (non-fatal)");
    }

    // Spec embedding is independent — leave fire-and-forget since it's only
    // used by the remix-candidate path and a missing one is recoverable.
    if (specResult.constructionSpec) {
      storeSpecAndEmbedding(ctx.promptId, specResult.constructionSpec)
        .catch(err => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "failed to store spec embedding (non-fatal)"));
    }
  }

  // Finalize trace
  traceBuilder.endPhase("completed");
  await finalizeTrace(traceId, { workbenchExampleId: exampleId, trace: traceBuilder.build(), summary: traceBuilder.computeSummary() });

  return {
    exampleId, promptId: ctx.promptId, iteration: currentResult.stepCount, code: storedCode,
    renderStatus, renderError, evalScore: finalScore, evalIssues,
    evalSuggestions: agFullEval?.vlmSuggestions ?? null, evalChecklistResults: agFullEval?.checklistResults ?? null,
    approvalStatus, llmModel: wbAgentModelConfig.label, vlmModel: agFullEval?.vlmModel ?? null,
  };
}

