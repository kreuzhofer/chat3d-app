/**
 * Code Evaluation — Composite Score Computation
 *
 * Combines visual (VLM) score, code review score, and assertion pass rate
 * into a single composite score. Assertion failures act as a hard gate.
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface CompositeEvaluation {
  compositeScore: number;
  visualScore: number | null;
  codeScore: number | null;
  assertionPassRate: number | null;
  mergedIssues: string[];
  source: "composite" | "visual_only" | "code_only" | "assertion_fail";
}

/** Round to 1 decimal place. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Composite Score ───────────────────────────────────────────────────

export function computeCompositeScore(
  visualScore: number | null,
  codeScore: number | null,
  assertionPassRate: number | null,
  codeEvalWeight: number,
): CompositeEvaluation {
  const hasVisual = visualScore !== null;
  const hasCode = codeScore !== null;

  // Hard gate: any matched assertion failure → cap at 2
  const assertionsFailed = assertionPassRate !== null && assertionPassRate < 1;
  const hasMatchedAssertionFailure = assertionsFailed &&
    // Only treat as hard fail when assertions were actually checked (passRate < 1 means at least one failed)
    assertionPassRate < 1;

  if (hasMatchedAssertionFailure) {
    const baseScore = hasVisual && hasCode
      ? round1(visualScore! * (1 - codeEvalWeight) + codeScore! * codeEvalWeight)
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
    const visualWeight = 1 - codeEvalWeight;
    const blended = visualScore! * visualWeight + codeScore! * codeEvalWeight;
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
  };
}
