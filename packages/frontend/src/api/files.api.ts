const FILES_API_BASE = "/api/files";

export interface StoredFileInfo {
  path: string;
  sizeBytes: number;
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
