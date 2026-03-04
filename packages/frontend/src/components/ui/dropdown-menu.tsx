import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

export interface DropdownActionItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  type?: "item";
}

export interface DropdownSeparator {
  id: string;
  type: "separator";
}

export type DropdownItem = DropdownActionItem | DropdownSeparator;

interface DropdownMenuProps {
  triggerLabel: string;
  items: DropdownItem[];
  className?: string;
  /** When true, render a circular avatar button with the first character of triggerLabel */
  avatar?: boolean;
}

export function DropdownMenu({ triggerLabel, items, className, avatar }: DropdownMenuProps) {
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
        className={
          avatar
            ? "inline-flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-sm font-semibold text-[hsl(var(--primary-foreground))] transition hover:opacity-80"
            : "inline-flex h-9 items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-3 text-sm font-medium text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
        }
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={triggerLabel}
        onClick={() => setOpen((current) => !current)}
      >
        {avatar ? triggerLabel.charAt(0).toUpperCase() : triggerLabel}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 min-w-[180px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-1 shadow-[var(--elevation-2)]"
        >
          {items.map((item) =>
            item.type === "separator" ? (
              <div
                key={item.id}
                role="separator"
                className="my-1 h-px bg-[hsl(var(--border))]"
              />
            ) : (
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
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
