import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArchiveRestore,
  Bell,
  FlaskConical,
  Layers,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Shield,
  SquarePen,
  TestTubeDiagonal,
  User,
  X,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { useSidebar } from "../../hooks/useSidebar";
import { useChatContexts } from "../../hooks/useChatContexts";
import { useAuth } from "../../hooks/useAuth";
import { Avatar } from "../ui/avatar";
import { ChatEntryMenu } from "./ChatEntryMenu";
import { SearchChatsModal } from "./SearchChatsModal";
import { LanguageSelector } from "../LanguageSelector";

const INITIAL_VISIBLE = 20;
const LOAD_MORE_INCREMENT = 20;

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

export function Sidebar() {
  const { t } = useTranslation("common");
  const { isOpen, isMobile, toggle, setOpen } = useSidebar();
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    groupedContexts,
    activeContextId,
    busyAction,
    renameContext,
    deleteContext,
  } = useChatContexts();

  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const userMenuRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  const isAdmin = user?.role === "admin";
  const isChatRoute =
    location.pathname === "/chat" ||
    location.pathname === "/chat/new" ||
    location.pathname.startsWith("/chat/");

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (!userMenuRef.current?.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setUserMenuOpen(false);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [userMenuOpen]);

  // Close mobile sidebar on navigation
  useEffect(() => {
    if (isMobile && isOpen) setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const navItems = useMemo<NavItem[]>(() => {
    const items: NavItem[] = [
      { to: "/gallery", label: t("nav.gallery"), icon: <Layers className="h-4 w-4" /> },
    ];
    if (isAdmin) {
      items.push(
        { to: "/admin", label: t("nav.admin"), icon: <Shield className="h-4 w-4" />, adminOnly: true },
        { to: "/workbench", label: t("nav.workbench"), icon: <FlaskConical className="h-4 w-4" />, adminOnly: true },
        { to: "/query", label: t("actions.queryWorkbench"), icon: <TestTubeDiagonal className="h-4 w-4" />, adminOnly: true },
        { to: "/backups", label: t("nav.backups"), icon: <ArchiveRestore className="h-4 w-4" />, adminOnly: true },
        { to: "/notifications", label: t("nav.notifications"), icon: <Bell className="h-4 w-4" />, adminOnly: true },
      );
    }
    return items;
  }, [isAdmin, t]);

  // Flatten all grouped items with a count limit
  const { flatItems, totalCount } = useMemo(() => {
    let count = 0;
    const flat: { bucket: string; items: typeof groupedContexts[0]["items"] }[] = [];
    for (const group of groupedContexts) {
      const remaining = visibleCount - count;
      if (remaining <= 0) break;
      const sliced = group.items.slice(0, remaining);
      flat.push({ bucket: group.bucket, items: sliced });
      count += sliced.length;
    }
    const total = groupedContexts.reduce((sum, g) => sum + g.items.length, 0);
    return { flatItems: flat, totalCount: total };
  }, [groupedContexts, visibleCount]);

  const startRename = useCallback(
    (context: { id: string; name: string }) => {
      setEditingId(context.id);
      setEditingValue(context.name);
    },
    [],
  );

  const commitRename = useCallback(
    (context: { id: string; name: string }) => {
      const trimmed = editingValue.trim();
      setEditingId(null);
      if (trimmed && trimmed !== context.name) {
        void renameContext(context as Parameters<typeof renameContext>[0], trimmed);
      }
    },
    [editingValue, renameContext],
  );

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditingValue("");
  }, []);

  const handleDelete = useCallback(
    (context: { id: string; name: string }) => {
      if (window.confirm(`Delete "${context.name}"?`)) {
        void deleteContext(context as Parameters<typeof deleteContext>[0]);
      }
    },
    [deleteContext],
  );

  // Map bucket keys to i18n
  const bucketI18n: Record<string, string> = {
    Today: t("sidebar.today"),
    Yesterday: t("sidebar.yesterday"),
    "Previous 7 Days": t("sidebar.previous7Days"),
    "Previous 30 Days": t("sidebar.previous30Days"),
  };

  const navLinkClass = (isActive: boolean) =>
    cn(
      "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
      isActive
        ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] font-medium"
        : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)_/_0.5)] hover:text-[hsl(var(--foreground))]",
    );

  const sidebarContent = (
    <nav
      ref={sidebarRef}
      className="flex h-full min-w-0 flex-col bg-[hsl(var(--surface-2))]"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-sm font-semibold text-[hsl(var(--foreground))]">{t("appName")}</span>
        <button
          type="button"
          className="rounded p-1 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          aria-label={isMobile ? t("actions.close") : t("sidebar.collapse")}
          onClick={toggle}
        >
          {isMobile ? <X className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Primary actions */}
      <div className="space-y-0.5 px-2">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted)_/_0.5)] hover:text-[hsl(var(--foreground))]"
          onClick={() => {
            navigate("/chat");
            if (isMobile) setOpen(false);
          }}
        >
          <SquarePen className="h-4 w-4" />
          {t("sidebar.newChat")}
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted)_/_0.5)] hover:text-[hsl(var(--foreground))]"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="h-4 w-4" />
          {t("sidebar.searchChats")}
        </button>
      </div>

      {/* App navigation */}
      <div className="mt-2 space-y-0.5 px-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => navLinkClass(isActive)}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Recent chats (only on chat routes) */}
      {isChatRoute ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-[hsl(var(--border)_/_0.3)] pt-2">
          <div className="flex-1 overflow-y-auto px-2">
            {flatItems.map((group) => (
              <div key={group.bucket}>
                <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground)_/_0.7)]">
                  {bucketI18n[group.bucket] ?? group.bucket}
                </div>
                {group.items.map((ctx) => (
                  <div
                    key={ctx.id}
                    role="button"
                    tabIndex={editingId === ctx.id ? -1 : 0}
                    className={cn(
                      "group flex min-w-0 cursor-pointer items-center justify-between gap-1 rounded-md px-3 py-1.5 text-sm transition",
                      activeContextId === ctx.id
                        ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
                        : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)_/_0.5)] hover:text-[hsl(var(--foreground))]",
                    )}
                    onClick={() => {
                      if (editingId !== ctx.id) {
                        navigate(`/chat/${encodeURIComponent(ctx.id)}`);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (editingId !== ctx.id && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        navigate(`/chat/${encodeURIComponent(ctx.id)}`);
                      }
                    }}
                  >
                    {editingId === ctx.id ? (
                      <input
                        type="text"
                        className="min-w-0 flex-1 rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-sm text-[hsl(var(--foreground))] outline-none ring-1 ring-[hsl(var(--primary)_/_0.5)]"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onBlur={() => commitRename(ctx)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            cancelRename();
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span className="truncate">{ctx.name}</span>
                    )}
                    {editingId !== ctx.id ? (
                      <ChatEntryMenu
                        onRename={() => startRename(ctx)}
                        onDelete={() => handleDelete(ctx)}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            ))}

            {visibleCount < totalCount ? (
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-xs text-[hsl(var(--primary))] transition hover:underline"
                onClick={() => setVisibleCount((prev) => prev + LOAD_MORE_INCREMENT)}
              >
                {t("sidebar.showMore")}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* User menu (pinned bottom) */}
      <div ref={userMenuRef} className="relative border-t border-[hsl(var(--border)_/_0.3)] px-2 py-2">
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 transition hover:bg-[hsl(var(--muted)_/_0.5)]"
          onClick={() => setUserMenuOpen((prev) => !prev)}
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

        {/* User menu popover (opens upward) */}
        {userMenuOpen ? (
          <div
            role="menu"
            className="absolute bottom-full left-2 right-2 z-50 mb-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-1 shadow-[var(--elevation-2)]"
          >
            {/* Profile header */}
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

            {/* Profile link */}
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
              onClick={() => {
                setUserMenuOpen(false);
                navigate("/profile");
              }}
            >
              <User className="h-4 w-4" />
              {t("nav.profile")}
            </button>

            {/* Language selector (inline) */}
            <div className="px-2.5 py-1">
              <LanguageSelector />
            </div>

            <div className="my-1 h-px bg-[hsl(var(--border)_/_0.5)]" />

            {/* Logout */}
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)_/_0.1)]"
              onClick={() => {
                setUserMenuOpen(false);
                void logout();
              }}
            >
              <LogOut className="h-4 w-4" />
              {t("actions.logout")}
            </button>
          </div>
        ) : null}
      </div>

      <SearchChatsModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </nav>
  );

  if (!isOpen) return null;

  // Desktop: inline sidebar
  if (!isMobile) {
    return (
      <aside className="flex h-screen w-[260px] shrink-0 overflow-hidden border-r border-[hsl(var(--border))]">
        {sidebarContent}
      </aside>
    );
  }

  // Mobile: overlay
  return (
    <div className="fixed inset-0 z-50 flex">
      <aside className="h-full w-[70%] max-w-[320px] shadow-xl">
        {sidebarContent}
      </aside>
      <button
        type="button"
        className="flex-1 bg-black/40 animate-fade-in"
        aria-label={t("actions.close")}
        onClick={() => setOpen(false)}
      />
    </div>
  );
}

/** Toggle button shown in topbar when sidebar is collapsed */
export function SidebarToggle() {
  const { t } = useTranslation("common");
  const { isOpen, toggle } = useSidebar();

  if (isOpen) return null;

  return (
    <button
      type="button"
      className="rounded p-1.5 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
      aria-label={t("sidebar.expand")}
      onClick={toggle}
    >
      <PanelLeftOpen className="h-4 w-4" />
    </button>
  );
}
