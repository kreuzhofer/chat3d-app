import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ open, title, description, onClose, children }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const target = dialogRef.current;
    if (target) {
      const focusable = target.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable[0]) {
        focusable[0].focus();
      } else {
        target.focus();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const container = dialogRef.current;
      if (!container) {
        return;
      }

      const focusable = [...container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousActiveElement?.focus();
    };
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "relative z-[71] w-full max-w-lg rounded-xl border border-[hsl(var(--border))] bg-white p-5 shadow-[var(--elevation-3)]",
        )}
      >
        <header className="space-y-1">
          <h2 id={titleId} className="text-lg font-semibold text-[hsl(var(--foreground))]">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="text-sm text-[hsl(var(--muted-foreground))]">
              {description}
            </p>
          ) : null}
        </header>
        <div className="mt-4">{children}</div>
      </section>
    </div>
  );
}
