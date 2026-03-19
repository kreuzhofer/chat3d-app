import type { AuthResponse } from "../auth/types";

export interface PublicConfig {
  setupRequired: boolean;
  waitlistEnabled: boolean;
  emailConfirmationEnabled: boolean;
  invitationsEnabled: boolean;
}

const PUBLIC_API_BASE = "/api/public";

// ── Initial setup ────────────────────────────────────────────────────

export interface SetupPayload {
  email: string;
  password: string;
  displayName?: string;
}

export async function submitSetup(payload: SetupPayload): Promise<AuthResponse> {
  const response = await fetch("/api/setup/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Setup failed";
    throw new Error(message);
  }

  return body as AuthResponse;
}

// ── Recent models (public library) ──────────────────────────────────

export interface RecentModel {
  id: string;
  promptText: string;
  categoryId: string;
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

// ── Starter prompts (onboarding) ────────────────────────────────────

export interface StarterPrompt {
  id: string;
  promptText: string;
  categoryName: string;
  categoryId: string;
  screenshotUrl: string;
}

export async function getStarterPrompts(limit = 4): Promise<StarterPrompt[]> {
  const response = await fetch(`${PUBLIC_API_BASE}/gallery/starter-prompts?limit=${limit}`, {
    method: "GET",
  });

  if (!response.ok) return [];
  const body = await response.json().catch(() => []);
  return body as StarterPrompt[];
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
    setupRequired: Boolean((body as { setupRequired?: unknown }).setupRequired),
    waitlistEnabled: Boolean((body as { waitlistEnabled?: unknown }).waitlistEnabled),
    emailConfirmationEnabled: (body as { emailConfirmationEnabled?: unknown }).emailConfirmationEnabled !== false,
    invitationsEnabled: Boolean((body as { invitationsEnabled?: unknown }).invitationsEnabled),
  };
}
