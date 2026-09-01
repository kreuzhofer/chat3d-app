/**
 * Workbench Pipeline Helpers
 *
 * Pure helpers extracted from workbench-codegen.service.ts:
 * context loading, approval logic, result builders, model resolution.
 */

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

export function shouldAutoApprove(
  score: number | null,
  threshold: number,
  checklistResults?: Array<{ pass: boolean | null }> | null,
  renderSuccess?: boolean,
): boolean {
  if (renderSuccess === false) return false;
  if (score === null || score < threshold) return false;
  if (!checklistResults || checklistResults.length === 0) return true;
  // Uncertain (null) counts as not-passing for approval purposes
  const passRate = checklistResults.filter(r => r.pass === true).length / checklistResults.length;
  // When both evaluators strongly agree (composite ≥ threshold + 1.5),
  // relax checklist gate to 50% — a single borderline VLM answer shouldn't
  // override strong agreement from both evaluators.
  const relaxedThreshold = score >= threshold + 1.5 ? 0.5 : 0.8;
  return passRate >= relaxedThreshold;
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
