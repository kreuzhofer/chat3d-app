import { config } from "../config.js";

export type ViewingAngle = "front" | "top" | "isometric";
export type ModelFormat = "stl" | "3mf";

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
    console.log(`[stl-render] mock mode — returning ${angles.length} mock screenshots`);
    return {
      images: angles.map((angle) => ({ angle, base64: MOCK_PNG_BASE64 })),
    };
  }

  const url = `${config.stlRenderingService.url.replace(/\/$/, "")}/render`;

  console.log(
    `[stl-render] POST ${url} (format=${input.format}, data length=${input.modelData.length}, angles=${angles.join(",")})`,
  );

  let response: Response;
  try {
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
    });
  } catch (fetchError) {
    const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error(`[stl-render] fetch error connecting to ${url}: ${msg}`);
    throw new StlRenderingError(`STL rendering service unreachable: ${msg}`, 502);
  }

  console.log(`[stl-render] response status=${response.status} ${response.statusText}`);

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : "STL rendering request failed";
    const errorType = (body as { type?: unknown }).type;
    const statusCode =
      errorType === "client" ? 400 : response.status >= 400 ? response.status : 502;
    console.error(`[stl-render] error: ${message} (type=${String(errorType)}, status=${statusCode})`);
    throw new StlRenderingError(message, statusCode);
  }

  const images = (body as { images?: unknown[] }).images;
  if (!Array.isArray(images) || images.length === 0) {
    console.error(`[stl-render] no images in response, keys=${Object.keys(body as object).join(",")}`);
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
    console.error(`[stl-render] images array had ${images.length} entries but none valid`);
    throw new StlRenderingError("STL rendering service returned no valid images", 502);
  }

  console.log(`[stl-render] success — ${result.length} screenshots rendered`);
  return { images: result };
}
