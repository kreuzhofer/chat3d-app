/**
 * Code Evaluation Service
 *
 * Provides a code-level evaluation track alongside the existing visual (VLM) evaluation.
 * Two sub-components:
 *   1. Assertion Checker — deterministic parameter verification (no LLM cost)
 *   2. Code Review LLM — structural/semantic review of generated Build123d code
 *
 * Results are combined with VLM visual evaluation into a composite score
 * to reduce false approvals (wrong dimensions that look OK) and false
 * rejections (correct code that the VLM misjudges visually).
 */

import { trackedGenerateText } from "./tracked-llm.service.js";
import { isQuotaExhaustion, asQuotaError, isRateLimitError } from "../utils/llm-errors.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import { createLogger } from "../utils/logger.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { extractParameters, type ExtractedParameter } from "./parameter-tweak.service.js";
import type { CodeAssertion } from "./spec-generation.service.js";

const logger = createLogger("code-eval");
const CODE_EVAL_MAX_RETRIES = 2;

// ── Assertion Checker Types ──────────────────────────────────────────

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

// ── Code Review Types ────────────────────────────────────────────────

export interface CodeReviewResult {
  score: number;
  issues: string[];
  codeReviewModel: string;
  promptTokens: number;
  completionTokens: number;
  assertionSummary: AssertionCheckSummary | null;
}

// ── Composite Evaluation Types ───────────────────────────────────────

export interface CompositeEvaluation {
  compositeScore: number;
  visualScore: number | null;
  codeScore: number | null;
  assertionPassRate: number | null;
  mergedIssues: string[];
  source: "composite" | "visual_only" | "code_only";
}

// ── Assertion Checker (deterministic, no LLM) ────────────────────────

function fuzzyMatch(target: string, paramName: string, aliases: string[]): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[_\s-]/g, "");
  const normalizedTarget = normalize(target);
  const candidates = [paramName, ...aliases];
  return candidates.some((c) => normalize(c) === normalizedTarget);
}

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
      // Unmatched — code might use inline literals or expressions; inconclusive
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
    passRate: checked > 0 ? passed / checked : 1, // no checked params → no penalty
    results,
    issues,
  };
}

// ── Code Review System Prompt ────────────────────────────────────────

function buildCodeReviewSystemPrompt(userPrompt: string, specInterpretation?: string): string {
  return `You are a Build123d code reviewer for 3D CAD models.

The code runs in an environment with Build123d AND bd_warehouse installed. bd_warehouse provides parametric
ISO-standard mechanical components: CounterSunkScrew, HexHeadScrew, SocketHeadCapScrew, IsoThread, HexNut,
SpurGear, SingleRowDeepGrooveBallBearing, Sprocket, Pipe, etc. These are VALID, available classes — do NOT
flag them as undefined or unavailable. When bd_warehouse classes are used with correct size parameters
(e.g., size="M6-1"), they produce accurate ISO-standard geometry with correct dimensions.

Given a user's 3D model request and the generated Build123d Python code, verify:

1. **Parameter accuracy**: Do numeric values (dimensions, counts, angles, radii) match the prompt?
   Check variable assignments like "diameter = 15" against what the prompt specifies.
   When bd_warehouse classes are used, the standard size parameter (e.g., "M6-1") encapsulates
   the correct ISO dimensions — do not require explicit dimension variables for standardized values.
2. **Feature completeness**: Are ALL requested features present in the code?
   (holes, fillets, chamfers, slots, patterns, etc.)
3. **Constraint satisfaction**: Are spatial relationships correct?
   ("centered", "equally spaced", "offset by 5mm", "flush with", etc.)
4. **Logical correctness**: Does the code logic produce the described geometry?
   (correct boolean operations, proper sketch-to-3D workflow, etc.)

Do NOT evaluate: code style, naming conventions, comments, rendering quality, or visual appearance.
Do NOT flag issues for aspects the prompt does not specify — if the prompt doesn't mention a dimension,
any reasonable value is correct.

The user requested: "${userPrompt}"
${specInterpretation ? `\nInterpreted as: ${specInterpretation}\n` : ""}
Score 1-10:
- 1-3: Wrong dimensions or missing major features
- 4-6: Some parameters wrong or features incomplete
- 7-8: All parameters correct, minor structural concerns
- 9-10: Fully matches the prompt specification

Return JSON only:
{
  "score": <integer 1-10>,
  "issues": ["<code-level problem>", ...]
}

Issues must be specific and actionable. Example issues:
- "diameter = 10 but prompt specifies 15mm"
- "Only 2 holes created but prompt asks for 4"
- "Fillet radius is 5mm but prompt says 2mm"
- "Missing thread pattern requested in prompt"`;
}

