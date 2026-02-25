/**
 * LLM Error Detection Utilities
 *
 * Detects provider credit exhaustion and rate limit errors (HTTP 429, 402)
 * from AI SDK errors.  These errors are non-retryable and should abort the
 * current pipeline immediately to avoid wasting time and resources.
 */

import { APICallError } from "ai";

// ---------------------------------------------------------------------------
// Custom error class
// ---------------------------------------------------------------------------

/**
 * Non-retryable error indicating the LLM provider has rejected the request
 * due to quota exhaustion, insufficient credits, or rate limiting.
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

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/** HTTP status codes that signal quota / credit exhaustion. */
const QUOTA_STATUS_CODES = new Set([429, 402]);

/**
 * Returns `true` when `error` looks like a provider quota / credit error.
 *
 * Checks for:
 * - AI SDK `APICallError` with HTTP 429 (Too Many Requests / Quota Exceeded)
 * - AI SDK `APICallError` with HTTP 402 (Payment Required)
 * - Generic error objects with a `statusCode` or `status` property of 429/402
 */
export function isProviderQuotaError(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    return QUOTA_STATUS_CODES.has(error.statusCode);
  }

  // Fallback: some wrapper errors carry the status on a different property.
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
 * If `error` is a quota error, wrap it in `ProviderQuotaExhaustedError`.
 * Otherwise return `null` (caller should handle the error normally).
 */
export function asQuotaError(
  error: unknown,
  provider?: string,
): ProviderQuotaExhaustedError | null {
  if (!isProviderQuotaError(error)) return null;

  const statusCode = APICallError.isInstance(error) ? error.statusCode : 429;
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
