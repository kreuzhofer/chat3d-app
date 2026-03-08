import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { build123dSemaphore } from "../utils/resource-limits.js";

const logger = createLogger("render");

/** HTTP timeout for the Build123d rendering service.
 *  Code execution + STEP/3MF export can be slow for complex models. */
const BUILD123D_TIMEOUT_MS = 120_000;

/** HTTP timeout for the lightweight /validate endpoint (AST parse only). */
const BUILD123D_VALIDATE_TIMEOUT_MS = 10_000;

/** Number of retry attempts for transient failures (timeouts, unreachable).
 *  5 attempts allows enough time for container restarts to complete. */
const MAX_RETRIES = 5;

/** Base delay between retries (ms). Doubles on each subsequent retry.
 *  5 attempts: 2s, 4s, 8s, 16s, then fail = ~30s total wait. */
const RETRY_BASE_DELAY_MS = 2_000;

export interface RenderedFile {
  filename: string;
  contentBase64: string;
}

export interface Build123dRenderResult {
  files: RenderedFile[];
  renderer: "mock" | "build123d";
}

export class RenderingServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 502,
    /** True when the error is an infrastructure issue (timeout, unreachable)
     *  rather than a problem with the submitted code. */
    public readonly isInfrastructure = false,
  ) {
    super(message);
  }
}

function mockRenderedFiles(baseFileName: string): RenderedFile[] {
  const payload = Buffer.from(`mock-build123d-content:${baseFileName}`, "utf8").toString("base64");
  return [
    {
      filename: `${baseFileName}.step`,
      contentBase64: payload,
    },
  ];
}

// ── Pre-render validation ──────────────────────────────────────────────────

export interface LintWarning {
  rule: string;
  message: string;
  line: number;
  severity: "error" | "warning";
}

export interface Build123dValidationResult {
  valid: boolean;
  errors: string[];
  warnings: LintWarning[];
}

/**
 * Lightweight AST-level validation via the Build123d `/validate/` endpoint.
 * Catches syntax errors and missing `root_part` before the expensive render.
 * Returns `{ valid: true }` in mock mode.
 */
export async function validateBuild123dCode(code: string): Promise<Build123dValidationResult> {
  if (config.query.renderMode === "mock") {
    return { valid: true, errors: [], warnings: [] };
  }

  const url = `${config.query.build123dUrl.replace(/\/$/, "")}/validate/`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BUILD123D_VALIDATE_TIMEOUT_MS);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const body = (await response.json()) as { valid?: boolean; errors?: string[]; warnings?: LintWarning[] };
    return {
      valid: body.valid === true,
      errors: Array.isArray(body.errors) ? body.errors : [],
      warnings: Array.isArray(body.warnings) ? body.warnings : [],
    };
  } catch (err) {
    // If the validate endpoint is unreachable, skip validation rather than blocking
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "validate endpoint unreachable — skipping pre-render validation",
    );
    return { valid: true, errors: [], warnings: [] };
  }
}

export async function renderBuild123d(
  input: {
    code: string;
    baseFileName: string;
  },
  opts?: { onQueuePositionChange?: (position: number, total: number) => void },
): Promise<Build123dRenderResult> {
  if (config.query.renderMode === "mock") {
    logger.info({ baseFileName: input.baseFileName }, "mock mode, returning mock files");
    return {
      files: mockRenderedFiles(input.baseFileName),
      renderer: "mock",
    };
  }

  return build123dSemaphore.run(
    () => _renderBuild123dInner(input),
    { onQueuePositionChange: opts?.onQueuePositionChange },
  );
}

async function _renderBuild123dInner(input: {
  code: string;
  baseFileName: string;
}): Promise<Build123dRenderResult> {
  const url = `${config.query.build123dUrl.replace(/\/$/, "")}/render/`;
  const payload = {
    code: input.code,
    filename: `${input.baseFileName}.step`,
  };

  logger.info({ url, codeLength: input.code.length, filename: payload.filename }, "POST to Build123d");

  let response: Response | undefined;
  let lastError: RenderingServiceError | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), BUILD123D_TIMEOUT_MS);
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      // Got a response — break out of retry loop
      lastError = undefined;
      break;
    } catch (fetchError) {
      const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      const isTimeout = fetchError instanceof Error && fetchError.name === "AbortError";
      lastError = new RenderingServiceError(
        isTimeout
          ? `Build123d service timeout after ${BUILD123D_TIMEOUT_MS / 1000}s`
          : `Build123d service unreachable: ${msg}`,
        502,
        true, // infrastructure error — code is fine, service is down
      );

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          { url, err: msg, isTimeout, attempt, maxRetries: MAX_RETRIES, retryDelayMs: delay },
          `Build123d service failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        logger.error(
          { url, err: msg, isTimeout, attempt, maxRetries: MAX_RETRIES },
          `Build123d service failed after ${MAX_RETRIES} attempts`,
        );
      }
    }
  }

  if (lastError || !response) {
    throw lastError ?? new RenderingServiceError("Build123d service failed after retries", 502, true);
  }

  logger.info({ status: response.status, statusText: response.statusText }, "Build123d response received");

  const body = await response.json().catch(() => ({}));
  const files = Array.isArray((body as { files?: unknown[] }).files)
    ? ((body as { files: Array<{ filename?: unknown; content?: unknown }> }).files ?? [])
    : [];

  logger.info({ bodyKeys: Object.keys(body as object), fileCount: files.length }, "Build123d response body parsed");

  if (!response.ok || files.length === 0) {
    const message =
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : "Rendering request failed";
    logger.error({ message, status: response.status }, "render error");
    throw new RenderingServiceError(message, response.status >= 400 ? response.status : 502);
  }

  const mappedFiles: RenderedFile[] = [];
  for (const file of files) {
    if (typeof file.filename !== "string" || typeof file.content !== "string") {
      logger.warn({ file: JSON.stringify(file).slice(0, 200) }, "skipping invalid file entry");
      continue;
    }
    logger.info({ filename: file.filename, contentLength: file.content.length }, "received file");
    mappedFiles.push({
      filename: file.filename,
      contentBase64: file.content,
    });
  }

  if (mappedFiles.length === 0) {
    throw new RenderingServiceError("Rendering service returned no valid files", 502);
  }

  logger.info({ fileCount: mappedFiles.length, baseFileName: input.baseFileName }, "render success");
  return {
    files: mappedFiles,
    renderer: "build123d",
  };
}
