import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

export interface DropdownItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface DropdownMenuProps {
  triggerLabel: string;
  items: DropdownItem[];
  className?: string;
}

export function DropdownMenu({ triggerLabel, items, className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        className="inline-flex h-9 items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-3 text-sm font-medium text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        {triggerLabel}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 min-w-[180px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-1 shadow-[var(--elevation-2)]"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={cn(
                "block w-full rounded-md px-3 py-2 text-left text-sm transition hover:bg-[hsl(var(--muted))]",
                item.danger ? "text-[hsl(var(--destructive))]" : "text-[hsl(var(--foreground))]",
              )}
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
