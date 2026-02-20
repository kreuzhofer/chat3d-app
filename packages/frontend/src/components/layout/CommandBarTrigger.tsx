import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function CommandBarTrigger({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-3 text-sm text-[hsl(var(--muted-foreground))] shadow-[var(--elevation-1)] transition hover:bg-[hsl(var(--muted))]",
        className,
      )}
      {...props}
    >
      <span className="font-medium text-[hsl(var(--foreground))]">Search or run command</span>
      <span className="ml-auto rounded border border-[hsl(var(--border))] px-1.5 py-0.5 text-[10px]">⌘K</span>
    </button>
  );
}
