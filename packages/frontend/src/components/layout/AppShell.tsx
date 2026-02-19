import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface AppShellProps {
  sidebar?: ReactNode;
  topbar?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AppShell({ sidebar, topbar, children, className }: AppShellProps) {
  return (
    <div className={cn("min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]", className)}>
      {topbar ? <div className="sticky top-0 z-30 border-b bg-white/85 px-4 py-3 backdrop-blur">{topbar}</div> : null}
      <div className="mx-auto flex w-full max-w-[1600px] gap-4 px-3 py-3 md:px-4">
        {sidebar ? (
          <aside className="hidden w-[280px] flex-shrink-0 lg:block">
            <div className="sticky top-[74px] h-[calc(100vh-88px)] overflow-y-auto rounded-xl border bg-white p-3 shadow-[var(--elevation-1)]">
              {sidebar}
            </div>
          </aside>
        ) : null}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
