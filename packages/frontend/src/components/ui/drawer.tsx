import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface DrawerProps {
  open: boolean;
  title: string;
  description?: string;
  side?: "left" | "right";
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({ open, title, description, side = "right", onClose, children }: DrawerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const drawerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const target = drawerRef.current;
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

      const container = drawerRef.current;
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
    <div className="fixed inset-0 z-[65]" role="presentation">
      <button
        type="button"
        aria-label="Close drawer"
        className="absolute inset-0 bg-black/35 animate-fade-in"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "absolute top-0 h-full w-full max-w-xl overflow-y-auto border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-5 shadow-[var(--elevation-3)]",
          side === "right" ? "right-0 border-l animate-slide-in-right" : "left-0 border-r animate-slide-in-left",
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
      </aside>
    </div>
  );
}
