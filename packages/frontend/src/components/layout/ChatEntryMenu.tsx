import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

interface ChatEntryMenuProps {
  onRename: () => void;
  onDelete: () => void;
}

export function ChatEntryMenu({ onRename, onDelete }: ChatEntryMenuProps) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="rounded p-0.5 text-[hsl(var(--muted-foreground))] opacity-100 transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] md:opacity-0 md:group-hover:opacity-100"
        aria-label="Chat actions"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 min-w-[140px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-1 shadow-[var(--elevation-2)]"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRename();
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            {t("actions.rename")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)_/_0.1)]"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("actions.delete")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
