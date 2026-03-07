/**
 * Build123d render error classification, fix guidance, and infrastructure retry.
 *
 * Classifies raw Python tracebacks from Build123d into actionable categories
 * with domain-specific correction instructions for the codegen LLM.
 */

import { createLogger } from "./logger.js";

const logger = createLogger("render-errors");

// ── Types ─────────────────────────────────────────────────────────────────────

export enum RenderErrorCategory {
  /** Service unreachable, timeout, DNS failure — not a code problem */
  INFRASTRUCTURE = "infrastructure",
  /** Python NameError, AttributeError — wrong API name or missing import */
  API_MISUSE = "api_misuse",
  /** ValueError, geometry errors — valid API but wrong parameters or empty geometry */
  GEOMETRY = "geometry",
  /** TypeError — correct API, wrong argument types or count */
  TYPE_ERROR = "type_error",
  /** BRep_API / OCC kernel errors — degenerate geometry, topology failures */
  KERNEL_ERROR = "kernel_error",
  /** Pre-render validation failures — syntax errors, missing root_part */
  SYNTAX = "syntax",
  /** Unrecognized errors — raw message passed through */
  UNKNOWN = "unknown",
}

export interface ClassifiedRenderError {
  /** The original raw error message from Build123d */
  rawMessage: string;
  /** Classified category */
  category: RenderErrorCategory;
  /** Whether this is an infrastructure error (code is fine, don't regenerate) */
  isInfrastructure: boolean;
  /** Domain-specific fix guidance for the LLM, or null for infrastructure */
  fixGuidance: string | null;
  /** Captured detail from regex (e.g., the undefined name), if any */
  capturedDetail: string | null;
}

export interface RenderErrorContext {
  /** The classified error */
  classified: ClassifiedRenderError;
  /** Pre-built escalation guidance if same error category repeated, or null */
  escalationGuidance: string | null;
}

// ── Classification Rules ──────────────────────────────────────────────────────

interface ClassificationRule {
  pattern: RegExp;
  category: RenderErrorCategory;
  /** Static guidance string, or function receiving the regex match for dynamic guidance */
  guidance: string | null | ((match: RegExpMatchArray) => string);
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  // ── Infrastructure (not a code problem) ───────────────────────────────────
  {
    pattern: /service unreachable|fetch failed|ECONNREFUSED|(?<![A-Za-z])ENOTFOUND|socket hang up/i,
    category: RenderErrorCategory.INFRASTRUCTURE,
    guidance: null,
  },
  {
    pattern: /service timeout|timed out|AbortError/i,
    category: RenderErrorCategory.INFRASTRUCTURE,
    guidance: null,
  },

