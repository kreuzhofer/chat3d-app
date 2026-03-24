/**
 * Code Evaluation — Composite Score Computation
 *
 * Combines visual (VLM) score, code review score, and assertion pass rate
 * into a single composite score. Assertion failures act as a hard gate.
 * Supports adaptive weighting based on visibility-annotated criteria.
 */

import type { AnnotatedCriterion } from "./spec-generation.service.js";

// ── Types ─────────────────────────────────────────────────────────────

export interface CompositeEvaluation {
  compositeScore: number;
  visualScore: number | null;
  codeScore: number | null;
  assertionPassRate: number | null;
  mergedIssues: string[];
  source: "composite" | "visual_only" | "code_only" | "assertion_fail";
  /** Effective code eval weight after adaptive adjustment (for observability). */
  effectiveCodeEvalWeight?: number;
}

/** Round to 1 decimal place. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Adaptive Weight ──────────────────────────────────────────────────

/**
 * Compute adaptive code eval weight based on visibility distribution.
 * Shifts weight toward code eval when most features are code-only,
 * toward visual when most are visually verifiable.
 */
export function computeAdaptiveWeight(
  baseWeight: number,
  range: number,
  criteria: AnnotatedCriterion[],
): number {
  if (criteria.length === 0) return baseWeight;

  const codeCount = criteria.filter(c => c.visibility === "code").length;
  const bothCount = criteria.filter(c => c.visibility === "both").length;
  const total = criteria.length;

  // codeRatio: 0 = all visual, 1 = all code, 0.5 = balanced
  const codeRatio = (codeCount + 0.5 * bothCount) / total;
  // Shift from base: positive when code-heavy, negative when visual-heavy
  const shift = (codeRatio - 0.5) * range * 2; // range=0.2 → max shift ±0.2

  return Math.max(0.1, Math.min(0.9, baseWeight + shift));
}

// ── Composite Score ───────────────────────────────────────────────────

export function computeCompositeScore(
  visualScore: number | null,
  codeScore: number | null,
  assertionPassRate: number | null,
  codeEvalWeight: number,
  annotatedCriteria?: AnnotatedCriterion[],
  adaptiveWeightRange?: number,
): CompositeEvaluation {
  // Adaptive weight adjustment
  const effectiveWeight = (annotatedCriteria && annotatedCriteria.length > 0 && adaptiveWeightRange)
    ? computeAdaptiveWeight(codeEvalWeight, adaptiveWeightRange, annotatedCriteria)
    : codeEvalWeight;
  const hasVisual = visualScore !== null;
  const hasCode = codeScore !== null;

  // Hard gate: any matched assertion failure → cap at 2
  const assertionsFailed = assertionPassRate !== null && assertionPassRate < 1;
  const hasMatchedAssertionFailure = assertionsFailed &&
    // Only treat as hard fail when assertions were actually checked (passRate < 1 means at least one failed)
    assertionPassRate < 1;

  if (hasMatchedAssertionFailure) {
    const baseScore = hasVisual && hasCode
      ? round1(visualScore! * (1 - effectiveWeight) + codeScore! * effectiveWeight)
      : hasVisual ? visualScore!
      : hasCode ? codeScore!
      : 1;
    return {
      compositeScore: Math.min(2, baseScore),
      visualScore,
      codeScore,
      assertionPassRate,
      mergedIssues: [],
      source: "assertion_fail",
    };
  }

  if (!hasVisual && !hasCode) {
    return {
      compositeScore: 1,
      visualScore: null,
      codeScore: null,
      assertionPassRate,
      mergedIssues: [],
      source: "visual_only",
    };
  }

  let composite: number;
  let source: CompositeEvaluation["source"];

  if (hasVisual && hasCode) {
    const visualWeight = 1 - effectiveWeight;
    const blended = visualScore! * visualWeight + codeScore! * effectiveWeight;
    composite = Math.max(1, Math.min(10, round1(blended)));

    // If visual and code strongly disagree, take the lower score
    if (Math.abs(visualScore! - codeScore!) >= 4) {
      const lower = Math.min(visualScore!, codeScore!);
      composite = Math.min(composite, round1(lower + 1));
    }

    source = "composite";
  } else if (hasVisual) {
    composite = visualScore!;
    source = "visual_only";
  } else {
    composite = codeScore!;
    source = "code_only";
  }

  return {
    compositeScore: composite,
    visualScore,
    codeScore,
    assertionPassRate,
    mergedIssues: [],
    source,
    effectiveCodeEvalWeight: effectiveWeight,
  };
}
