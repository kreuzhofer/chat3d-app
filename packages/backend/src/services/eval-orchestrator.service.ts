/**
 * Evaluation Orchestrator
 *
 * Runs eval tracks sequentially in cost order with early exit:
 *   1. Assertions (free, deterministic) — hard-fail → stop, skip all LLM calls
 *   2. Code review LLM (cheap) — runs next
 *   3. VLM visual eval (expensive) — runs last, only if code review passed
 *
 * Handles partial failures gracefully (code review fails → visual-only, etc.).
 */

import { evaluateModel, type LabeledImage, type ChecklistResult } from "./visual-eval.service.js";
import { evaluateCode, type CodeEvalInput } from "./code-eval.service.js";
import { checkAssertions, type AssertionCheckSummary } from "./code-eval-assertions.service.js";
import { computeCompositeScore, resolveCodeEvalWeight, type ResolvedWeight } from "./code-eval-composite.service.js";
import { renderHighResScreenshots, resolveUncertainItems } from "./visual-eval-zoom.service.js";
import { isUncertain } from "./visual-eval-parser.service.js";
import type { CodeAssertion } from "./spec-generation.service.js";
import type { ModelFormat } from "./stl-rendering-client.service.js";
import { createLogger } from "../utils/logger.js";
import { deriveVisualChecklist } from "../utils/verification-criteria.js";
import { getTraceBuilder } from "./trace-builder.service.js";
import { getModelForPurposeWithFallback, calculateCostUsd } from "./llm-config.service.js";
import { isZoomFollowUpEnabled, getZoomResolution, getZoomMaxFollowUps, isAdaptiveWeightEnabled, getAdaptiveWeightRange } from "./generation-settings.service.js";
import { RENDER_ANGLE_NAMES, type EvalPlan } from "../utils/eval-plan.js";

const logger = createLogger("eval-orchestrator");

/** Code review score at or below this threshold skips VLM to save cost. */
const CODE_REVIEW_SKIP_VLM_THRESHOLD = 3;

// ── Input / Output Types ──────────────────────────────────────────────

export interface FullEvalInput {
  code: string;
  userPrompt: string;
  specInterpretation?: string;
  codeAssertions?: CodeAssertion[];
  codegenSystemPrompt?: string;
  images: LabeledImage[];
  categoryName: string;
  complexity: number;
  verificationChecklist?: string[];
  stlBase64?: string;
  modelFormat?: ModelFormat;
  codeEvalWeight: number;
  /** Precise geometric blueprint — used by code eval and VLM for objective structural checks. */
  constructionSpec?: string;
  /** Annotated verification criteria with visibility routing (visual/code/both). */
  annotatedCriteria?: import("./spec-generation.service.js").AnnotatedCriterion[];
  /** Pre-filled VLM score from agent eval — skip VLM call if provided. */
  agentVlmScore?: { score: number; issues: string[]; suggestions: string[]; vlmModel: string };
  /** Per-prompt eval directive: narrows VLM angles + drives dynamic VLM prompt. Null = legacy global pipeline. */
  evalPlan?: EvalPlan | null;
}

export interface FullEvalResult {
  compositeScore: number;
  visualScore: number | null;
  codeScore: number | null;
  assertionPassRate: number | null;
  assertionsFailed: boolean;
  source: string;
  /** Which branch of the weight resolver produced the effective code-eval weight. */
  compositeWeightSource: "eval_plan" | "adaptive" | "global" | null;
  vlmIssues: string[];
  vlmSuggestions: string[];
  codeIssues: string[];
  checklistResults?: ChecklistResult[];
  vlmModel: string | null;
  codeReviewModel: string | null;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  /** Raw VLM response text for training data capture. */
  vlmRawResponse?: string;
  /** VLM reasoning/thinking tokens for training data capture. */
  vlmReasoning?: string;
  /** System prompt used for VLM evaluation, for training data capture. */
  vlmSystemPrompt?: string;
  /** Raw code review response for training data capture. */
  codeReviewRawResponse?: string;
  /** Code review reasoning/thinking tokens for training data capture. */
  codeReviewReasoning?: string;
  /** System prompt used for code review, for training data capture. */
  codeReviewSystemPrompt?: string;
}

// ── Helper: build result ──────────────────────────────────────────────

