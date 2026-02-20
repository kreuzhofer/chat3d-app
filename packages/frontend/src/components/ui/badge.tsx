import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
  success: "border-[hsl(var(--success)_/_0.3)] bg-[hsl(var(--success)_/_0.12)] text-[hsl(var(--success))]",
  warning: "border-[hsl(var(--warning)_/_0.3)] bg-[hsl(var(--warning)_/_0.12)] text-[hsl(var(--warning))]",
  danger: "border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.12)] text-[hsl(var(--destructive))]",
  info: "border-[hsl(var(--info)_/_0.3)] bg-[hsl(var(--info)_/_0.12)] text-[hsl(var(--info))]",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
