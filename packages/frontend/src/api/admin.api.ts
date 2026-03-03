import type { UserRole, UserStatus } from "../auth/types";

export type WaitlistStatus =
  | "pending_email_confirmation"
  | "pending_admin_approval"
  | "approved"
  | "rejected";

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  status: UserStatus;
  deactivatedUntil: string | null;
  createdAt: string;
}

export interface AdminWaitlistEntry {
  id: string;
  email: string;
  status: WaitlistStatus;
  marketingConsent: boolean;
  emailConfirmedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface AdminSettings {
  waitlistEnabled: boolean;
  invitationsEnabled: boolean;
  invitationWaitlistRequired: boolean;
  invitationQuotaPerUser: number;
  updatedAt: string;
}

export interface AdminSettingsPatch {
  waitlistEnabled?: boolean;
  invitationsEnabled?: boolean;
  invitationWaitlistRequired?: boolean;
  invitationQuotaPerUser?: number;
}

const ADMIN_API_BASE = "/api/admin";

async function requestAdminJson<T>(
  token: string,
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: HeadersInit } = {},
): Promise<T> {
  const response = await fetch(`${ADMIN_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Admin request failed";
    throw new Error(message);
  }

  return body as T;
}

export async function listAdminUsers(token: string, search?: string): Promise<AdminUser[]> {
  const query = new URLSearchParams();
  if (search && search.trim() !== "") {
    query.set("search", search.trim());
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await requestAdminJson<{ users: AdminUser[] }>(token, `/users${suffix}`, { method: "GET" });
  return Array.isArray(response.users) ? response.users : [];
}

export async function deactivateAdminUser(
  token: string,
  userId: string,
  reason?: string,
): Promise<AdminUser> {
  const payload = reason && reason.trim() !== "" ? { reason: reason.trim() } : {};
  return requestAdminJson<AdminUser>(token, `/users/${encodeURIComponent(userId)}/deactivate`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function activateAdminUser(token: string, userId: string): Promise<AdminUser> {
  return requestAdminJson<AdminUser>(token, `/users/${encodeURIComponent(userId)}/activate`, {
    method: "PATCH",
  });
}

export async function triggerAdminPasswordReset(token: string, userId: string): Promise<{
  userId: string;
  email: string;
  status: "pending";
}> {
  return requestAdminJson<{ userId: string; email: string; status: "pending" }>(
    token,
    `/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: "POST",
    },
  );
}

export async function listAdminWaitlist(token: string): Promise<AdminWaitlistEntry[]> {
  const response = await requestAdminJson<{ entries: AdminWaitlistEntry[] }>(token, "/waitlist", {
    method: "GET",
  });
  return Array.isArray(response.entries) ? response.entries : [];
}

export async function approveAdminWaitlistEntry(
  token: string,
  entryId: string,
): Promise<AdminWaitlistEntry> {
  return requestAdminJson<AdminWaitlistEntry>(token, `/waitlist/${encodeURIComponent(entryId)}/approve`, {
    method: "PATCH",
  });
}

export async function rejectAdminWaitlistEntry(
  token: string,
  entryId: string,
): Promise<AdminWaitlistEntry> {
  return requestAdminJson<AdminWaitlistEntry>(token, `/waitlist/${encodeURIComponent(entryId)}/reject`, {
    method: "PATCH",
  });
}

export function getAdminSettings(token: string): Promise<AdminSettings> {
  return requestAdminJson<AdminSettings>(token, "/settings", { method: "GET" });
}

export function updateAdminSettings(token: string, patch: AdminSettingsPatch): Promise<AdminSettings> {
  return requestAdminJson<AdminSettings>(token, "/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// ── LLM Provider Configuration ────────────────────────────────────

export interface LlmProviderRow {
  name: string;
  display_name: string | null;
  api_key: string | null; // masked (e.g., "sk-ab****") — never contains full key
  endpoint_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateLlmProviderInput {
  name: string;
  displayName?: string;
  apiKey?: string | null;
  endpointUrl?: string | null;
}

export async function listLlmProviders(token: string): Promise<LlmProviderRow[]> {
  const response = await requestAdminJson<{ providers: LlmProviderRow[] }>(token, "/llm-providers", { method: "GET" });
  return Array.isArray(response.providers) ? response.providers : [];
}

export async function getProviderApiKey(token: string, name: string): Promise<string | null> {
  const result = await requestAdminJson<{ apiKey: string | null }>(token, `/llm-providers/${encodeURIComponent(name)}/api-key`, {
    method: "GET",
  });
  return result.apiKey;
}

export async function createLlmProvider(token: string, input: CreateLlmProviderInput): Promise<LlmProviderRow> {
  return requestAdminJson<LlmProviderRow>(token, "/llm-providers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateLlmProvider(token: string, name: string, patch: Record<string, unknown>): Promise<LlmProviderRow> {
  return requestAdminJson<LlmProviderRow>(token, `/llm-providers/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteLlmProvider(token: string, name: string): Promise<void> {
  await fetch(`${ADMIN_API_BASE}/llm-providers/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── LLM Model Configuration ────────────────────────────────────────

export interface LlmModelRow {
  id: string;
  provider: string;
  model_name: string;
  display_name: string | null;
  cost_per_1m_input: number;
  cost_per_1m_output: number;
  max_output_tokens: number | null;
  max_context_tokens: number | null;
  supports_thinking: boolean;
  default_thinking_effort: string | null;
  supports_vision: boolean;
  supports_embeddings: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LlmPurposeRow {
  id: string | null;
  purpose: string;
  modelId: string | null;
  modelDisplayName: string | null;
  modelProvider: string | null;
  modelModelName: string | null;
  overrideMaxOutputTokens: number | null;
  overrideThinkingEffort: string | null;
}

export interface CreateLlmModelInput {
  provider: string;
  modelName: string;
  displayName?: string;
  costPer1mInput?: number;
  costPer1mOutput?: number;
  maxOutputTokens?: number | null;
  maxContextTokens?: number | null;
  supportsThinking?: boolean;
  defaultThinkingEffort?: string | null;
  supportsVision?: boolean;
  supportsEmbeddings?: boolean;
}

export async function listAdminLlmModels(token: string): Promise<LlmModelRow[]> {
  const response = await requestAdminJson<{ models: LlmModelRow[] }>(token, "/llm-models", { method: "GET" });
  return Array.isArray(response.models) ? response.models : [];
}

export async function createLlmModel(token: string, input: CreateLlmModelInput): Promise<LlmModelRow> {
  return requestAdminJson<LlmModelRow>(token, "/llm-models", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateLlmModel(token: string, id: string, patch: Record<string, unknown>): Promise<LlmModelRow> {
  return requestAdminJson<LlmModelRow>(token, `/llm-models/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteLlmModel(token: string, id: string): Promise<void> {
  await fetch(`${ADMIN_API_BASE}/llm-models/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function listLlmPurposes(token: string): Promise<LlmPurposeRow[]> {
  const response = await requestAdminJson<{ purposes: LlmPurposeRow[] }>(token, "/llm-purposes", { method: "GET" });
  return Array.isArray(response.purposes) ? response.purposes : [];
}

export async function updateLlmPurpose(
  token: string,
  purpose: string,
  patch: { modelId?: string; overrideMaxOutputTokens?: number | null; overrideThinkingEffort?: string | null },
): Promise<LlmPurposeRow> {
  return requestAdminJson<LlmPurposeRow>(token, `/llm-purposes/${encodeURIComponent(purpose)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