// ── Response Parsing ─────────────────────────────────────────────────

interface ParsedCodeReview {
  score: number;
  issues: string[];
}

function clampScore(score: number): number {
  if (typeof score !== "number" || isNaN(score)) return 1;
  return Math.max(1, Math.min(10, Math.round(score)));
}

function parseCodeReviewResponse(content: string): ParsedCodeReview {
  if (!content || typeof content !== "string") {
    return { score: 1, issues: ["Empty response"] };
  }

  // Level 1: Extract JSON from code fence
  let jsonStr = content;
  const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim();
  }

  // Level 2: Direct JSON.parse
  try {
    const parsed = JSON.parse(jsonStr) as Partial<ParsedCodeReview>;
    return {
      score: clampScore(parsed.score ?? 1),
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.filter((i): i is string => typeof i === "string")
        : [],
    };
  } catch {
    // fall through
  }

  // Level 3: Regex extraction
  const scoreMatch = content.match(/["']?score["']?\s*[:=]\s*(\d+)/i);
  const score = scoreMatch ? clampScore(parseInt(scoreMatch[1], 10)) : 1;

  const issues: string[] = [];
  const issuesSection = content.match(/issues[:\s]*\n?([\s\S]*?)$/i);
  if (issuesSection) {
    const issueMatches = issuesSection[1].match(/[-•*]\s*(.+)/g);
    if (issueMatches) {
      issues.push(...issueMatches.map((m) => m.replace(/^[-•*]\s*/, "").trim()));
    }
  }

  return { score, issues };
}

// ── Model Resolution ─────────────────────────────────────────────────

async function resolveCodeReviewModel(): Promise<{ model: ReturnType<typeof createProviderModelFromConfig>; label: string; config: LlmModelConfig }> {
  // Try code_review → spec_generation → conversation (fallback chain)
  for (const purpose of ["code_review", "spec_generation", "conversation"] as const) {
    try {
      const config = await getModelForPurpose(purpose);
      if (purpose !== "code_review") {
        logger.info({ purpose }, "code_review purpose not configured, falling back");
      }
      return {
        model: createProviderModelFromConfig(config),
        label: config.label,
        config,
      };
    } catch {
      continue;
    }
  }
  throw new Error("No LLM model configured for code review (tried code_review, spec_generation, conversation)");
}

// ── Main Code Review Function ────────────────────────────────────────

export interface CodeEvalInput {
  userPrompt: string;
  code: string;
  specInterpretation?: string;
  codeAssertions?: CodeAssertion[];
}

export async function evaluateCode(input: CodeEvalInput): Promise<CodeReviewResult> {
  const { userPrompt, code, specInterpretation, codeAssertions } = input;

  logger.info(
    { prompt: userPrompt.slice(0, 80), codeLength: code.length, assertionCount: codeAssertions?.length ?? 0 },
    "starting code evaluation",
  );

  // Run assertion check (deterministic, no LLM cost)
  let assertionSummary: AssertionCheckSummary | null = null;
  if (codeAssertions && codeAssertions.length > 0) {
    assertionSummary = await checkAssertions(code, codeAssertions);
    logger.info(
      { total: assertionSummary.total, checked: assertionSummary.checked, passed: assertionSummary.passed, failed: assertionSummary.failed, passRate: assertionSummary.passRate },
      "assertion check completed",
    );
  }

  // Run LLM code review
  const { model, label, config } = await resolveCodeReviewModel();
  logger.info({ model: label }, "using code review model");

  const systemPrompt = buildCodeReviewSystemPrompt(userPrompt, specInterpretation);
  const userContent = `Review this Build123d code:\n\n\`\`\`python\n${code}\n\`\`\``;

  const semaphore = getLlmSemaphore(config.provider, config.maxConcurrent);
  return semaphore.run(async () => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= CODE_EVAL_MAX_RETRIES; attempt++) {
      try {
        const providerModel = createProviderModelFromConfig(config);

        logger.info({ attempt: attempt + 1, maxAttempts: CODE_EVAL_MAX_RETRIES + 1, model: label }, "calling code review LLM");
        const result = await trackedGenerateText({
          model: providerModel,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
          maxOutputTokens: 512,
        }, {
          purpose: "code_evaluation",
          providerName: config.provider,
          modelId: config.id,
          modelName: config.modelName,
          modelConfig: { costPer1mInput: config.costPer1mInput, costPer1mOutput: config.costPer1mOutput },
        });

        const responseText = result.text;
        if (!responseText) {
          throw new Error("Empty response from code review LLM");
        }

        logger.debug({ response: responseText.slice(0, 300) }, "raw code review response");

        const parsed = parseCodeReviewResponse(responseText);

        // Merge assertion issues into the code review issues
        const allIssues = [
          ...(assertionSummary?.issues ?? []),
          ...parsed.issues.map((i) => `[CODE] ${i}`),
        ];

        logger.info(
          { score: parsed.score, codeIssueCount: parsed.issues.length, assertionIssueCount: assertionSummary?.issues.length ?? 0 },
          "code evaluation completed",
        );

        return {
          score: parsed.score,
          issues: allIssues,
          codeReviewModel: label,
          promptTokens: result.usage?.inputTokens ?? 0,
          completionTokens: result.usage?.outputTokens ?? 0,
          assertionSummary,
        };
      } catch (error) {
        if (isQuotaExhaustion(error)) {
          throw asQuotaError(error, config.provider) ?? error;
        }

        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < CODE_EVAL_MAX_RETRIES) {
          const isRateLimit = isRateLimitError(error);
          const delay = isRateLimit
            ? Math.min(2000 * Math.pow(2, attempt), 60000)
            : 1000 * (attempt + 1);
          logger.warn(
            { attempt: attempt + 1, err: lastError, isRateLimit, delayMs: delay },
            "code review attempt failed, retrying",
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    logger.error({ err: lastError, attempts: CODE_EVAL_MAX_RETRIES + 1 }, "code review failed after all attempts");
    // Fail-open: return assertion results even if LLM review failed
    return {
      score: 1,
      issues: [
        ...(assertionSummary?.issues ?? []),
        `[CODE] Code review failed: ${lastError?.message ?? "Unknown error"}`,
      ],
      codeReviewModel: label,
      promptTokens: 0,
      completionTokens: 0,
      assertionSummary,
    };
  });
}

// ── Composite Score Computation ──────────────────────────────────────

export function computeCompositeScore(
  visualScore: number | null,
  codeScore: number | null,
  assertionPassRate: number | null,
  codeEvalWeight: number,
): CompositeEvaluation {
  const hasVisual = visualScore !== null;
  const hasCode = codeScore !== null;

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
    // Blend visual and code scores
    let blended = visualScore! * visualWeight + codeScore! * codeEvalWeight;

    // Apply assertion penalty if we have assertion results
    if (assertionPassRate !== null && assertionPassRate < 1) {
      // Scale down the blended score based on assertion failures
      // A 50% pass rate applies a ~25% penalty (sqrt to soften the curve)
      const assertionFactor = 0.5 + 0.5 * Math.sqrt(assertionPassRate);
      blended = blended * assertionFactor;
    }

    composite = Math.max(1, Math.min(10, Math.round(blended)));

    // If visual and code strongly disagree, take the lower score
    // (err on the side of catching real issues)
    if (Math.abs(visualScore! - codeScore!) >= 4) {
      const lower = Math.min(visualScore!, codeScore!);
      composite = Math.min(composite, lower + 1); // allow +1 for the other track's contribution
    }

    source = "composite";
  } else if (hasVisual) {
    composite = visualScore!;
    // Apply assertion penalty even in visual-only mode
    if (assertionPassRate !== null && assertionPassRate < 1) {
      const assertionFactor = 0.5 + 0.5 * Math.sqrt(assertionPassRate);
      composite = Math.max(1, Math.round(composite * assertionFactor));
    }
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
    mergedIssues: [], // caller merges issues from both tracks
    source,
  };
}
