/**
 * LLM Retry with Exponential Backoff
 *
 * Wraps LLM calls with retry logic for transient rate limit errors (HTTP 429).
 * Distinguishes retryable rate limits from non-retryable quota exhaustion.
 *
 * Retry happens inside the semaphore slot — the slot is held during backoff
 * waits. This is intentional: if the provider is rate-limiting us, releasing
 * the slot and immediately sending another request from a different caller
 * would just trigger another 429.
 */

import { config } from "../config.js";
import { createLogger } from "./logger.js";
import {
  isQuotaExhaustion,
  isRateLimitError,
  asQuotaError,
  asRateLimitError,
} from "./llm-errors.js";

const logger = createLogger("llm-retry");

export interface LlmRetryOptions {
  /** Provider name for logging and error wrapping. */
  provider?: string;
  /** Maximum number of retry attempts (default: from config). */
  maxRetries?: number;
  /** Base delay in ms before first retry — doubles on each subsequent retry (default: from config). */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default: from config). */
  maxDelayMs?: number;
}

/**
 * Wrap an LLM call with retry logic for transient rate limit errors.
 *
 * - On 429 rate limit (retryable): waits with exponential backoff, then retries.
 *   Respects `Retry-After` header if present.
 * - On 429 quota exhaustion (non-retryable): throws immediately as ProviderQuotaExhaustedError.
 * - On other errors: throws immediately (no retry).
 */
export async function withLlmRetry<T>(
  fn: () => Promise<T>,
  options?: LlmRetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? config.concurrency.llmRetryMaxAttempts;
  const baseDelayMs = options?.baseDelayMs ?? config.concurrency.llmRetryBaseDelayMs;
  const maxDelayMs = options?.maxDelayMs ?? config.concurrency.llmRetryMaxDelayMs;
  const provider = options?.provider;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Non-retryable quota/credit exhaustion — abort immediately
      if (isQuotaExhaustion(error)) {
        throw asQuotaError(error, provider) ?? error;
      }

      // Retryable rate limit — retry if attempts remain
      if (isRateLimitError(error) && attempt < maxRetries) {
        const rateLimit = asRateLimitError(error, provider);
        const calculatedDelay = baseDelayMs * Math.pow(2, attempt);
        const delay = Math.min(
          rateLimit?.retryAfterMs ?? calculatedDelay,
          maxDelayMs,
        );

        logger.warn(
          {
            provider,
            attempt: attempt + 1,
            maxRetries,
            delayMs: delay,
            err: error instanceof Error ? error.message : String(error),
          },
          `rate limited, retrying in ${delay}ms`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Rate limit with retries exhausted
      if (isRateLimitError(error)) {
        logger.error(
          {
            provider,
            attempts: attempt + 1,
            err: error instanceof Error ? error.message : String(error),
          },
          "rate limit retries exhausted",
        );
      }

      // Not retryable or retries exhausted — propagate as-is
      throw error;
    }
  }

  // Should not reach here, but satisfy TypeScript
  throw new Error("withLlmRetry: unexpected end of retry loop");
}
