import { config } from "../config.js";

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

export async function renderBuild123d(input: {
  code: string;
  baseFileName: string;
}): Promise<Build123dRenderResult> {
  if (config.query.renderMode === "mock") {
    return {
      files: mockRenderedFiles(input.baseFileName),
      renderer: "mock",
    };
  }

  const response = await fetch(`${config.query.build123dUrl.replace(/\/$/, "")}/render/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code: input.code,
      filename: `${input.baseFileName}.step`,
    }),
  });

  const body = await response.json().catch(() => ({}));
  const files = Array.isArray((body as { files?: unknown[] }).files)
    ? ((body as { files: Array<{ filename?: unknown; content?: unknown }> }).files ?? [])
    : [];

  if (!response.ok || files.length === 0) {
    const message =
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : "Rendering request failed";
    throw new RenderingServiceError(message, response.status >= 400 ? response.status : 502);
  }

  const mappedFiles: RenderedFile[] = [];
  for (const file of files) {
    if (typeof file.filename !== "string" || typeof file.content !== "string") {
      continue;
    }
    mappedFiles.push({
      filename: file.filename,
      contentBase64: file.content,
    });
  }

  if (mappedFiles.length === 0) {
    throw new RenderingServiceError("Rendering service returned no valid files", 502);
  }

  return {
    files: mappedFiles,
    renderer: "build123d",
  };
}
