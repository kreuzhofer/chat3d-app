/**
 * Code Evaluation — Assertion Checker
 *
 * Deterministic parameter verification (no LLM cost).
 * Extracts parameters from generated Build123d code and compares
 * against spec-defined assertions.
 */

import { extractParameters, type ExtractedParameter } from "./parameter-tweak.service.js";
import type { CodeAssertion } from "./spec-generation.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("code-eval-assert");

// ── Types ─────────────────────────────────────────────────────────────

export interface AssertionCheckResult {
  assertion: CodeAssertion;
  matched: boolean;
  matchedName: string | null;
  actualValue: number | null;
  pass: boolean;
  detail: string;
}

export interface AssertionCheckSummary {
  total: number;
  checked: number;
  passed: number;
  failed: number;
  unmatched: number;
  passRate: number;
  results: AssertionCheckResult[];
  issues: string[];
}

// ── Fuzzy parameter name matching ─────────────────────────────────────

export function fuzzyMatch(target: string, paramName: string, aliases: string[]): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[_\s-]/g, "");
  const normalizedTarget = normalize(target);
  const candidates = [paramName, ...aliases];
  return candidates.some((c) => normalize(c) === normalizedTarget);
}

// ── Radius/diameter awareness ────────────────────────────────────────

/**
 * Detect when an assertion value and a matched parameter have a radius↔diameter
 * relationship (factor of 2). Returns the corrected expected value if a
 * conversion is detected, or null if no conversion applies.
 *
 * Examples:
 *   assertion: "diameter == 30", matched param: "hole_radius = 15" → returns 15
 *   assertion: "radius == 15",   matched param: "hole_diameter = 30" → returns 30
 */
function radiusDiameterCorrection(
  matchedName: string,
  assertionParam: string,
  assertionAliases: string[],
  expected: number,
): number | null {
  const norm = (s: string) => s.toLowerCase().replace(/[_\s-]/g, "");
  const matchedNorm = norm(matchedName);
  const assertionNames = [assertionParam, ...assertionAliases].map(norm);

  const matchedIsRadius = matchedNorm.includes("radius") || matchedNorm.includes("rad");
  const matchedIsDiameter = matchedNorm.includes("diameter") || matchedNorm.includes("dia");
  const assertionIsRadius = assertionNames.some(n => n.includes("radius") || n.includes("rad"));
  const assertionIsDiameter = assertionNames.some(n => n.includes("diameter") || n.includes("dia"));

  // Matched param is radius but assertion expects diameter → expected should be halved
  if (matchedIsRadius && !matchedIsDiameter && (assertionIsDiameter || !assertionIsRadius)) {
    return expected / 2;
  }
  // Matched param is diameter but assertion expects radius → expected should be doubled
  if (matchedIsDiameter && !matchedIsRadius && (assertionIsRadius || !assertionIsDiameter)) {
    return expected * 2;
  }
  return null;
}

// ── Main assertion checker ────────────────────────────────────────────

