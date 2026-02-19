export interface PublicConfig {
  waitlistEnabled: boolean;
}

const PUBLIC_API_BASE = "/api/public";

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