function buildResult(opts: {
  visualScore: number | null;
  codeScore: number | null;
  assertionPassRate: number | null;
  assertionsFailed: boolean;
  codeEvalWeight: number;
  compositeWeightSource: ResolvedWeight["source"] | null;
  vlmIssues: string[];
  vlmSuggestions: string[];
  codeIssues: string[];
  checklistResults?: ChecklistResult[];
  vlmModel: string | null;
  codeReviewModel: string | null;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  annotatedCriteria?: import("./spec-generation.service.js").AnnotatedCriterion[];
  adaptiveWeightRange?: number;
  vlmRawResponse?: string;
  vlmReasoning?: string;
  vlmSystemPrompt?: string;
  codeReviewRawResponse?: string;
  codeReviewReasoning?: string;
  codeReviewSystemPrompt?: string;
}): FullEvalResult {
  const composite = computeCompositeScore(
    opts.visualScore, opts.codeScore, opts.assertionPassRate, opts.codeEvalWeight,
    opts.annotatedCriteria, opts.adaptiveWeightRange,
    opts.compositeWeightSource ?? undefined,
  );
  return {
    compositeScore: composite.compositeScore,
    visualScore: opts.visualScore,
    codeScore: opts.codeScore,
    assertionPassRate: opts.assertionPassRate,
    assertionsFailed: opts.assertionsFailed,
    source: composite.source,
    compositeWeightSource: opts.compositeWeightSource,
    vlmIssues: opts.vlmIssues,
    vlmSuggestions: opts.vlmSuggestions,
    codeIssues: opts.codeIssues,
    checklistResults: opts.checklistResults,
    vlmModel: opts.vlmModel,
    codeReviewModel: opts.codeReviewModel,
    totalPromptTokens: opts.totalPromptTokens,
    totalCompletionTokens: opts.totalCompletionTokens,
    vlmRawResponse: opts.vlmRawResponse,
    vlmReasoning: opts.vlmReasoning,
    vlmSystemPrompt: opts.vlmSystemPrompt,
    codeReviewRawResponse: opts.codeReviewRawResponse,
    codeReviewReasoning: opts.codeReviewReasoning,
    codeReviewSystemPrompt: opts.codeReviewSystemPrompt,
  };
}

// ── Main orchestrator ─────────────────────────────────────────────────

