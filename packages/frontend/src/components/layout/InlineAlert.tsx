import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type InlineAlertTone = "info" | "success" | "warning" | "danger";

const toneClasses: Record<InlineAlertTone, string> = {
  info: "border-[hsl(var(--info)_/_0.3)] bg-[hsl(var(--info)_/_0.08)] text-[hsl(var(--info))]",
  success: "border-[hsl(var(--success)_/_0.3)] bg-[hsl(var(--success)_/_0.08)] text-[hsl(var(--success))]",
  warning: "border-[hsl(var(--warning)_/_0.3)] bg-[hsl(var(--warning)_/_0.08)] text-[hsl(var(--warning))]",
  danger: "border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.08)] text-[hsl(var(--destructive))]",
};

export interface InlineAlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: InlineAlertTone;
}

export function InlineAlert({ tone = "info", className, ...props }: InlineAlertProps) {
  return <div className={cn("rounded-md border px-3 py-2 text-sm", toneClasses[tone], className)} {...props} />;
}
