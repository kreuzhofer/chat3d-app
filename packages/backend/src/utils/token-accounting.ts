/**
 * Pure helpers for reconciling provider-reported token usage.
 *
 * These live in utils rather than beside `calculateCostUsd` because
 * llm.service, llm-config.service and tracked-llm.service all need them, and
 * `llm.service -> tracked-llm.service` is already an import edge — pointing one
 * back the other way would close a cycle.
 */

/**
 * Rough token count for a span of model text, at the ~4 chars/token ratio used
 * throughout usage accounting and the streaming progress logs. Every estimate
 * goes through here so the ratio has exactly one definition.
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

export interface ResolvedReasoningTokens {
  tokens: number;
  /** True when `tokens` came from the char estimate rather than the provider. */
  estimated: boolean;
}

/**
 * Settle on a reasoning-token count, preferring what the provider reported.
 *
 * Bedrock + Anthropic streaming usage payloads sometimes report zero even when
 * the model produced thinking output, and OpenAI-compatible servers (vLLM) omit
 * the breakdown entirely. When reasoning text was captured — streamed deltas or
 * a resolved `reasoningText` — fall back to the char estimate so the stored
 * usage record reflects the work actually done.
 *
 * The `estimated` flag comes back with the count so callers can mark the usage
 * record and log the substitution: an estimate that looks identical to a
 * provider figure is exactly the silent degradation the repo's fail-fast
 * principle forbids.
 */
export function resolveReasoningTokens(
  reportedTokens: number,
  reasoningChars: number,
): ResolvedReasoningTokens {
  if (reportedTokens > 0) return { tokens: reportedTokens, estimated: false };
  if (reasoningChars > 0) return { tokens: estimateTokensFromChars(reasoningChars), estimated: true };
  return { tokens: 0, estimated: false };
}

/**
 * The share of reasoning tokens a provider did NOT already count inside its
 * completion total.
 *
 * Every provider in use folds thinking into the completion count and reports
 * reasoning only as a breakdown of it — verified in the installed SDK:
 * openai-compatible maps `completion_tokens_details.reasoning_tokens` and
 * anthropic maps `output_tokens_details.thinking_tokens`, both into
 * `outputTokenDetails.reasoningTokens`, with `text = output - reasoning`.
 * Treating the reasoning figure as additional tokens therefore counts the
 * thinking portion twice, in both billing and totals.
 *
 * Only the excess is genuinely uncounted. That still covers a provider which
 * reports no completion tokens at all, where an estimated reasoning figure is
 * the only signal of work done.
 */
export function uncountedReasoningTokens(reasoningTokens: number, completionTokens: number): number {
  return Math.max(0, reasoningTokens - completionTokens);
}

export interface TokenTotalParts {
  /** The provider's own total, or 0 when it reported none. */
  reportedTotal: number;
  inputTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

/**
 * Total tokens for a usage record: the provider's own figure when it reported
 * one, otherwise input + completion — plus whatever reasoning it did not
 * already count inside that completion total.
 *
 * Keeping this beside uncountedReasoningTokens() means the billed cost and the
 * recorded total can never disagree about what reasoning is worth.
 */
export function totalTokensWithUncountedReasoning(parts: TokenTotalParts): number {
  const { reportedTotal, inputTokens, completionTokens, reasoningTokens } = parts;
  const base = reportedTotal || inputTokens + completionTokens;
  return base + uncountedReasoningTokens(reasoningTokens, completionTokens);
}
