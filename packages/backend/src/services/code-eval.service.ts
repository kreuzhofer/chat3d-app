/**
 * Code Evaluation Service
 *
 * LLM-based code review of generated Build123d code.
 * Assertion checking and composite scoring are in separate files.
 *
 * Re-exports from split modules for backward compatibility.
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
import type { CodeAssertion } from "./spec-generation.service.js";
import { checkAssertions, type AssertionCheckSummary } from "./code-eval-assertions.service.js";

const logger = createLogger("code-eval");
const CODE_EVAL_MAX_RETRIES = 2;

// ── Re-exports ────────────────────────────────────────────────────────

export type { AssertionCheckResult, AssertionCheckSummary } from "./code-eval-assertions.service.js";
export { fuzzyMatch, checkAssertions } from "./code-eval-assertions.service.js";
export type { CompositeEvaluation } from "./code-eval-composite.service.js";
export { computeCompositeScore } from "./code-eval-composite.service.js";

// ── Code Review Types ─────────────────────────────────────────────────

export interface CodeReviewResult {
  score: number;
  issues: string[];
  codeReviewModel: string;
  promptTokens: number;
  completionTokens: number;
  assertionSummary: AssertionCheckSummary | null;
}

// ── Code Review System Prompt ─────────────────────────────────────────

function buildCodeReviewSystemPrompt(
  userPrompt: string,
  specInterpretation?: string,
  codegenSystemPrompt?: string,
): string {
  let prompt = `You are a Build123d code reviewer for 3D CAD models.

The code runs in an environment with Build123d AND bd_warehouse installed. bd_warehouse provides parametric
ISO-standard mechanical components: CounterSunkScrew, HexHeadScrew, SocketHeadCapScrew, PanHeadScrew,
ButtonHeadScrew, SetScrew, HexNut, HexNutWithFlange, IsoThread, AcmeThread, MetricTrapezoidalThread,
SpurGear, SingleRowDeepGrooveBallBearing, Sprocket, Pipe, ChamferedWasher, CheeseHeadWasher, etc.
These are ALL VALID, available classes — do NOT flag them as undefined or unavailable.
All bd_warehouse fastener classes accept these parameters: size, length, fastener_type, simple, hand.
Do NOT claim any of these parameters are invalid or unsupported — they are part of the bd_warehouse API.
When bd_warehouse classes are used with correct size parameters (e.g., size="M6-1"), they produce accurate
ISO-standard geometry with correct dimensions. If the code rendered successfully, trust that the API call is valid.

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

  if (codegenSystemPrompt) {
    prompt += `\n\n--- Build123d API Reference (same knowledge the code generator had) ---\n${codegenSystemPrompt}`;
  }

  return prompt;
}

// ── Response Parsing ──────────────────────────────────────────────────

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

  let jsonStr = content;
  const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim();
  }

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

// ── Model Resolution ──────────────────────────────────────────────────

async function resolveCodeReviewModel(): Promise<{ model: ReturnType<typeof createProviderModelFromConfig>; label: string; config: LlmModelConfig }> {
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

// ── Main Code Review Function ─────────────────────────────────────────

export interface CodeEvalInput {
  userPrompt: string;
  code: string;
  specInterpretation?: string;
  codeAssertions?: CodeAssertion[];
  codegenSystemPrompt?: string;
}

export async function evaluateCode(input: CodeEvalInput): Promise<CodeReviewResult> {
  const { userPrompt, code, specInterpretation, codeAssertions, codegenSystemPrompt } = input;

  logger.info(
    { codeLength: code.length, assertionCount: codeAssertions?.length ?? 0 },
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
  const { label, config } = await resolveCodeReviewModel();
  logger.info({ model: label }, "using code review model");

  const systemPrompt = buildCodeReviewSystemPrompt(userPrompt, specInterpretation, codegenSystemPrompt);
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

        logger.info({ response: responseText }, "raw code review response");

        const parsed = parseCodeReviewResponse(responseText);

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