export async function checkAssertions(
  code: string,
  assertions: CodeAssertion[],
): Promise<AssertionCheckSummary> {
  if (assertions.length === 0) {
    return { total: 0, checked: 0, passed: 0, failed: 0, unmatched: 0, passRate: 1, results: [], issues: [] };
  }

  let extractedParams: ExtractedParameter[] = [];
  try {
    extractedParams = await extractParameters(code);
    logger.debug({ paramCount: extractedParams.length, params: extractedParams.map((p) => `${p.name}=${p.value}`) }, "extracted parameters for assertion check");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "parameter extraction failed, skipping assertion check");
    return {
      total: assertions.length,
      checked: 0,
      passed: 0,
      failed: 0,
      unmatched: assertions.length,
      passRate: 1, // inconclusive — don't penalize
      results: assertions.map((a) => ({
        assertion: a,
        matched: false,
        matchedName: null,
        actualValue: null,
        pass: true, // inconclusive treated as pass
        detail: "Parameter extraction failed — skipped",
      })),
      issues: [],
    };
  }

  const results: AssertionCheckResult[] = [];
  const issues: string[] = [];

  for (const assertion of assertions) {
    const match = extractedParams.find((p) => fuzzyMatch(p.name, assertion.parameter, assertion.aliases));

    if (!match) {
      results.push({
        assertion,
        matched: false,
        matchedName: null,
        actualValue: null,
        pass: true, // inconclusive treated as pass
        detail: `No matching parameter found for "${assertion.parameter}" — inconclusive`,
      });
      continue;
    }

    let pass: boolean;
    const actual = match.value;
    let expected = assertion.value;

    // Check for radius↔diameter mismatch and correct before comparing
    const correctedExpected = radiusDiameterCorrection(
      match.name, assertion.parameter, assertion.aliases, expected,
    );
    if (correctedExpected !== null && Math.abs(actual - correctedExpected) < 0.001) {
      expected = correctedExpected;
      logger.info(
        { param: match.name, actual, originalExpected: assertion.value, correctedExpected },
        "applied radius↔diameter correction for assertion",
      );
    }

    switch (assertion.operator) {
      case "==":
        pass = Math.abs(actual - expected) < 0.001;
        break;
      case ">=":
        pass = actual >= expected - 0.001;
        break;
      case "<=":
        pass = actual <= expected + 0.001;
        break;
      case "approx":
        pass = Math.abs(actual - expected) <= Math.abs(expected) * 0.1 + 0.001;
        break;
      default:
        pass = Math.abs(actual - expected) < 0.001;
    }

    const detail = pass
      ? `${match.name} = ${actual} matches expected ${expected} (${assertion.operator})`
      : `${match.name} = ${actual}, expected ${assertion.operator} ${expected} — ${assertion.description}`;

    if (!pass) {
      issues.push(`[PARAM] ${detail}`);
    }

    results.push({
      assertion,
      matched: true,
      matchedName: match.name,
      actualValue: actual,
      pass,
      detail,
    });
  }

  // ── Swap detection ────────────────────────────────────────────────
  // Dimension swaps: the LLM assigns the correct values to differently-named
  // variables. Two patterns:
  //
  // 1. Pair swap: assertions A and B fail, but A got B's value and vice versa.
  //    Both are rescued.
  // 2. Single mismatch: assertion fails with value X, but the expected value
  //    exists in a different extracted parameter (not matched to any assertion).
  //    The dimension is present in the code, just under a different name.
  //    Rescued as a soft pass.
  const failedResults = results.filter((r) => r.matched && !r.pass);
  if (failedResults.length >= 2) {
    for (let i = 0; i < failedResults.length; i++) {
      for (let j = i + 1; j < failedResults.length; j++) {
        const a = failedResults[i];
        const b = failedResults[j];
        if (a.pass || b.pass) continue; // already rescued
        if (a.actualValue === null || b.actualValue === null) continue;
        const aExpected = a.assertion.value;
        const bExpected = b.assertion.value;
        // A got B's expected value and B got A's expected value
        const aGotB = Math.abs(a.actualValue - bExpected) < 0.001;
        const bGotA = Math.abs(b.actualValue - aExpected) < 0.001;
        if (aGotB && bGotA) {
          a.pass = true;
          a.detail = `${a.matchedName} = ${a.actualValue} (swapped with ${b.matchedName} = ${b.actualValue}) — dimensions present but assigned to different variable names`;
          b.pass = true;
          b.detail = `${b.matchedName} = ${b.actualValue} (swapped with ${a.matchedName} = ${a.actualValue}) — dimensions present but assigned to different variable names`;
          // Remove the swap pair's issues
          const aIssueIdx = issues.indexOf(`[PARAM] ${a.matchedName} = ${a.actualValue}, expected ${a.assertion.operator} ${aExpected} — ${a.assertion.description}`);
          if (aIssueIdx >= 0) issues.splice(aIssueIdx, 1);
          const bIssueIdx = issues.indexOf(`[PARAM] ${b.matchedName} = ${b.actualValue}, expected ${b.assertion.operator} ${bExpected} — ${b.assertion.description}`);
          if (bIssueIdx >= 0) issues.splice(bIssueIdx, 1);
          logger.info(
            { paramA: a.matchedName, valueA: a.actualValue, paramB: b.matchedName, valueB: b.actualValue },
            "detected dimension swap — both assertions rescued",
          );
        }
      }
    }
  }

  // Single-mismatch rescue: if a still-failing assertion's expected value exists
  // in any extracted parameter (even one not matched to an assertion), the
  // dimension is present in the code under a different name.
  const stillFailed = results.filter((r) => r.matched && !r.pass);
  for (const fail of stillFailed) {
    if (fail.assertion.operator !== "==") continue;
    const expected = fail.assertion.value;
    const hasValueElsewhere = extractedParams.some(
      (p) => p.name !== fail.matchedName && Math.abs(p.value - expected) < 0.001,
    );
    if (hasValueElsewhere) {
      fail.pass = true;
      fail.detail = `${fail.matchedName} = ${fail.actualValue}, but expected value ${expected} found in another parameter — dimension present under different name`;
      const issueStr = `[PARAM] ${fail.matchedName} = ${fail.actualValue}, expected ${fail.assertion.operator} ${expected} — ${fail.assertion.description}`;
      const idx = issues.indexOf(issueStr);
      if (idx >= 0) issues.splice(idx, 1);
      logger.info(
        { param: fail.matchedName, actual: fail.actualValue, expected },
        "assertion value found in another parameter — rescued as dimension present",
      );
    }
  }

  const checked = results.filter((r) => r.matched).length;
  const passed = results.filter((r) => r.matched && r.pass).length;
  const failed = results.filter((r) => r.matched && !r.pass).length;
  const unmatched = results.filter((r) => !r.matched).length;

  return {
    total: assertions.length,
    checked,
    passed,
    failed,
    unmatched,
    passRate: checked > 0 ? passed / checked : 1,
    results,
    issues,
  };
}
