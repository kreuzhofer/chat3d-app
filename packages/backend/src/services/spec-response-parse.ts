/**
 * Reading the spec generator's reply (split out of spec-generation.service.ts
 * for #136). The criteria contract is ADR 0002's — atoms or nothing — and,
 * since #136, the reply must also state the expected body count: a reply
 * without a valid count is refused like a reply of bare strings, so the
 * caller retries it once and then surfaces it. Since #138 the same holds for
 * the Orientation declaration (ADR 0007): no declaration, no criteria.
 */
import { parseRequirementAtoms, parseExpectedBodyCount, type AtomsFailureReason } from "./requirement-atoms.js";
import { type EvalPlan, parseEvalPlan } from "../utils/eval-plan.js";
import type { AnnotatedCriterion, CodeAssertion } from "./spec-generation.service.js";
import { parseOrientationDeclaration, type OrientationDeclaration } from "./orientation-declaration.js";

export interface ParsedSpec {
  interpretation: string;
  verificationChecklist: string[];
  codeAssertions: CodeAssertion[];
  disambiguationNeeded: boolean;
  disambiguationQuestions: string[];
  semanticContext: string;
  constructionSpec: string;
  verificationCriteria: AnnotatedCriterion[];
  /** Separate solid bodies the model should have (#136); null when the reply was refused or not read. */
  expectedBodyCount: number | null;
  /** What is up and which feature faces −Y (#138); null when the reply was refused or not read. */
  orientation: OrientationDeclaration | null;
  requiresDecomposition: boolean;
  decompositionReasoning: string;
  evalPlan: EvalPlan | null;
  parseLevel: "json" | "regex" | "none";
  /** The contract's verdict on this reply's criteria; absent when they were atoms. */
  criteriaRefused?: { reason: AtomsFailureReason; offending: unknown };
}

export const EMPTY_SPEC: ParsedSpec = {
  interpretation: "",
  verificationChecklist: [],
  codeAssertions: [],
  disambiguationNeeded: false,
  disambiguationQuestions: [],
  semanticContext: "",
  constructionSpec: "",
  verificationCriteria: [],
  expectedBodyCount: null,
  orientation: null,
  requiresDecomposition: false,
  decompositionReasoning: "",
  evalPlan: null,
  parseLevel: "none",
};

function parseCodeAssertions(raw: unknown): CodeAssertion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .filter((a) => typeof a.parameter === "string" && typeof a.value === "number")
    .map((a) => ({
      parameter: a.parameter as string,
      aliases: Array.isArray(a.aliases) ? (a.aliases as unknown[]).filter((s): s is string => typeof s === "string") : [],
      operator: (["==", ">=", "<=", "approx"].includes(a.operator as string) ? a.operator : "==") as CodeAssertion["operator"],
      value: a.value as number,
      description: typeof a.description === "string" ? a.description : `${a.parameter} should be ${a.value}`,
    }));
}

function buildSpecFromParsed(raw: Partial<ParsedSpec>): ParsedSpec {
  // The contract (ADR 0002): atoms or nothing. A bare-string list, a missing
  // visibility or a bundled atom leaves the criteria empty with the reason
  // beside them; the caller retries once and then surfaces it. The plain
  // checklist is never lifted into criteria — that silent "both" is #33.
  // The body count belongs to the same contract (#136): without it the reply
  // is refused whole, atoms included, so no count is ever defaulted; and so
  // is a missing or malformed Orientation declaration (#138).
  const rawRecord = raw as Record<string, unknown>;
  const contract = parseRequirementAtoms(rawRecord.verificationCriteria);
  const bodyCount = parseExpectedBodyCount(rawRecord.expectedBodyCount);
  const declaration = parseOrientationDeclaration(rawRecord.orientation);
  const criteriaRefused = !contract.ok
    ? { reason: contract.reason, offending: contract.offending }
    : bodyCount === null ? { reason: "missing-body-count" as const, offending: rawRecord.expectedBodyCount }
    : declaration === null ? { reason: "missing-orientation" as const, offending: rawRecord.orientation } : undefined;
  const verificationCriteria = contract.ok && !criteriaRefused ? contract.atoms : [];
  const expectedBodyCount = criteriaRefused ? null : bodyCount;
  const orientation = criteriaRefused ? null : declaration;
  const verificationChecklist = Array.isArray(raw.verificationChecklist)
    ? raw.verificationChecklist.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];

  // Derive the legacy checklist from criteria text if no explicit checklist
  const effectiveChecklist = verificationChecklist.length > 0 ? verificationChecklist : verificationCriteria.map(c => c.text);

  const requiresDecomposition = typeof rawRecord.requiresDecomposition === "boolean"
    ? rawRecord.requiresDecomposition
    : false;
  const decompositionReasoning = typeof rawRecord.decompositionReasoning === "string"
    ? rawRecord.decompositionReasoning.trim()
    : "";
  const evalPlan = parseEvalPlan(rawRecord.evalPlan);

  return {
    interpretation: typeof raw.interpretation === "string" ? raw.interpretation : "",
    verificationChecklist: effectiveChecklist,
    codeAssertions: parseCodeAssertions(rawRecord.codeAssertions),
    disambiguationNeeded: raw.disambiguationNeeded === true,
    disambiguationQuestions: Array.isArray(raw.disambiguationQuestions)
      ? raw.disambiguationQuestions.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      : [],
    semanticContext: typeof raw.semanticContext === "string" ? raw.semanticContext : "",
    constructionSpec: typeof raw.constructionSpec === "string" ? raw.constructionSpec : "",
    verificationCriteria,
    expectedBodyCount,
    orientation,
    requiresDecomposition,
    decompositionReasoning,
    evalPlan,
    parseLevel: "json",
    ...(criteriaRefused ? { criteriaRefused } : {}),
  };
}

export function parseSpecResponse(content: string): ParsedSpec {
  if (!content || typeof content !== "string") {
    return EMPTY_SPEC; // fail-open
  }

  // Level 1: Extract JSON from code fence
  let jsonStr = content;
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Level 2: Direct JSON.parse
  try {
    const parsed = JSON.parse(jsonStr) as Partial<ParsedSpec>;
    return buildSpecFromParsed(parsed);
  } catch {
    // fall through
  }

  // Level 3: Regex extraction
  const interpretationMatch = content.match(/["']?interpretation["']?\s*[:=]\s*"([^"]+)"/i);
  const disambiguationMatch = content.match(/["']?disambiguationNeeded["']?\s*[:=]\s*(true|false)/i);

  if (interpretationMatch || disambiguationMatch) {
    return {
      interpretation: interpretationMatch?.[1] ?? "",
      verificationChecklist: [],
      codeAssertions: [],
      disambiguationNeeded: disambiguationMatch?.[1]?.toLowerCase() === "true",
      disambiguationQuestions: [],
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
      expectedBodyCount: null,
      orientation: null,
      requiresDecomposition: false,
      decompositionReasoning: "",
      evalPlan: null,
      parseLevel: "regex",
    };
  }

  return EMPTY_SPEC; // fail-open
}
