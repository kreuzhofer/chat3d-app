import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type InlineAlertTone = "info" | "success" | "warning" | "danger";

const toneClasses: Record<InlineAlertTone, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-900",
};

export interface InlineAlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: InlineAlertTone;
}

export function InlineAlert({ tone = "info", className, ...props }: InlineAlertProps) {
  return <div className={cn("rounded-md border px-3 py-2 text-sm", toneClasses[tone], className)} {...props} />;
}
