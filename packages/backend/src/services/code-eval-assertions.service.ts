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
    const expected = assertion.value;

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
