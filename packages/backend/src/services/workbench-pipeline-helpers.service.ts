/**
 * Workbench Pipeline Helpers
 *
 * Pure helpers extracted from workbench-codegen.service.ts:
 * context loading, approval logic, result builders, model resolution.
 */

import { deriveVerdict } from "./approval-gate.service.js";
import { prisma } from "../db/prisma.js";
import { getModelForPurposeWithFallback, type LlmModelConfig } from "./llm-config.service.js";
import { WorkbenchCatalogError } from "./workbench-catalog.service.js";
import type { GenerateResult } from "./workbench-codegen.service.js";
import type { CodeAssertion, AnnotatedCriterion } from "./spec-generation.service.js";
import { toAnnotatedCriteria } from "../utils/verification-criteria.js";

// ── Types ────────────────────────────────────────────────────────────

export interface CachedSpec {
  specInterpretation: string | null;
  constructionSpec: string | null;
  codeAssertions: CodeAssertion[] | null;
  verificationChecklist: string[] | null;
  verificationCriteria: AnnotatedCriterion[] | null;
  // Training-data fields preserved through the cached-spec reuse path so the
  // codegen persist step doesn't overwrite them with NULL on re-generation.
  specRawResponse: string | null;
  specSystemPrompt: string | null;
  requiresDecomposition: boolean | null;
  decompositionReasoning: string | null;
}

export interface PromptContext {
  promptId: string;
  prompt: string;
  categoryId: string;
  categoryName: string;
  complexity: number;
  /** Cached spec fields from previous generation (null values if never generated). */
  cachedSpec: CachedSpec;
}

// ── Constants ────────────────────────────────────────────────────────

/** Null screenshot paths for failed/aborted examples. */
export const NULL_SCREENSHOTS = {
  screenshotFront: null, screenshotBack: null, screenshotLeft: null, screenshotRight: null,
  screenshotTop: null, screenshotBottom: null, screenshotOrtho45: null,
  screenshotOrtho45Bottom: null, screenshotIso: null, screenshotIsoBack: null,
} as const;

// ── Context loading ──────────────────────────────────────────────────

export async function loadPromptContext(promptId: string): Promise<PromptContext> {
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
    cachedSpec: {
      specInterpretation: row.specInterpretation,
      constructionSpec: row.constructionSpec,
      codeAssertions: row.codeAssertions as CodeAssertion[] | null,
      verificationChecklist: row.verificationChecklist as string[] | null,
      // Validated, not asserted — see issue #33.
      verificationCriteria: toAnnotatedCriteria(row.verificationCriteria),
      specRawResponse: row.specRawResponse,
      specSystemPrompt: row.specSystemPrompt,
      requiresDecomposition: row.requiresDecomposition ?? null,
      decompositionReasoning: row.decompositionReasoning ?? null,
    },
  };
}

// ── Model resolution ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveCodegenModel(): Promise<{ model: any; label: string; config: LlmModelConfig }> {
  const cfg = await getModelForPurposeWithFallback("workbench_codegen", "agent_codegen");
  const { createProviderModel: create } = await import("./llm-config.service.js");
  const model = create(cfg);
  return { model, label: cfg.label, config: cfg };
}

// ── Approval logic ───────────────────────────────────────────────────

/**
 * The gate's verdict from its inputs (issue #44, ADR 0001).
 *
 * A gate that could not be performed is not a gate that passed: with no
 * stored items — the prompt asked nothing, the judge did not answer, or the
 * answers were lost — there is no verdict to derive, and the row stays
 * pending. `renderSuccess` is required rather than optional because a guard
 * on a field the caller may omit is not a guard; every caller knows whether
 * its render succeeded.
 */
/**
 * The gate's boolean for callers that only branch on it (ADR 0001, #88):
 * every item must pass, three or more items, the composite as backstop.
 * The rule and its version live in approval-gate.service; this wrapper
 * carries no rule of its own. Assertions are the caller's own branch.
 */
export function shouldAutoApprove(
  score: number | null,
  threshold: number,
  checklistResults: ReadonlyArray<{ pass: boolean | null }> | null | undefined,
  renderSuccess: boolean,
): boolean {
  return deriveVerdict({ renderSuccess, assertionsFailed: false, items: checklistResults, compositeScore: score, threshold }).status === "auto_approved";
}

// ── Result builders ──────────────────────────────────────────────────

/** Build an early-exit GenerateResult (rejected, aborted, disambiguation, etc.). */
export function earlyExitResult(b: {
  exampleId: string | null;
  promptId: string;
  iteration: number;
  code: string;
  renderError: string | null;
  approvalStatus: "pending" | "rejected";
  llmModel: string;
  disambiguationNeeded?: boolean;
  disambiguationQuestions?: string[];
}): GenerateResult {
  return {
    ...b,
    renderStatus: b.renderError ? "error" : "skipped",
    evalScore: null, evalIssues: null, evalSuggestions: null,
    evalChecklistResults: null, vlmModel: null,
  };
}
