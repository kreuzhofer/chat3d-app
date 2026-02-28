/**
 * LLM Error Detection Utilities
 *
 * Detects provider credit/quota exhaustion (non-retryable) and transient
 * rate limit errors (retryable) from AI SDK errors.
 *
 * Error taxonomy for HTTP 429:
 * - Quota exhaustion: 429 with "quota", "credit", "billing" keywords → non-retryable
 * - Rate limit: 429 without quota keywords → retryable with backoff
 * - HTTP 402 (Payment Required) → always non-retryable quota exhaustion
 */

import { APICallError } from "ai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract HTTP status code from various error types. */
function getStatusCode(error: unknown): number | undefined {
  if (APICallError.isInstance(error)) return error.statusCode;
  if (error && typeof error === "object") {
    const anyErr = error as Record<string, unknown>;
    const code = anyErr.statusCode ?? anyErr.status;
    if (typeof code === "number") return code;
  }
  return undefined;
}

/** Keywords that indicate quota/credit exhaustion (non-retryable). */
const QUOTA_KEYWORDS = /quota|credit|billing|insufficient|payment|balance/i;

// ---------------------------------------------------------------------------
// Custom error classes
// ---------------------------------------------------------------------------

/**
 * Non-retryable error indicating the LLM provider has rejected the request
 * due to quota exhaustion, insufficient credits, or billing issues.
 */
export class ProviderQuotaExhaustedError extends Error {
  public readonly statusCode: number;
  public readonly provider: string | null;

  constructor(
    message: string,
    opts: { statusCode: number; provider?: string; cause?: Error },
  ) {
    super(message, { cause: opts.cause });
    this.name = "ProviderQuotaExhaustedError";
    this.statusCode = opts.statusCode;
    this.provider = opts.provider ?? null;
  }
}

/**
 * Retryable error indicating the LLM provider has temporarily rate-limited
 * the request. Callers should wait and retry with exponential backoff.
 */
export class ProviderRateLimitError extends Error {
  public readonly statusCode: number;
  public readonly provider: string | null;
  public readonly retryAfterMs: number | null;

