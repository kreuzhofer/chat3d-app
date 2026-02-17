import type { AuthUser, UserRole } from "./types";

export function canAccessAuthenticatedRoute(user: AuthUser | null): boolean {
  return user?.status === "active";
}

export function canAccessRole(user: AuthUser | null, roles: UserRole[]): boolean {
  if (!user || user.status !== "active") {
    return false;
  }
  return roles.includes(user.role);
}
