import type { ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { canAccessAuthenticatedRoute } from "../auth/guards";
import { useAuth } from "../hooks/useAuth";

interface RequireAuthProps {
  redirectTo?: string;
  children?: ReactNode;
}

export function RequireAuth({ redirectTo = "/login", children }: RequireAuthProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!canAccessAuthenticatedRoute(user)) {
    return <Navigate to={redirectTo} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
