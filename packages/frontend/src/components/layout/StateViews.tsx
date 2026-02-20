import type { ReactNode } from "react";
import { InlineAlert } from "./InlineAlert";

interface LoadingViewProps {
  label?: string;
}

export function LoadingView({ label = "Loading..." }: LoadingViewProps) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-6">
      <p className="text-sm text-[hsl(var(--muted-foreground))]">{label}</p>
    </div>
  );
}

interface ErrorViewProps {
  title?: string;
  message: string;
  action?: ReactNode;
}

export function ErrorView({ title = "Something went wrong", message, action }: ErrorViewProps) {
  return (
    <div className="space-y-3">
      <InlineAlert tone="danger">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm">{message}</p>
      </InlineAlert>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
