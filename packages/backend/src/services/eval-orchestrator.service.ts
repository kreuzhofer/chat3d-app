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
import { computeCompositeScore } from "./code-eval-composite.service.js";
import type { CodeAssertion } from "./spec-generation.service.js";
import type { ModelFormat } from "./stl-rendering-client.service.js";
import { createLogger } from "../utils/logger.js";
import { getTraceBuilder } from "./trace-builder.service.js";

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
}

export interface FullEvalResult {
  compositeScore: number;
  visualScore: number | null;
  codeScore: number | null;
  assertionPassRate: number | null;
  assertionsFailed: boolean;
  source: string;
  vlmIssues: string[];
  vlmSuggestions: string[];
  codeIssues: string[];
  checklistResults?: ChecklistResult[];
  vlmModel: string | null;
  codeReviewModel: string | null;
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

// ── Helper: build result ──────────────────────────────────────────────

function buildResult(opts: {
  visualScore: number | null;
  codeScore: number | null;
  assertionPassRate: number | null;
  assertionsFailed: boolean;
  codeEvalWeight: number;
  vlmIssues: string[];
  vlmSuggestions: string[];
  codeIssues: string[];
  checklistResults?: ChecklistResult[];
  vlmModel: string | null;
  codeReviewModel: string | null;
  totalPromptTokens: number;
  totalCompletionTokens: number;
}): FullEvalResult {
  const composite = computeCompositeScore(
    opts.visualScore, opts.codeScore, opts.assertionPassRate, opts.codeEvalWeight,
  );
  return {
    compositeScore: composite.compositeScore,
    visualScore: opts.visualScore,
    codeScore: opts.codeScore,
    assertionPassRate: opts.assertionPassRate,
    assertionsFailed: opts.assertionsFailed,
    source: composite.source,
    vlmIssues: opts.vlmIssues,
    vlmSuggestions: opts.vlmSuggestions,
    codeIssues: opts.codeIssues,
    checklistResults: opts.checklistResults,
    vlmModel: opts.vlmModel,
    codeReviewModel: opts.codeReviewModel,
    totalPromptTokens: opts.totalPromptTokens,
    totalCompletionTokens: opts.totalCompletionTokens,
  };
}

// ── Main orchestrator ─────────────────────────────────────────────────

export async function runFullEvaluation(input: FullEvalInput): Promise<FullEvalResult> {
  const hasAssertions = (input.codeAssertions?.length ?? 0) > 0;
  const hasImages = input.images.length > 0;
  const tb = getTraceBuilder();

  tb?.startPhase("eval", "eval_orchestration", "Evaluation Pipeline");

  logger.info(
    {
      imageCount: input.images.length,
      assertionCount: input.codeAssertions?.length ?? 0,
      codeEvalWeight: input.codeEvalWeight,
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
        codeEvalWeight: input.codeEvalWeight,
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
  let codeReviewModel: string | null = null;
  let codePromptTokens = 0;
  let codeCompletionTokens = 0;

  tb?.startPhase("eval-code", "eval_code_review", "Code Review LLM", "eval");
  try {
    const codeEvalInput: CodeEvalInput = {
      userPrompt: input.userPrompt,
      code: input.code,
      specInterpretation: input.specInterpretation,
      codeAssertions: undefined, // already ran assertions above
      codegenSystemPrompt: input.codegenSystemPrompt,
    };

    logger.info("phase 2: running code review LLM");
    const codeResult = await evaluateCode(codeEvalInput);
    codeScore = codeResult.score;
    codeIssues = codeResult.issues;
    codeReviewModel = codeResult.codeReviewModel;
    codePromptTokens = codeResult.promptTokens;
    codeCompletionTokens = codeResult.completionTokens;

    tb?.addUsage({
      inputTokens: codePromptTokens, outputTokens: codeCompletionTokens,
      costUsd: 0, // cost tracked by usage-tracking
    });
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
      codeEvalWeight: input.codeEvalWeight,
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

  if (hasImages) {
    tb?.startPhase("eval-vlm", "eval_vlm", "VLM Visual Evaluation", "eval");
    try {
      logger.info("phase 3: running VLM visual evaluation");
      const vlmResult = await evaluateModel({
        userPrompt: input.userPrompt,
        categoryName: input.categoryName,
        complexity: input.complexity,
        images: input.images,
        verificationChecklist: input.verificationChecklist,
        stlBase64: input.stlBase64,
        modelFormat: input.modelFormat,
      });

      visualScore = vlmResult.score;
      vlmIssues = vlmResult.issues;
      vlmSuggestions = vlmResult.suggestions;
      vlmModel = vlmResult.vlmModel;
      vlmPromptTokens = vlmResult.promptTokens;
      vlmCompletionTokens = vlmResult.completionTokens;
      checklistResults = vlmResult.checklistResults;

      tb?.addUsage({
        inputTokens: vlmPromptTokens, outputTokens: vlmCompletionTokens,
        costUsd: 0,
      });
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
  const result = buildResult({
    visualScore, codeScore,
    assertionPassRate, assertionsFailed: false,
    codeEvalWeight: input.codeEvalWeight,
    vlmIssues, vlmSuggestions, codeIssues,
    checklistResults, vlmModel, codeReviewModel,
    totalPromptTokens: vlmPromptTokens + codePromptTokens,
    totalCompletionTokens: vlmCompletionTokens + codeCompletionTokens,
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
