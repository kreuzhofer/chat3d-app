import type { ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { canAccessRole } from "../auth/guards";
import type { UserRole } from "../auth/types";
import { useAuth } from "../hooks/useAuth";

interface RequireRoleProps {
  roles: UserRole[];
  redirectTo?: string;
  children?: ReactNode;
}

export function RequireRole({ roles, redirectTo = "/", children }: RequireRoleProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!canAccessRole(user, roles)) {
    return <Navigate to={redirectTo} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
