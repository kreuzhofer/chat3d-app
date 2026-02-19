const FILES_API_BASE = "/api/files";

export interface StoredFileInfo {
  path: string;
  sizeBytes: number;
}

export interface DownloadedBinaryFile {
  blob: Blob;
  filename: string;
  contentType: string;
}

async function requestFiles(token: string, path: string, init: RequestInit): Promise<Response> {
  return fetch(`${FILES_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

export async function uploadFileBase64(input: {
  token: string;
  path: string;
  contentBase64: string;
  contentType?: string;
}): Promise<StoredFileInfo> {
  const response = await requestFiles(input.token, "/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path: input.path,
      contentBase64: input.contentBase64,
      contentType: input.contentType,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "File upload failed";
    throw new Error(message);
  }

  return body as StoredFileInfo;
}

export async function downloadFileText(input: { token: string; path: string }): Promise<string> {
  const query = new URLSearchParams({ path: input.path });
  const response = await requestFiles(input.token, `/download?${query.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body?.error === "string" ? body.error : "File download failed";
    throw new Error(message);
  }

  return response.text();
}

function parseFilenameFromContentDisposition(value: string | null): string {
  if (!value) {
    return "";
  }

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).replace(/^["']|["']$/g, "");
    } catch {
      return utf8Match[1].replace(/^["']|["']$/g, "");
    }
  }

  const plainMatch = value.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim().replace(/^["']|["']$/g, "");
  }

  return "";
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? "download.bin";
}

export async function downloadFileBinary(input: {
  token: string;
  path: string;
}): Promise<DownloadedBinaryFile> {
  const query = new URLSearchParams({ path: input.path });
  const response = await requestFiles(input.token, `/download?${query.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body?.error === "string" ? body.error : "File download failed";
    throw new Error(message);
  }

  const filename =
    parseFilenameFromContentDisposition(response.headers.get("Content-Disposition")) || basename(input.path);
  const contentType = response.headers.get("Content-Type") ?? "application/octet-stream";
  const blob = await response.blob();

  return {
    blob,
    filename,
    contentType,
  };
}

export async function deleteFile(input: { token: string; path: string }): Promise<void> {
  const query = new URLSearchParams({ path: input.path });
  const response = await requestFiles(input.token, `/delete?${query.toString()}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body?.error === "string" ? body.error : "File delete failed";
    throw new Error(message);
  }
}
