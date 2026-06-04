import type { RenderErrorCategoryName, RenderErrorExample } from "@chat3d/shared";

const RENDER_ERRORS_API_BASE = "/api/admin/render-errors";

export interface RenderErrorExamplesResponse {
  examples: RenderErrorExample[];
  total: number;
}

async function requestJson<T>(
  token: string,
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: HeadersInit } = {},
): Promise<T> {
  const response = await fetch(`${RENDER_ERRORS_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Render-errors request failed";
    throw new Error(message);
  }

  return body as T;
}

export async function fetchRenderErrorExamples(
  token: string,
  params: {
    categoryId: string;
    errorCategory: RenderErrorCategoryName;
    limit?: number;
    offset?: number;
  },
): Promise<RenderErrorExamplesResponse> {
  const search = new URLSearchParams({
    categoryId: params.categoryId,
    errorCategory: params.errorCategory,
    limit: String(params.limit ?? 50),
    offset: String(params.offset ?? 0),
  });
  return requestJson<RenderErrorExamplesResponse>(token, `/examples?${search.toString()}`, {
    method: "GET",
  });
}
