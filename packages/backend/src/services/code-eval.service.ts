/**
 * Code Evaluation Service
 *
 * LLM-based code review of generated Build123d code.
 * Assertion checking and composite scoring are in separate files.
 *
 * Re-exports from split modules for backward compatibility.
 */

import { codeOnlyCriteria } from "../utils/verification-criteria.js";
import { buildCodeReviewSystemPrompt } from "../prompts/code-review-system-prompt.js";
import { trackedStreamText } from "./tracked-llm.service.js";
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

/** Valid viewing angles the code review can recommend for VLM evaluation. */
const VALID_ANGLES = new Set([
  "front", "back", "left", "right", "top", "bottom", "ortho_45", "ortho_45_bottom",
]);

export interface CodeReviewResult {
  score: number;
  issues: string[];
  /** 2-5 viewing angles most relevant for visually verifying this model. */
  criticalAngles: string[];
  codeReviewModel: string;
  promptTokens: number;
  completionTokens: number;
  assertionSummary: AssertionCheckSummary | null;
  /** The reviewer's pass/fail per code-routed criterion, aligned to the criteria asked (ADR 0001, #105). */
  itemResults: CodeItemResult[];
  rawResponse?: string;
  reasoning?: string;
  systemPrompt?: string;
}

// The system prompt lives in prompts/code-review-system-prompt.ts (#138).

// ── Response Parsing ──────────────────────────────────────────────────

interface ParsedCodeReview {
  score: number;
  issues: string[];
  criticalAngles: string[];
  /** The reviewer's answers to the code-only criteria, as returned (unaligned). */
  items: Array<{ question: string; pass: boolean | null; detail: string }>;
}

/** The reviewer's answer to one code-routed criterion (ADR 0001, #105): the code-side twin of a visual ChecklistResult. */
export interface CodeItemResult {
  question: string;
  /** true = pass, false = fail, null = the reviewer did not answer it — which fails the gate. */
  pass: boolean | null;
  detail: string;
}

function parseItems(raw: unknown): ParsedCodeReview["items"] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((it) => {
    if (typeof it !== "object" || it === null) return [];
    const o = it as { question?: unknown; pass?: unknown; detail?: unknown };
    return [{
      question: typeof o.question === "string" ? o.question : "",
      pass: o.pass === true ? true : o.pass === false ? false : null,
      detail: typeof o.detail === "string" ? o.detail : "",
    }];
  });
}

/**
 * Align the reviewer's answers to the criteria it was asked: by position,
 * with the question text as the check; a criterion the reviewer skipped or
 * mislabelled gets `pass: null` — unanswered, which the gate counts as a
 * fail — never a guess. Pure.
 */
export function alignCodeItems(criteria: ReadonlyArray<{ text: string }>, answers: ReadonlyArray<{ question: string; pass: boolean | null; detail: string }>): CodeItemResult[] {
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
  return criteria.map((c, i) => {
    const byPos = answers[i];
    const match = byPos && (byPos.question === "" || norm(byPos.question) === norm(c.text)) ? byPos
      : answers.find((a) => norm(a.question) === norm(c.text));
    if (!match) return { question: c.text, pass: null, detail: "not answered by the code reviewer" };
    return { question: c.text, pass: match.pass, detail: match.detail };
  });
}

function clampScore(score: number): number {
  if (typeof score !== "number" || isNaN(score)) return 1;
  return Math.max(1, Math.min(10, Math.round(score)));
}

/** Parse criticalAngles from raw JSON value, filtering to valid angles. */
function parseCriticalAngles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is string => typeof a === "string" && VALID_ANGLES.has(a));
}

