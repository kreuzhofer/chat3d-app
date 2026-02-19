import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-6 text-center",
        className,
      )}
    >
      <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">{title}</h3>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
