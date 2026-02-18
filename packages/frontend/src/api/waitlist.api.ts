const WAITLIST_API_BASE = "/api/waitlist";

export type WaitlistStatus =
  | "pending_email_confirmation"
  | "pending_admin_approval"
  | "approved"
  | "rejected";

export interface WaitlistJoinResponse {
  entryId: string;
  status: WaitlistStatus;
}

export interface WaitlistStatusResponse {
  entryId: string;
  email: string;
  status: WaitlistStatus;
  marketingConsent: boolean;
  emailConfirmedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
}

async function requestWaitlistJson<T>(
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: HeadersInit } = {},
): Promise<T> {
  const response = await fetch(`${WAITLIST_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Waitlist request failed";
    throw new Error(message);
  }

  return body as T;
}

export function joinWaitlist(email: string, marketingConsent: boolean): Promise<WaitlistJoinResponse> {
  return requestWaitlistJson<WaitlistJoinResponse>("/join", {
    method: "POST",
    body: JSON.stringify({ email, marketingConsent }),
  });
}

export function confirmWaitlistEmail(token: string): Promise<WaitlistJoinResponse & { email: string }> {
  const params = new URLSearchParams({ token });
  return requestWaitlistJson<WaitlistJoinResponse & { email: string }>(`/confirm-email?${params.toString()}`, {
    method: "GET",
  });
}

export function getWaitlistStatus(input: { email?: string; token?: string }): Promise<WaitlistStatusResponse> {
  const params = new URLSearchParams();
  if (input.email) {
    params.set("email", input.email);
  }
  if (input.token) {
    params.set("token", input.token);
  }
  return requestWaitlistJson<WaitlistStatusResponse>(`/status?${params.toString()}`, {
    method: "GET",
  });
}
