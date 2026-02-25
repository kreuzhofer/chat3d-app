import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { build123dSemaphore } from "../utils/resource-limits.js";

const logger = createLogger("render");

/** HTTP timeout for the Build123d rendering service.
 *  Code execution + STEP/3MF export can be slow for complex models. */
const BUILD123D_TIMEOUT_MS = 120_000;

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

  let response: Response;
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
  } catch (fetchError) {
    const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    const isTimeout = fetchError instanceof Error && fetchError.name === "AbortError";
    logger.error({ url, err: msg, isTimeout }, "fetch error connecting to Build123d");
    throw new RenderingServiceError(
      isTimeout
        ? `Build123d service timeout after ${BUILD123D_TIMEOUT_MS / 1000}s`
        : `Build123d service unreachable: ${msg}`,
      502,
      true, // infrastructure error — code is fine, service is down
    );
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