  // ── API Misuse (wrong function/attribute names) ───────────────────────────
  {
    pattern: /NameError: name '([^']+)' is not defined/,
    category: RenderErrorCategory.API_MISUSE,
    guidance: (match) =>
      `The Build123d API does not have a class or function named '${match[1]}'. ` +
      "Check the Build123d API reference in the system prompt for the correct name. " +
      "Common mistakes include using CadQuery or OpenSCAD function names instead of Build123d equivalents.",
  },
  {
    pattern: /AttributeError:.*has no attribute '([^']+)'/,
    category: RenderErrorCategory.API_MISUSE,
    guidance: (match) =>
      `The object does not have an attribute named '${match[1]}'. ` +
      "Review the Build123d API reference for available attributes and methods on this type.",
  },
  {
    pattern: /ImportError|ModuleNotFoundError/,
    category: RenderErrorCategory.API_MISUSE,
    guidance:
      "Only the following modules are available: build123d (pre-imported), math (pre-imported), " +
      "itertools, functools, copy, and numpy. Do not import any other modules.",
  },

  // ── Geometry (valid API, wrong parameters or empty geometry) ───────────────
  {
    pattern: /No objects to create/i,
    category: RenderErrorCategory.GEOMETRY,
    guidance:
      "The sketch or part has no geometry to operate on. Ensure shapes are added inside " +
      "`with BuildSketch() as s:` before calling make_face, hull, or extrude. " +
      "A common mistake is creating an empty sketch context with no 2D primitives (Circle, Rectangle, etc.).",
  },
  {
    pattern: /ValueError:.*(?:empty|zero[- ]?(?:length|area|volume)|degenerate)/i,
    category: RenderErrorCategory.GEOMETRY,
    guidance:
      "The geometry is degenerate (zero area, zero length, or empty). " +
      "Ensure all dimensions are strictly positive, points are not coincident, " +
      "and sketch profiles form valid closed loops.",
  },
  {
    pattern: /ValueError:/,
    category: RenderErrorCategory.GEOMETRY,
    guidance:
      "A ValueError occurred in the Build123d geometry pipeline. Check that all parameters are valid: " +
      "positive dimensions, non-coincident points, valid closed sketch profiles, and correct axis/plane references.",
  },

  // ── Kernel Errors (OCC topology failures) ─────────────────────────────────
  {
    pattern: /BRep_API.*not done|StdFail_NotDone/i,
    category: RenderErrorCategory.KERNEL_ERROR,
    guidance:
      "The CAD kernel reported a topology failure (BRep_API: command not done). " +
      "This usually means degenerate geometry: zero-length edges from duplicate/coincident points, " +
      "self-intersecting profiles, or invalid wire topology. " +
      "Simplify the geometry — use distinct, well-separated points and avoid sharp degenerate features. " +
      "If creating a profile with Line/Polyline, ensure no two consecutive points are identical.",
  },
  {
    pattern: /ShapeAnalysis|TopoDS.*[Nn]ull|Standard_NullObject/i,
    category: RenderErrorCategory.KERNEL_ERROR,
    guidance:
      "The CAD kernel encountered an invalid or null shape. The boolean operation or " +
      "geometry construction produced corrupt topology. " +
      "Rebuild the shape from scratch using simpler primitives and boolean operations.",
  },

  // ── Type Errors ───────────────────────────────────────────────────────────
  {
    pattern: /TypeError:.*(?:argument|expected|positional|got\s)/i,
    category: RenderErrorCategory.TYPE_ERROR,
    guidance:
      "Wrong argument type or count passed to a Build123d function. " +
      "Check the Build123d API reference for the correct function signature. " +
      "Pay attention to whether a parameter expects a number, tuple, Axis, Plane, or Location.",
  },
  {
    pattern: /TypeError:/,
    category: RenderErrorCategory.TYPE_ERROR,
    guidance:
      "A TypeError occurred. Verify that argument types match the Build123d API reference signatures. " +
      "Common issues: passing a number where a tuple is expected, or vice versa.",
  },
];

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * Classify a Build123d render error into an actionable category with fix guidance.
 *
 * Accepts either an Error instance (including RenderingServiceError with its
 * isInfrastructure flag) or a raw string.
 */
export function classifyRenderError(error: unknown): ClassifiedRenderError {
  const rawMessage = error instanceof Error ? error.message : String(error);

  // Fast-path: RenderingServiceError with isInfrastructure flag
  if (
    error instanceof Error &&
    "isInfrastructure" in error &&
    (error as { isInfrastructure: boolean }).isInfrastructure
  ) {
    return {
      rawMessage,
      category: RenderErrorCategory.INFRASTRUCTURE,
      isInfrastructure: true,
      fixGuidance: null,
      capturedDetail: null,
    };
  }

  // Walk classification rules in priority order
  for (const rule of CLASSIFICATION_RULES) {
    const match = rawMessage.match(rule.pattern);
    if (match) {
      const guidance =
        typeof rule.guidance === "function" ? rule.guidance(match) : rule.guidance;
      const capturedDetail = match[1] ?? null;
      return {
        rawMessage,
        category: rule.category,
        isInfrastructure: rule.category === RenderErrorCategory.INFRASTRUCTURE,
        fixGuidance: guidance,
        capturedDetail,
      };
    }
  }

  // Fallback: unknown category, pass raw message as guidance
  return {
    rawMessage,
    category: RenderErrorCategory.UNKNOWN,
    isInfrastructure: false,
    fixGuidance: null,
    capturedDetail: null,
  };
}

// ── Escalation ────────────────────────────────────────────────────────────────

/**
 * Count how many of the most recent errors in history share the same category.
 * Counts from the end of the array backwards until a different category is found.
 */
