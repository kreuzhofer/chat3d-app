import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LogOut, User } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { Avatar } from "../ui/avatar";
import { LanguageSelector } from "../LanguageSelector";

export function SidebarUserMenu() {
  const { t } = useTranslation("common");
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === "admin";

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
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
    <div ref={ref} className="relative border-t border-[hsl(var(--border)_/_0.3)] px-2 py-2">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 transition hover:bg-[hsl(var(--muted)_/_0.5)]"
        onClick={() => setOpen((prev) => !prev)}
        disabled={!user}
      >
        <Avatar name={user?.display_name || user?.email || "?"} size="sm" />
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium text-[hsl(var(--foreground))]">
            {user?.display_name || user?.email || ""}
          </div>
          {isAdmin ? (
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground)_/_0.7)]">
              admin
            </div>
          ) : null}
        </div>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-2 right-2 z-50 mb-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-1 shadow-[var(--elevation-2)]"
        >
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar name={user?.display_name || user?.email || "?"} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[hsl(var(--foreground))]">
                {user?.display_name || ""}
              </div>
              <div className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                {user?.email || ""}
              </div>
            </div>
          </div>

          <div className="my-1 h-px bg-[hsl(var(--border)_/_0.5)]" />

          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
            onClick={() => {
              setOpen(false);
              navigate("/profile");
            }}
          >
            <User className="h-4 w-4" />
            {t("nav.profile")}
          </button>

          <LanguageSelector />

          <div className="my-1 h-px bg-[hsl(var(--border)_/_0.5)]" />

          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)_/_0.1)]"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            <LogOut className="h-4 w-4" />
            {t("actions.logout")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
