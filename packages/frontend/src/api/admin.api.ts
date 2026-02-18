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
