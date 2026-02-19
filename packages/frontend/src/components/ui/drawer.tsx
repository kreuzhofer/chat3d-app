import { useEffect, type ReactNode } from "react";
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
    <div className="fixed inset-0 z-[65]" role="presentation">
      <button type="button" aria-label="Close drawer" className="absolute inset-0 bg-black/35" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "absolute top-0 h-full w-full max-w-xl overflow-y-auto border-[hsl(var(--border))] bg-white p-5 shadow-[var(--elevation-3)]",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
        )}
      >
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">{title}</h2>
          {description ? <p className="text-sm text-[hsl(var(--muted-foreground))]">{description}</p> : null}
        </header>
        <div className="mt-4">{children}</div>
      </aside>
    </div>
  );
}