export function consecutiveSameCategoryCount(
  history: ClassifiedRenderError[],
  currentCategory: RenderErrorCategory,
): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].category === currentCategory) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Build escalated fix guidance based on how many times the same error category
 * has appeared consecutively. Returns null for infrastructure errors (no LLM guidance needed).
 *
 * @param current - The classified error from the current iteration
 * @param history - All classified errors from previous iterations (current NOT yet included)
 * @returns Combined guidance string with escalation prefix, or null for infrastructure
 */
export function buildEscalatedGuidance(
  current: ClassifiedRenderError,
  history: ClassifiedRenderError[],
): string | null {
  if (current.isInfrastructure) return null;

  const consecutive = consecutiveSameCategoryCount(history, current.category);
  const baseGuidance = current.fixGuidance ?? current.rawMessage;

  if (consecutive >= 2) {
    logger.warn(
      { category: current.category, consecutive: consecutive + 1 },
      "same error category persisted across multiple attempts — escalating guidance",
    );
    return (
      `CRITICAL: This type of error (${current.category}) has persisted across ${consecutive + 1} consecutive attempts. ` +
      "The previous approaches have not resolved the issue. You MUST completely restructure the code. " +
      "Simplify the geometry significantly — use basic primitives (Box, Cylinder, Sphere) and simple " +
      "boolean operations (mode=Mode.SUBTRACT, mode=Mode.ADD). Avoid complex sketches, lofts, sweeps, " +
      "or intricate profiles.\n\n" +
      baseGuidance
    );
  }

  if (consecutive === 1) {
    logger.info(
      { category: current.category },
      "same error category repeated — adding emphasis to guidance",
    );
    return (
      `IMPORTANT: The same type of error (${current.category}) occurred again. ` +
      "The previous fix attempt did not resolve the root cause. " +
      "Try a fundamentally different approach to the geometry rather than tweaking the same code.\n\n" +
      baseGuidance
    );
  }

  // First occurrence — just return the standard guidance
  return baseGuidance;
}

// ── Infrastructure Retry ──────────────────────────────────────────────────────

/** Max retries for infrastructure (non-code) errors before giving up */
export const MAX_INFRA_RETRIES = 2;

/** Delay between infrastructure retries in milliseconds */
export const INFRA_RETRY_DELAY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RenderWithInfraRetryOptions {
  maxRetries?: number;
  delayMs?: number;
  onRetry?: (attempt: number, classified: ClassifiedRenderError) => void;
}

export type RenderResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: ClassifiedRenderError };

/**
 * Wraps a render function call with automatic retry for infrastructure errors.
 *
 * - Infrastructure errors (service down, timeout): retry up to maxRetries with delay
 * - Code errors (geometry, API misuse, etc.): return immediately as classified error
 *
 * The renderFn should call renderBuild123d() which internally acquires the semaphore.
 * Between infrastructure retries the semaphore is released, allowing other callers
 * to proceed during the delay.
 */
export async function renderWithInfraRetry<T>(
  renderFn: () => Promise<T>,
  opts?: RenderWithInfraRetryOptions,
): Promise<RenderResult<T>> {
  const maxRetries = opts?.maxRetries ?? MAX_INFRA_RETRIES;
  const delayMs = opts?.delayMs ?? INFRA_RETRY_DELAY_MS;

  let infraAttempt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const result = await renderFn();
      return { ok: true, result };
    } catch (error) {
      const classified = classifyRenderError(error);

      if (!classified.isInfrastructure) {
        // Code error — return immediately for LLM fix loop
        return { ok: false, error: classified };
      }

      // Infrastructure error — retry if attempts remain
      infraAttempt++;
      if (infraAttempt > maxRetries) {
        logger.error(
          { attempts: infraAttempt, category: classified.category, rawMessage: classified.rawMessage },
          "infrastructure retries exhausted — giving up",
        );
        return { ok: false, error: classified };
      }

      logger.info(
        { attempt: infraAttempt, maxRetries, delayMs, rawMessage: classified.rawMessage },
        "infrastructure error — retrying with same code after delay",
      );
      opts?.onRetry?.(infraAttempt, classified);
      await sleep(delayMs);
    }
  }
}
