export type UserRole = "admin" | "user";
export type UserStatus = "active" | "deactivated" | "pending_registration";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  displayName: string | null;
  language?: string;
  onboardingCompletedAt: string | null;
  generationCount: number;
}

export interface AuthResponse {
  token?: string;
  status?: string;
  user: AuthUser;
}
