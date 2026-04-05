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

// ── Types ────────────────────────────────────────────────────────────

export interface CachedSpec {
  specInterpretation: string | null;
  constructionSpec: string | null;
  codeAssertions: CodeAssertion[] | null;
  verificationChecklist: string[] | null;
  verificationCriteria: AnnotatedCriterion[] | null;
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
      verificationCriteria: row.verificationCriteria as AnnotatedCriterion[] | null,
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
  return checklistResults.filter(r => r.pass === true).length / checklistResults.length >= 0.8;
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
