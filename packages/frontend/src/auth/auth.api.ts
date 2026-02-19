import type { AuthResponse, AuthUser } from "./types";

const API_BASE = "/api/auth";

interface CredentialsPayload {
  email: string;
  password: string;
}

interface RegisterPayload extends CredentialsPayload {
  displayName?: string;
  registrationToken?: string;
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Request failed";
    throw new Error(message);
  }

  return body as T;
}

export function login(payload: CredentialsPayload): Promise<AuthResponse> {
  return requestJson<AuthResponse>(`${API_BASE}/login`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function register(payload: RegisterPayload): Promise<AuthResponse> {
  return requestJson<AuthResponse>(`${API_BASE}/register`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function logout(token: string): Promise<void> {
  const response = await fetch(`${API_BASE}/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok && response.status !== 401) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body?.error === "string" ? body.error : "Logout request failed";
    throw new Error(message);
  }
}

export function me(token: string): Promise<AuthUser> {
  return requestJson<AuthUser>(`${API_BASE}/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}
