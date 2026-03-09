import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useNotifications } from "../../contexts/NotificationsContext";
import { useAuth } from "../../hooks/useAuth";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";
import { useSidebar } from "../../hooks/useSidebar";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";
import { Sidebar, SidebarToggle } from "./Sidebar";

interface AppShellProps {
  children: ReactNode;
  className?: string;
}

export function AppShell({ children, className }: AppShellProps) {
  const { isOpen, isMobile } = useSidebar();
  const { user } = useAuth();
  const { connectionState } = useNotifications();
  const isAdmin = user?.role === "admin";
  const { ref: pullRef, progress, thresholdReached, releasing, refreshing } = usePullToRefresh();

  return (
    <div className={cn("flex h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]", className)}>
      <PullToRefreshIndicator
        progress={progress}
        thresholdReached={thresholdReached}
        releasing={releasing}
        refreshing={refreshing}
      />

      {/* Sidebar */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Minimal topbar */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-[hsl(var(--border)_/_0.3)] px-3">
          <div className="flex items-center gap-2">
            <SidebarToggle />
            {!isOpen || isMobile ? (
              <span className="text-sm font-semibold text-[hsl(var(--foreground))]">Chat3D</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && connectionState !== "open" ? (
              <span className="h-2 w-2 rounded-full bg-[hsl(var(--warning))]" title="SSE disconnected" />
            ) : null}
          </div>
        </div>

        {/* Page content */}
        <main
          ref={pullRef as React.RefObject<HTMLElement>}
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-3"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
