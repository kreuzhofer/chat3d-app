import { useEffect, type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ open, title, description, onClose, children }: DialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="presentation">
      <button
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        type="button"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative z-[71] w-full max-w-lg rounded-xl border border-[hsl(var(--border))] bg-white p-5 shadow-[var(--elevation-3)]",
        )}
      >
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">{title}</h2>
          {description ? <p className="text-sm text-[hsl(var(--muted-foreground))]">{description}</p> : null}
        </header>
        <div className="mt-4">{children}</div>
      </section>
    </div>
  );
}
