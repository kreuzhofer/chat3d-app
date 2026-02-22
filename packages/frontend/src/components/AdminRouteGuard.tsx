import type { ReactNode } from "react";
import { RequireRole } from "./RequireRole";

interface AdminRouteGuardProps {
  children?: ReactNode;
}

/**
 * Route guard that restricts access to admin-only pages.
 * Non-admin users are redirected to /chat using replace navigation
 * (no browser history entry for the restricted route).
 */
export function AdminRouteGuard({ children }: AdminRouteGuardProps) {
  return (
    <RequireRole roles={["admin"]} redirectTo="/chat">
      {children}
    </RequireRole>
  );
}
