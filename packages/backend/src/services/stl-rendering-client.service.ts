import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { screenshotSemaphore } from "../utils/resource-limits.js";

const logger = createLogger("stl-render");

export type ViewingAngle = "front" | "back" | "left" | "right" | "top" | "bottom" | "ortho_45" | "ortho_45_bottom" | "isometric" | "isometric_back";
export type ModelFormat = "stl" | "3mf";

/** Backend-side timeout for the HTTP call to the STL rendering service.
 *  Must be longer than the service's internal render timeout (30s)
 *  to allow for cold-start page creation + rendering. */
const FETCH_TIMEOUT_MS = 90_000;

/** Number of retry attempts for transient failures (timeouts, network errors).
 *  5 attempts allows enough time for container restarts to complete. */
const MAX_RETRIES = 5;

/** Base delay between retries (ms). Doubles on each subsequent retry.
 *  5 attempts: 2s, 4s, 8s, 16s, then fail = ~30s total wait. */
const RETRY_BASE_DELAY_MS = 2_000;

export interface RenderedScreenshot {
  angle: ViewingAngle;
  base64: string; // PNG base64 (no data URL prefix)
}

export interface StlRenderResult {
  images: RenderedScreenshot[];
}

export class StlRenderingError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 502,
  ) {
    super(message);
  }
}

// 1×1 transparent PNG for mock mode
const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Resolve the screenshot service URL. */
function resolveScreenshotUrl(): string {
  return `${config.screenshotService.url.replace(/\/$/, "")}/render-screenshots/`;
}

export async function renderModelScreenshots(
  input: {
    modelData: string;
    format: ModelFormat;
    width?: number;
    height?: number;
    angles?: ViewingAngle[];
    zoomFactor?: number;
  },
  opts?: { onQueuePositionChange?: (position: number, total: number) => void },
): Promise<StlRenderResult> {
  const angles = input.angles ?? ["front", "back", "left", "right", "top", "bottom", "ortho_45", "ortho_45_bottom", "isometric"];

  if (config.query.renderMode === "mock") {
    logger.info({ angleCount: angles.length }, "mock mode, returning mock screenshots");
    return {
      images: angles.map((angle) => ({ angle, base64: MOCK_PNG_BASE64 })),
    };
  }

  return screenshotSemaphore.run(
    () => _renderModelScreenshotsInner(input, angles),
    { onQueuePositionChange: opts?.onQueuePositionChange },
  );
}

async function _renderModelScreenshotsInner(
  input: {
    modelData: string;
    format: ModelFormat;
    width?: number;
    height?: number;
    angles?: ViewingAngle[];
    zoomFactor?: number;
  },
  angles: ViewingAngle[],
): Promise<StlRenderResult> {
  const url = resolveScreenshotUrl();

  logger.info(
    { url, format: input.format, dataLength: input.modelData.length, angles },
    "POST to screenshot service",
  );

  let response: Response | undefined;
  let lastError: StlRenderingError | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelData: input.modelData,
          format: input.format,
          width: input.width ?? 512,
          height: input.height ?? 512,
          angles,
          ...(input.zoomFactor && input.zoomFactor > 1 ? { zoomFactor: input.zoomFactor } : {}),
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      // Request succeeded (got a response) — break out of retry loop
      lastError = undefined;
      break;
    } catch (fetchError) {
      const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      const isTimeout = fetchError instanceof Error && fetchError.name === "AbortError";
      lastError = new StlRenderingError(
        isTimeout
          ? `STL rendering service timeout after ${FETCH_TIMEOUT_MS / 1000}s`
          : `STL rendering service unreachable: ${msg}`,
        502,
      );

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          { url, err: msg, isTimeout, attempt, maxRetries: MAX_RETRIES, retryDelayMs: delay },
          `STL rendering service failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        logger.error(
          { url, err: msg, isTimeout, attempt, maxRetries: MAX_RETRIES },
          `STL rendering service failed after ${MAX_RETRIES} attempts`,
        );
      }
    }
  }

  if (lastError || !response) {
    throw lastError ?? new StlRenderingError("STL rendering service failed after retries", 502);
  }

  logger.info({ status: response.status, statusText: response.statusText }, "STL rendering response received");

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : "STL rendering request failed";
    const errorType = (body as { type?: unknown }).type;
    const statusCode =
      errorType === "client" ? 400 : response.status >= 400 ? response.status : 502;
    logger.error({ message, errorType: String(errorType), statusCode }, "STL rendering error");
    throw new StlRenderingError(message, statusCode);
  }

  const images = (body as { images?: unknown[] }).images;
  if (!Array.isArray(images) || images.length === 0) {
    logger.error({ bodyKeys: Object.keys(body as object) }, "no images in response");
    throw new StlRenderingError("STL rendering service returned no images", 502);
  }

  const result: RenderedScreenshot[] = [];
  for (const img of images) {
    const typed = img as { angle?: unknown; base64?: unknown };
    if (typeof typed.angle === "string" && typeof typed.base64 === "string") {
      result.push({
        angle: typed.angle as ViewingAngle,
        base64: typed.base64,
      });
    }
  }

  if (result.length === 0) {
    logger.error({ imageCount: images.length }, "images array had entries but none valid");
    throw new StlRenderingError("STL rendering service returned no valid images", 502);
  }

  logger.info({ screenshotCount: result.length }, "STL rendering success");
  return { images: result };
}
