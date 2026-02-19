const INVITATIONS_API_BASE = "/api/invitations";

export type InvitationStatus =
  | "pending"
  | "waitlisted"
  | "registration_sent"
  | "accepted"
  | "expired"
  | "revoked";

export interface InvitationRecord {
  id: string;
  inviterUserId: string;
  inviteeEmail: string;
  status: InvitationStatus;
  registrationTokenId: string | null;
  createdAt: string;
  updatedAt: string;
}

async function requestInvitationsJson<T>(
  token: string,
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: HeadersInit } = {},
): Promise<T> {
  const response = await fetch(`${INVITATIONS_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Invitations request failed";
    throw new Error(message);
  }

  return body as T;
}

export async function listInvitations(token: string): Promise<InvitationRecord[]> {
  const response = await requestInvitationsJson<{ invitations: InvitationRecord[] }>(token, "/", {
    method: "GET",
  });
  return Array.isArray(response.invitations) ? response.invitations : [];
}

export async function createInvitations(token: string, emails: string[]): Promise<InvitationRecord[]> {
  const response = await requestInvitationsJson<{ invitations: InvitationRecord[] }>(token, "/", {
    method: "POST",
    body: JSON.stringify({ emails }),
  });
  return Array.isArray(response.invitations) ? response.invitations : [];
}

export function revokeInvitation(token: string, invitationId: string): Promise<InvitationRecord> {
  return requestInvitationsJson<InvitationRecord>(token, `/${encodeURIComponent(invitationId)}`, {
    method: "DELETE",
  });
}
