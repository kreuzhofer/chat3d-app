import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("stl-render");

export type ViewingAngle = "front" | "top" | "isometric";
export type ModelFormat = "stl" | "3mf";

/** Backend-side timeout for the HTTP call to the STL rendering service.
 *  Must be longer than the service's internal render timeout (30s)
 *  to allow for cold-start page creation + rendering. */
const FETCH_TIMEOUT_MS = 45_000;

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

export async function renderModelScreenshots(input: {
  modelData: string;
  format: ModelFormat;
  width?: number;
  height?: number;
  angles?: ViewingAngle[];
}): Promise<StlRenderResult> {
  const angles = input.angles ?? ["front", "top", "isometric"];

  if (config.query.renderMode === "mock") {
    logger.info({ angleCount: angles.length }, "mock mode, returning mock screenshots");
    return {
      images: angles.map((angle) => ({ angle, base64: MOCK_PNG_BASE64 })),
    };
  }

  const url = `${config.stlRenderingService.url.replace(/\/$/, "")}/render`;

  logger.info(
    { url, format: input.format, dataLength: input.modelData.length, angles },
    "POST to STL rendering service",
  );

  let response: Response;
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
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (fetchError) {
    const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    const isTimeout = fetchError instanceof Error && fetchError.name === "AbortError";
    logger.error({ url, err: msg, isTimeout }, "error connecting to STL rendering service");
    throw new StlRenderingError(
      isTimeout
        ? `STL rendering service timeout after ${FETCH_TIMEOUT_MS / 1000}s`
        : `STL rendering service unreachable: ${msg}`,
      502,
    );
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