function parseCodeReviewResponse(content: string): ParsedCodeReview {
  if (!content || typeof content !== "string") {
    return { score: 1, issues: ["Empty response"], criticalAngles: [], items: [] };
  }

  let jsonStr = content;
  const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    return {
      score: clampScore((parsed.score as number) ?? 1),
      issues: Array.isArray(parsed.issues)
        ? (parsed.issues as unknown[]).filter((i): i is string => typeof i === "string")
        : [],
      criticalAngles: parseCriticalAngles(parsed.criticalAngles),
      items: parseItems(parsed.items),
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

  return { score, issues, criticalAngles: [], items: [] };
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
  /** Precise geometric blueprint — replaces specInterpretation for more detailed verification. */
  constructionSpec?: string;
  /** Annotated criteria with visibility — code reviewer emphasizes code-only items. */
  annotatedCriteria?: import("./spec-generation.service.js").AnnotatedCriterion[];
  /** The spec's Orientation declaration (#138): request-stated sides are checked against it. */
  orientation?: import("./orientation-declaration.js").OrientationDeclaration | null;
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

  const systemPrompt = buildCodeReviewSystemPrompt({
    userPrompt, specInterpretation, codegenSystemPrompt,
    constructionSpec: input.constructionSpec, annotatedCriteria: input.annotatedCriteria, orientation: input.orientation,
  });
  const userContent = `Review this Build123d code:\n\n\`\`\`python\n${code}\n\`\`\``;

  const semaphore = getLlmSemaphore(config.provider, config.maxConcurrent);
  return semaphore.run(async () => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= CODE_EVAL_MAX_RETRIES; attempt++) {
      try {
        const providerModel = createProviderModelFromConfig(config);

        logger.info({ attempt: attempt + 1, maxAttempts: CODE_EVAL_MAX_RETRIES + 1, model: label }, "calling code review LLM");
        const stream = trackedStreamText({
          model: providerModel,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
          // The answer now carries one entry per code-routed criterion (#105);
          // at 1024 the reviewer hit the cap on 42 of 120 rows and the cut
          // JSON parsed as no items — every one of them unanswered.
          maxOutputTokens: 4096,
          temperature: 0,
        }, {
          purpose: "code_evaluation",
          providerName: config.provider,
          modelId: config.id,
          modelName: config.modelName,
          modelConfig: { costPer1mInput: config.costPer1mInput, costPer1mOutput: config.costPer1mOutput },
        });

        let text = "";
        let reasoning = "";
        for await (const part of stream.fullStream) {
          if (part.type === "text-delta") text += part.text;
          else if (part.type === "reasoning-delta") {
            reasoning += (part as { text?: string }).text ?? "";
          }
        }
        const resolved = await stream;

        if (!text) {
          throw new Error("Empty response from code review LLM");
        }

        logger.info({ response: text }, "raw code review response");

        const parsed = parseCodeReviewResponse(text);

        const allIssues = [
          ...(assertionSummary?.issues ?? []),
          ...parsed.issues.map((i) => `[CODE] ${i}`),
        ];

        logger.info(
          { score: parsed.score, codeIssueCount: parsed.issues.length, assertionIssueCount: assertionSummary?.issues.length ?? 0, criticalAngles: parsed.criticalAngles },
          "code evaluation completed",
        );

        const usage = await resolved.usage;
        const itemResults = alignCodeItems(codeOnlyCriteria(input.annotatedCriteria), parsed.items);
        const reviewResult: CodeReviewResult = {
          score: parsed.score,
          issues: allIssues,
          criticalAngles: parsed.criticalAngles,
          itemResults,
          codeReviewModel: label,
          promptTokens: usage?.inputTokens ?? 0,
          completionTokens: usage?.outputTokens ?? 0,
          assertionSummary,
        };

        reviewResult.rawResponse = text;
        reviewResult.reasoning = reasoning || undefined;
        reviewResult.systemPrompt = systemPrompt;

        return reviewResult;
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
      criticalAngles: [],
      itemResults: alignCodeItems(codeOnlyCriteria(input.annotatedCriteria), []),
      codeReviewModel: label,
      promptTokens: 0,
      completionTokens: 0,
      assertionSummary,
    };
  });
}
