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
    console.log(`[render] mock mode — returning mock files for ${input.baseFileName}`);
    return {
      files: mockRenderedFiles(input.baseFileName),
      renderer: "mock",
    };
  }

  const url = `${config.query.build123dUrl.replace(/\/$/, "")}/render/`;
  const payload = {
    code: input.code,
    filename: `${input.baseFileName}.step`,
  };

  console.log(`[render] POST ${url} (code length=${input.code.length}, filename=${payload.filename})`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (fetchError) {
    const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error(`[render] fetch error connecting to ${url}: ${msg}`);
    throw new RenderingServiceError(`Build123d service unreachable: ${msg}`, 502);
  }

  console.log(`[render] response status=${response.status} ${response.statusText}`);

  const body = await response.json().catch(() => ({}));
  const files = Array.isArray((body as { files?: unknown[] }).files)
    ? ((body as { files: Array<{ filename?: unknown; content?: unknown }> }).files ?? [])
    : [];

  console.log(
    `[render] response body keys=${Object.keys(body as object).join(",")}, files count=${files.length}`,
  );

  if (!response.ok || files.length === 0) {
    const message =
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : "Rendering request failed";
    console.error(`[render] render error: ${message} (status=${response.status})`);
    throw new RenderingServiceError(message, response.status >= 400 ? response.status : 502);
  }

  const mappedFiles: RenderedFile[] = [];
  for (const file of files) {
    if (typeof file.filename !== "string" || typeof file.content !== "string") {
      console.warn(`[render] skipping invalid file entry: ${JSON.stringify(file).slice(0, 200)}`);
      continue;
    }
    console.log(`[render] received file: ${file.filename} (content length=${file.content.length})`);
    mappedFiles.push({
      filename: file.filename,
      contentBase64: file.content,
    });
  }

  if (mappedFiles.length === 0) {
    throw new RenderingServiceError("Rendering service returned no valid files", 502);
  }

  console.log(`[render] success — ${mappedFiles.length} files for ${input.baseFileName}`);
  return {
    files: mappedFiles,
    renderer: "build123d",
  };
}
