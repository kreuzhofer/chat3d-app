import type {
  GalleryCategory,
  GalleryModelDetail,
  GalleryModelSummary,
  GallerySearchResult,
  PaginatedResult,
} from "@chat3d/shared";

const GALLERY_API_BASE = "/api/public/gallery";

export type { GalleryCategory, GalleryModelDetail, GalleryModelSummary, GallerySearchResult, PaginatedResult };

// ── Public gallery endpoints (no auth) ──────────────────────────────

export async function getGalleryCategories(
  page = 1,
  pageSize = 20,
): Promise<PaginatedResult<GalleryCategory>> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const res = await fetch(`${GALLERY_API_BASE}/categories?${params}`);
  if (!res.ok) return { items: [], total: 0, page, pageSize, hasMore: false };
  return res.json();
}

export async function getGalleryCategoryModels(
  categoryId: string,
  page = 1,
  pageSize = 20,
): Promise<PaginatedResult<GalleryModelSummary>> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const res = await fetch(
    `${GALLERY_API_BASE}/categories/${encodeURIComponent(categoryId)}/models?${params}`,
  );
  if (!res.ok) return { items: [], total: 0, page, pageSize, hasMore: false };
  return res.json();
}

export async function getGalleryModel(id: string): Promise<GalleryModelDetail | null> {
  const res = await fetch(`${GALLERY_API_BASE}/models/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return res.json();
}

export async function searchGalleryModels(
  query: string,
  page = 1,
  pageSize = 20,
): Promise<PaginatedResult<GallerySearchResult>> {
  const params = new URLSearchParams({ q: query, page: String(page), pageSize: String(pageSize) });
  const res = await fetch(`${GALLERY_API_BASE}/search?${params}`);
  if (!res.ok) return { items: [], total: 0, page, pageSize, hasMore: false };
  return res.json();
}

export function getGalleryScreenshotUrl(modelId: string): string {
  return `${GALLERY_API_BASE}/models/${encodeURIComponent(modelId)}/screenshot`;
}

export function getGalleryDownloadUrl(modelId: string, format: string): string {
  return `${GALLERY_API_BASE}/models/${encodeURIComponent(modelId)}/download/${encodeURIComponent(format)}`;
}

export async function getModelPosition(
  modelId: string,
  pageSize = 20,
): Promise<{ categoryId: string; page: number; index: number }> {
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  const res = await fetch(
    `${GALLERY_API_BASE}/models/${encodeURIComponent(modelId)}/position?${params}`,
  );
  if (!res.ok) throw new Error("Failed to get model position");
  return res.json();
}

// ── Authenticated endpoints ─────────────────────────────────────────

export async function remixModel(
  token: string,
  exampleId: string,
): Promise<{ contextId: string }> {
  const res = await fetch("/api/gallery/remix", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ exampleId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : "Remix failed");
  }

  return res.json();
}

export async function downloadProtectedFile(
  token: string,
  modelId: string,
  format: string,
): Promise<Blob> {
  const url = getGalleryDownloadUrl(modelId, format);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Download failed: ${res.status}`);
  }

  return res.blob();
}
