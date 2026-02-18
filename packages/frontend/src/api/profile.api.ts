const PROFILE_API_BASE = "/api/profile";

export interface ProfileActionConfirmResult {
  status: "completed";
  actionType: "password_reset" | "email_change" | "data_export" | "account_delete" | "account_reactivate" | null;
}

async function requestProfileJson<T>(
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: HeadersInit } = {},
): Promise<T> {
  const response = await fetch(`${PROFILE_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Profile request failed";
    throw new Error(message);
  }

  return body as T;
}

export function requestPasswordReset(token: string, newPassword: string): Promise<{ status: string }> {
  return requestProfileJson<{ status: string }>("/reset-password/request", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ newPassword }),
  });
}

export function requestEmailChange(token: string, newEmail: string): Promise<{ status: string }> {
  return requestProfileJson<{ status: string }>("/change-email/request", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ newEmail }),
  });
}

export function requestDataExport(token: string): Promise<{ status: string }> {
  return requestProfileJson<{ status: string }>("/export-data/request", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
}

export function requestAccountDelete(token: string): Promise<{ status: string }> {
  return requestProfileJson<{ status: string }>("/delete-account/request", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
}

export function requestAccountReactivation(email: string): Promise<{ status: string }> {
  return requestProfileJson<{ status: string }>("/reactivate/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function confirmProfileAction(token: string): Promise<ProfileActionConfirmResult> {
  const params = new URLSearchParams({ token });
  return requestProfileJson<ProfileActionConfirmResult>(`/actions/confirm?${params.toString()}`, {
    method: "GET",
  });
}
