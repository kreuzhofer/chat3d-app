export type UserRole = "admin" | "user";
export type UserStatus = "active" | "deactivated" | "pending_registration";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  displayName: string | null;
  language?: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}