  constructor(
    message: string,
    opts: { statusCode: number; provider?: string; retryAfterMs?: number; cause?: Error },
  ) {
    super(message, { cause: opts.cause });
    this.name = "ProviderRateLimitError";
    this.statusCode = opts.statusCode;
    this.provider = opts.provider ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

// ---------------------------------------------------------------------------
// Quota exhaustion detection (non-retryable) — broad check
// ---------------------------------------------------------------------------

/** HTTP status codes that can signal quota / credit exhaustion. */
const QUOTA_STATUS_CODES = new Set([429, 402]);

/**
 * Returns `true` when `error` looks like a provider quota / credit error.
 * This is the BROAD check — catches all 429 and 402 regardless of keywords.
 * Used by legacy call sites that treat all 429s as quota errors.
 *
 * For new code, prefer `isQuotaExhaustion()` (strict) or `isRateLimitError()`.
 */
export function isProviderQuotaError(error: unknown): boolean {
  if (APICallError.isInstance(error) && error.statusCode !== undefined) {
    return QUOTA_STATUS_CODES.has(error.statusCode);
  }

  if (error && typeof error === "object") {
    const anyErr = error as Record<string, unknown>;
    const code = anyErr.statusCode ?? anyErr.status;
    if (typeof code === "number" && QUOTA_STATUS_CODES.has(code)) {
      return true;
    }
  }

  return false;
}

/**
 * Returns `true` when `error` is specifically a quota/credit exhaustion error
 * (non-retryable), as opposed to a transient rate limit.
 *
 * Heuristic:
 * - HTTP 402 → always quota exhaustion
 * - HTTP 429 + quota keywords in message → quota exhaustion
 */
export function isQuotaExhaustion(error: unknown): boolean {
  const statusCode = getStatusCode(error);

  // 402 Payment Required is always quota/billing
  if (statusCode === 402) return true;

  // 429 with quota-related keywords in the error message
  if (statusCode === 429) {
    const msg = error instanceof Error ? error.message : String(error);
    return QUOTA_KEYWORDS.test(msg);
  }

  return false;
}

/**
 * If `error` is a quota error, wrap it in `ProviderQuotaExhaustedError`.
 * Otherwise return `null` (caller should handle the error normally).
 */
export function asQuotaError(
  error: unknown,
  provider?: string,
): ProviderQuotaExhaustedError | null {
  if (!isProviderQuotaError(error)) return null;

  const statusCode = (APICallError.isInstance(error) ? error.statusCode : undefined) ?? 429;
  const originalMessage =
    error instanceof Error ? error.message : String(error);

  return new ProviderQuotaExhaustedError(
    `LLM provider quota exhausted (HTTP ${statusCode}): ${originalMessage}`,
    {
      statusCode,
      provider,
      cause: error instanceof Error ? error : undefined,
    },
  );
}

// ---------------------------------------------------------------------------
// Rate limit detection (retryable)
// ---------------------------------------------------------------------------

/**
 * Returns `true` when `error` is a transient rate limit (429 without quota keywords).
 * These errors are retryable with exponential backoff.
 */
export function isRateLimitError(error: unknown): boolean {
  const statusCode = getStatusCode(error);

  // Only HTTP 429 can be a rate limit; 402 is always quota
  if (statusCode !== 429) return false;

  // If the message contains quota keywords, it's quota exhaustion, not a rate limit
  return !isQuotaExhaustion(error);
}

/**
 * If `error` is a retryable rate limit, wrap it in `ProviderRateLimitError`.
 * Otherwise return `null`.
 */
export function asRateLimitError(
  error: unknown,
  provider?: string,
): ProviderRateLimitError | null {
  if (!isRateLimitError(error)) return null;

  const statusCode = getStatusCode(error) ?? 429;
  const originalMessage =
    error instanceof Error ? error.message : String(error);

  // Try to extract Retry-After header from APICallError
  let retryAfterMs: number | null = null;
  if (APICallError.isInstance(error)) {
    const retryAfter = error.responseHeaders?.["retry-after"];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds) && seconds > 0) {
        retryAfterMs = seconds * 1000;
      }
    }
  }

  return new ProviderRateLimitError(
    `LLM provider rate limited (HTTP ${statusCode}): ${originalMessage}`,
    {
      statusCode,
      provider,
      retryAfterMs: retryAfterMs ?? undefined,
      cause: error instanceof Error ? error : undefined,
    },
  );
}

// ---------------------------------------------------------------------------
// Transient error detection (retryable — timeouts, 5xx, network errors)
// ---------------------------------------------------------------------------

/** Keywords in error messages that indicate a timeout. */
const TIMEOUT_KEYWORDS = /timeout|timed out|aborted|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i;

/** HTTP status codes that indicate transient server-side issues. */
const TRANSIENT_STATUS_CODES = new Set([500, 502, 503, 504, 529]);

/**
 * Returns `true` when `error` is a transient infrastructure error that is
 * safe to retry: timeouts, network errors, or server-side 5xx errors.
 *
 * Excludes rate limits (429) and quota errors (402) — those have their own
 * detection via `isRateLimitError()` and `isQuotaExhaustion()`.
 */
export function isTransientError(error: unknown): boolean {
  // Check for transient HTTP status codes (5xx, 529)
  const statusCode = getStatusCode(error);
  if (statusCode !== undefined && TRANSIENT_STATUS_CODES.has(statusCode)) {
    return true;
  }

  // Check for timeout / network error keywords in message or name
  const msg = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (TIMEOUT_KEYWORDS.test(msg) || TIMEOUT_KEYWORDS.test(name)) {
    return true;
  }

  // AbortError from AbortController.abort()
  if (name === "AbortError") return true;

  return false;
}
