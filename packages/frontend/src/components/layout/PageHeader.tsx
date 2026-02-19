import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: string[];
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, breadcrumbs = [], actions, className }: PageHeaderProps) {
  return (
    <header className={cn("space-y-3", className)}>
      {breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="text-xs text-[hsl(var(--muted-foreground))]">
          {breadcrumbs.join(" / ")}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">{title}</h1>
          {description ? <p className="max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
