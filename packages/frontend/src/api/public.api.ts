export interface PublicConfig {
  waitlistEnabled: boolean;
}

const PUBLIC_API_BASE = "/api/public";

// ── Recent models (public library) ──────────────────────────────────

export interface RecentModel {
  id: string;
  promptText: string;
  categoryName: string;
  evalScore: number | null;
  createdAt: string;
}

export async function getRecentModels(): Promise<RecentModel[]> {
  const response = await fetch(`${PUBLIC_API_BASE}/recent-models`, {
    method: "GET",
  });

  if (!response.ok) return [];
  const body = await response.json().catch(() => []);
  return body as RecentModel[];
}

export function getRecentModelScreenshotUrl(modelId: string): string {
  return `${PUBLIC_API_BASE}/recent-models/${encodeURIComponent(modelId)}/screenshot`;
}

// ── Config ──────────────────────────────────────────────────────────

export async function getPublicConfig(): Promise<PublicConfig> {
  const response = await fetch(`${PUBLIC_API_BASE}/config`, {
    method: "GET",
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Failed to load public config";
    throw new Error(message);
  }

  return {
    waitlistEnabled: Boolean((body as { waitlistEnabled?: unknown }).waitlistEnabled),
  };
}