export async function runFullEvaluation(input: FullEvalInput): Promise<FullEvalResult> {
  const hasAssertions = (input.codeAssertions?.length ?? 0) > 0;
  const hasImages = input.images.length > 0;
  const tb = getTraceBuilder();

  tb?.startPhase("eval", "eval_orchestration", "Evaluation Pipeline");

  // Resolve the effective code-eval weight once, up front. The orchestrator's
  // caller passes the global default via `codeEvalWeight`; per-prompt evalPlan
  // and visibility-annotated criteria can override or adapt it.
  const adaptiveEnabled = await isAdaptiveWeightEnabled();
  const adaptiveRange = adaptiveEnabled ? await getAdaptiveWeightRange() : 0;
  const resolvedWeight: ResolvedWeight = resolveCodeEvalWeight({
    globalDefault: input.codeEvalWeight,
    evalPlan: input.evalPlan ?? null,
    annotatedCriteria: input.annotatedCriteria ?? null,
    adaptiveWeightRange: adaptiveRange,
  });

  logger.info(
    {
      imageCount: input.images.length,
      assertionCount: input.codeAssertions?.length ?? 0,
      codeEvalWeight: input.codeEvalWeight,
      effectiveWeight: resolvedWeight.weight,
      weightSource: resolvedWeight.source,
    },
    "starting evaluation pipeline (assertions → code review → VLM)",
  );

  // ── Phase 1: Assertions (free, deterministic) ───────────────────────
  let assertionSummary: AssertionCheckSummary | null = null;
  if (hasAssertions) {
    tb?.startPhase("eval-assert", "eval_assertions", "Assertions", "eval");
    assertionSummary = await checkAssertions(input.code, input.codeAssertions!);
    logger.info(
      {
        total: assertionSummary.total,
        checked: assertionSummary.checked,
        passed: assertionSummary.passed,
        failed: assertionSummary.failed,
        passRate: assertionSummary.passRate,
        results: assertionSummary.results.map(r => r.detail),
        issues: assertionSummary.issues,
      },
      "phase 1: assertion check completed",
    );

    tb?.endPhase(assertionSummary.failed > 0 ? "failed" : "completed");

    // Hard-fail: any matched assertion fails → cap at 2, skip all LLM calls
    if (assertionSummary.failed > 0) {
      logger.info(
        { failedCount: assertionSummary.failed, issues: assertionSummary.issues },
        "assertions failed — skipping code review LLM and VLM (cost saving)",
      );

      tb?.addEdge("eval-assert", "eval-code", "caused_skip", `${assertionSummary.failed} assertions failed`);
      tb?.addEdge("eval-assert", "eval-vlm", "caused_skip", `${assertionSummary.failed} assertions failed`);
      tb?.endPhase("completed"); // close eval orchestration

      const result = buildResult({
        visualScore: null, codeScore: null,
        assertionPassRate: assertionSummary.passRate, assertionsFailed: true,
        codeEvalWeight: resolvedWeight.weight,
        compositeWeightSource: resolvedWeight.source,
        vlmIssues: [], vlmSuggestions: [], codeIssues: assertionSummary.issues,
        vlmModel: null, codeReviewModel: null,
        totalPromptTokens: 0, totalCompletionTokens: 0,
      });

      logger.info(
        { compositeScore: result.compositeScore, source: result.source },
        "evaluation pipeline completed (assertion hard-fail)",
      );
      return result;
    }
  }

  // ── Phase 2: Code review LLM (cheap) ───────────────────────────────
  let codeScore: number | null = null;
  let codeIssues: string[] = [];
  let criticalAngles: string[] = [];
  let codeReviewModel: string | null = null;
  let codePromptTokens = 0;
  let codeCompletionTokens = 0;
  let codeReviewRawResponse: string | undefined;
  let codeReviewReasoning: string | undefined;
  let codeReviewSystemPrompt: string | undefined;

  tb?.startPhase("eval-code", "eval_code_review", "Code Review LLM", "eval");
  try {
    const codeEvalInput: CodeEvalInput = {
      userPrompt: input.userPrompt,
      code: input.code,
      specInterpretation: input.specInterpretation,
      codeAssertions: undefined, // already ran assertions above
      codegenSystemPrompt: input.codegenSystemPrompt,
      constructionSpec: input.constructionSpec,
      annotatedCriteria: input.annotatedCriteria,
    };

    logger.info("phase 2: running code review LLM");
    const codeResult = await evaluateCode(codeEvalInput);
    codeScore = codeResult.score;
    codeIssues = codeResult.issues;
    criticalAngles = codeResult.criticalAngles;
    codeReviewModel = codeResult.codeReviewModel;
    codePromptTokens = codeResult.promptTokens;
    codeCompletionTokens = codeResult.completionTokens;
    codeReviewRawResponse = codeResult.rawResponse;
    codeReviewReasoning = codeResult.reasoning;
    codeReviewSystemPrompt = codeResult.systemPrompt;

    {
      let codeReviewCost = 0;
      try {
        const cfg = await getModelForPurposeWithFallback("code_review", "conversation");
        codeReviewCost = calculateCostUsd(cfg, codePromptTokens, codeCompletionTokens);
      } catch { /* cost stays 0 */ }
      tb?.addUsage({
        inputTokens: codePromptTokens, outputTokens: codeCompletionTokens,
        costUsd: codeReviewCost,
      });
    }
    if (codeReviewModel) tb?.setModel(codeReviewModel);
    tb?.endPhase("completed");

    logger.info(
      { score: codeResult.score, model: codeResult.codeReviewModel, issueCount: codeResult.issues.length, issues: codeResult.issues },
      "phase 2: code review LLM result",
    );
  } catch (err) {
    tb?.endPhase("failed", { error: err instanceof Error ? err.message : String(err) });
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "code review LLM failed — will continue to VLM");
  }

  // Early exit: if code review score is very low, skip expensive VLM
  if (codeScore !== null && codeScore <= CODE_REVIEW_SKIP_VLM_THRESHOLD) {
    logger.info(
      { codeScore, threshold: CODE_REVIEW_SKIP_VLM_THRESHOLD },
      "code review score too low — skipping VLM (cost saving)",
    );

    tb?.addEdge("eval-code", "eval-vlm", "caused_skip", `score ${codeScore} ≤ threshold ${CODE_REVIEW_SKIP_VLM_THRESHOLD}`);
    tb?.endPhase("completed"); // close eval orchestration

    const result = buildResult({
      visualScore: null, codeScore,
      assertionPassRate: assertionSummary?.passRate ?? null, assertionsFailed: false,
      codeEvalWeight: resolvedWeight.weight,
      compositeWeightSource: resolvedWeight.source,
      vlmIssues: [], vlmSuggestions: [], codeIssues,
      vlmModel: null, codeReviewModel,
      totalPromptTokens: codePromptTokens, totalCompletionTokens: codeCompletionTokens,
    });

    logger.info(
      { compositeScore: result.compositeScore, codeScore, source: result.source },
      "evaluation pipeline completed (code review short-circuit)",
    );
    return result;
  }

  // ── Phase 3: VLM visual eval (expensive) ────────────────────────────
  let visualScore: number | null = null;
  let vlmIssues: string[] = [];
  let vlmSuggestions: string[] = [];
  let vlmModel: string | null = null;
  let vlmPromptTokens = 0;
  let vlmCompletionTokens = 0;
  let checklistResults: ChecklistResult[] | undefined;
  let vlmRawResponse: string | undefined;
  let vlmReasoning: string | undefined;
  let vlmSystemPrompt: string | undefined;

  // If agent already provided a VLM score, reuse it instead of calling VLM again
  if (input.agentVlmScore) {
    visualScore = input.agentVlmScore.score;
    vlmIssues = input.agentVlmScore.issues;
    vlmSuggestions = input.agentVlmScore.suggestions;
    vlmModel = input.agentVlmScore.vlmModel;
    logger.info({ agentScore: visualScore }, "phase 3: reusing agent VLM score (skipping VLM call)");
  } else if (hasImages) {
    tb?.startPhase("eval-vlm", "eval_vlm", "VLM Visual Evaluation", "eval");
    try {
      // Filter images by inspection plan, then narrow further by code-review critical angles.
      // Precedence:
      //   1. evalPlan.inspectionPlan.angles: the spec's smallest sufficient set (default = all angles)
      //   2. criticalAngles ∩ candidateAngles: code review's narrowing within that set
      //   3. Always include ortho_45 baseline when criticalAngles narrows
      //   4. Fall back to candidate set when intersection < 3 images
      const allAngles: string[] = [...RENDER_ANGLE_NAMES];
      const candidateAngles = input.evalPlan?.inspectionPlan?.angles ?? allAngles;
      const candidateSet = new Set<string>(candidateAngles);

      const candidateFiltered = input.images.filter(img => candidateSet.has(img.angle));
      let vlmImages = candidateFiltered.length > 0 ? candidateFiltered : input.images;

      if (criticalAngles.length > 0) {
        const angleSet = new Set(criticalAngles.filter(a => candidateSet.has(a)));
        if (candidateSet.has("ortho_45")) angleSet.add("ortho_45"); // baseline overview when in plan
        const filtered = vlmImages.filter(img => angleSet.has(img.angle));
        if (filtered.length >= 3) {
          vlmImages = filtered;
          logger.info(
            { criticalAngles: [...angleSet], originalCount: input.images.length, filteredCount: filtered.length },
            "filtered VLM images to critical angles ∩ inspection plan",
          );
        } else {
          logger.info(
            { criticalAngles, candidateAngles, filteredCount: filtered.length },
            "critical angles ∩ inspection plan yielded < 3 images, using candidate set",
          );
        }
      } else if (candidateFiltered.length > 0 && candidateFiltered.length < input.images.length) {
        logger.info(
          { candidateAngles, originalCount: input.images.length, filteredCount: candidateFiltered.length },
          "filtered VLM images to inspection plan angles",
        );
      }

      // Build effective checklist: filter annotated criteria by visibility (visual + both only)
      // Code-only items and items naming specific dimensions are excluded from
      // the VLM — the code reviewer handles those. deriveVisualChecklist() also
      // falls back to the plain checklist rather than replacing it with an
      // empty list, which is what silently discarded good questions (issue #33).
      const effectiveChecklist = deriveVisualChecklist(
        input.annotatedCriteria,
        input.verificationChecklist,
      );

      logger.info({ imageCount: vlmImages.length }, "phase 3: running VLM visual evaluation");
      const vlmResult = await evaluateModel({
        userPrompt: input.userPrompt,
        categoryName: input.categoryName,
        complexity: input.complexity,
        images: vlmImages,
        verificationChecklist: effectiveChecklist,
        constructionSpec: input.constructionSpec,
        stlBase64: input.stlBase64,
        modelFormat: input.modelFormat,
        evalPlan: input.evalPlan ?? null,
      });

      visualScore = vlmResult.score;
      vlmIssues = vlmResult.issues;
      vlmSuggestions = vlmResult.suggestions;
      vlmModel = vlmResult.vlmModel;
      vlmPromptTokens = vlmResult.promptTokens;
      vlmCompletionTokens = vlmResult.completionTokens;
      checklistResults = vlmResult.checklistResults;
      vlmRawResponse = vlmResult.rawResponse;
      vlmReasoning = vlmResult.reasoning;
      vlmSystemPrompt = vlmResult.systemPrompt;

      // Zoom follow-up for uncertain checklist items
      const hasUncertain = checklistResults?.some(c => isUncertain(c));
      if (hasUncertain && input.stlBase64 && checklistResults) {
        const [zoomEnabled, zoomRes, maxFollowUps] = await Promise.all([
          isZoomFollowUpEnabled(), getZoomResolution(), getZoomMaxFollowUps(),
        ]);
        if (zoomEnabled) {
          try {
            logger.info({ uncertainCount: checklistResults.filter(c => isUncertain(c)).length }, "rendering 2x screenshots for uncertain items");
            const highRes = await renderHighResScreenshots(input.stlBase64, input.modelFormat ?? "stl", zoomRes);
            const zoomResult = await resolveUncertainItems(checklistResults, highRes, maxFollowUps, input.constructionSpec);
            checklistResults = zoomResult.resolvedChecklist;
            vlmPromptTokens += zoomResult.promptTokens;
            vlmCompletionTokens += zoomResult.completionTokens;
            // Record each zoom follow-up as a trace tool call for pipeline analytics
            for (const detail of zoomResult.followUpDetails) {
              tb?.addToolCall({
                toolName: "zoom_followup",
                success: true,
                inputSummary: `question: ${detail.question.slice(0, 80)}, angle: ${detail.angle}`,
                outputSummary: `pass: ${detail.pass}, detail: ${detail.detail.slice(0, 100)}`,
              }, "eval-vlm");
            }
            logger.info({ followUpCount: zoomResult.followUpCount }, "zoom follow-ups completed");
          } catch (err) {
            logger.warn({ err: err instanceof Error ? err.message : String(err) }, "zoom follow-up failed, keeping uncertain results");
          }
        }
      }

      {
        let vlmCost = 0;
        try {
          const cfg = await getModelForPurposeWithFallback("vlm_evaluation", "conversation");
          vlmCost = calculateCostUsd(cfg, vlmPromptTokens, vlmCompletionTokens);
        } catch { /* cost stays 0 */ }
        tb?.addUsage({
          inputTokens: vlmPromptTokens, outputTokens: vlmCompletionTokens,
          costUsd: vlmCost,
        });
      }
      if (vlmModel) tb?.setModel(vlmModel);
      tb?.endPhase("completed");

      logger.info(
        { score: vlmResult.score, model: vlmResult.vlmModel, issueCount: vlmResult.issues.length, issues: vlmResult.issues, suggestions: vlmResult.suggestions },
        "phase 3: VLM visual eval result",
      );
    } catch (err) {
      tb?.endPhase("failed", { error: err instanceof Error ? err.message : String(err) });
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "VLM evaluation failed — proceeding with code-only");
    }
  } else {
    logger.info("phase 3: skipped VLM (no images available)");
  }

  // ── Composite score ─────────────────────────────────────────────────
  tb?.endPhase("completed"); // close eval orchestration
  const assertionPassRate = assertionSummary?.passRate ?? null;
  // Pass the already-resolved weight straight through; resolveCodeEvalWeight
  // already applied adaptive adjustment when applicable, so we deliberately
  // skip the per-call adaptive recomputation in computeCompositeScore.
  const result = buildResult({
    visualScore, codeScore,
    assertionPassRate, assertionsFailed: false,
    codeEvalWeight: resolvedWeight.weight,
    compositeWeightSource: resolvedWeight.source,
    vlmIssues, vlmSuggestions, codeIssues,
    checklistResults, vlmModel, codeReviewModel,
    totalPromptTokens: vlmPromptTokens + codePromptTokens,
    totalCompletionTokens: vlmCompletionTokens + codeCompletionTokens,
    vlmRawResponse, vlmReasoning, vlmSystemPrompt,
    codeReviewRawResponse, codeReviewReasoning, codeReviewSystemPrompt,
  });

  logger.info(
    {
      compositeScore: result.compositeScore,
      visualScore, codeScore, assertionPassRate,
      source: result.source,
    },
    "evaluation pipeline completed",
  );

  return result;
}
