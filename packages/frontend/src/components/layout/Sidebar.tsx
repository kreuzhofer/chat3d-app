import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ArchiveRestore,
  Bell,
  BookOpen,
  ChevronRight,
  Cpu,
  DollarSign,
  FlaskConical,
  Layers,
  LayoutDashboard,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Search,
  Settings,
  Shield,
  Sliders,
  SquarePen,
  Star,
  Users,
  X,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { useSidebar } from "../../hooks/useSidebar";
import { useChatContexts } from "../../hooks/useChatContexts";
import { useAuth } from "../../hooks/useAuth";
import { SearchChatsModal } from "./SearchChatsModal";
import { SidebarChatList } from "./SidebarChatList";
import { SidebarUserMenu } from "./SidebarUserMenu";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

export function Sidebar() {
  const { t } = useTranslation("common");
  const { isOpen, isMobile, toggle, setOpen } = useSidebar();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { activeContextId } = useChatContexts();

  const [searchOpen, setSearchOpen] = useState(false);
  const [adminExpanded, setAdminExpanded] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  const isAdmin = user?.role === "admin";
  const isChatRoute =
    location.pathname === "/chat" ||
    location.pathname === "/chat/new" ||
    location.pathname.startsWith("/chat/");
  const isAdminRoute = location.pathname === "/admin" || location.pathname.startsWith("/admin/");

  // Auto-expand admin sub-menu when on admin routes
  useEffect(() => {
    if (isAdminRoute && !adminExpanded) setAdminExpanded(true);
  }, [isAdminRoute, adminExpanded]);

  // Close mobile sidebar on navigation
  useEffect(() => {
    if (isMobile && isOpen) setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const adminNavItems = useMemo<NavItem[]>(() => [
    { to: "/workbench", label: t("nav.workbench"), icon: <FlaskConical className="h-4 w-4" /> },
    { to: "/backups", label: t("nav.backups"), icon: <ArchiveRestore className="h-4 w-4" /> },
    { to: "/notifications", label: t("nav.notifications"), icon: <Bell className="h-4 w-4" /> },
  ], [t]);

  const adminSubItems = useMemo<NavItem[]>(() => [
    { to: "/admin", label: t("admin.dashboard"), icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
    { to: "/admin/users", label: t("admin.users"), icon: <Users className="h-3.5 w-3.5" /> },
    { to: "/admin/waitlist", label: t("admin.waitlist"), icon: <ListChecks className="h-3.5 w-3.5" /> },
    { to: "/admin/settings", label: t("admin.settings"), icon: <Settings className="h-3.5 w-3.5" /> },
    { to: "/admin/providers", label: t("admin.providers"), icon: <Plug className="h-3.5 w-3.5" /> },
    { to: "/admin/models", label: t("admin.models"), icon: <Cpu className="h-3.5 w-3.5" /> },
    { to: "/admin/generation", label: t("admin.generation"), icon: <Sliders className="h-3.5 w-3.5" /> },
    { to: "/admin/curation", label: t("admin.curation"), icon: <Star className="h-3.5 w-3.5" /> },
    { to: "/admin/knowledge", label: t("admin.knowledge"), icon: <BookOpen className="h-3.5 w-3.5" /> },
    { to: "/admin/costs", label: t("admin.costs"), icon: <DollarSign className="h-3.5 w-3.5" /> },
    { to: "/admin/pipeline", label: t("admin.pipeline"), icon: <Activity className="h-3.5 w-3.5" /> },
  ], [t]);

  const navLinkClass = (isActive: boolean) =>
    cn(
      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition",
      isActive
        ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] font-medium"
        : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)_/_0.5)] hover:text-[hsl(var(--foreground))]",
    );

  const sidebarContent = (
    <nav
      ref={sidebarRef}
      className="flex h-full min-w-0 flex-col bg-[hsl(var(--surface-2))]"
    >
      {/* Header — h-[42px] matches the topbar so logo stays on the same axis */}
      <div className="flex h-[42px] shrink-0 items-center px-5">
        <span className="text-lg font-semibold text-[hsl(var(--foreground))]">{t("appName")}</span>
        <button
          type="button"
          className="ml-auto rounded p-1 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          aria-label={isMobile ? t("actions.close") : t("sidebar.collapse")}
          onClick={toggle}
        >
          {isMobile ? <X className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Fixed navigation — always visible */}
      <div className="space-y-0.5 px-2">
        <button
          type="button"
          className={navLinkClass(isChatRoute && !activeContextId)}
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
          className={navLinkClass(false)}
          onClick={() => {
            if (isMobile) setOpen(false);
            setSearchOpen(true);
          }}
        >
          <Search className="h-4 w-4" />
          {t("sidebar.searchChats")}
        </button>
        <NavLink
          to="/gallery"
          className={({ isActive }) => navLinkClass(isActive)}
        >
          <Layers className="h-4 w-4" />
          {t("nav.gallery")}
        </NavLink>
      </div>

      {/* Scrollable area — admin items + chat context list */}
      <div className="mt-1 flex min-h-0 flex-1 flex-col border-t border-[hsl(var(--border)_/_0.3)]">
        <div className="flex-1 overflow-y-auto">
          {/* Admin nav items */}
          {isAdmin ? (
            <div className="space-y-0.5 px-2 pt-2">
              {adminNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              ))}

              {/* Admin collapsible sub-menu */}
              <button
                type="button"
                className={cn(
                  navLinkClass(isAdminRoute),
                  "justify-between",
                )}
                onClick={() => setAdminExpanded((prev) => !prev)}
              >
                <span className="flex items-center gap-3">
                  <Shield className="h-4 w-4" />
                  {t("nav.admin")}
                </span>
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 transition-transform duration-150",
                    adminExpanded && "rotate-90",
                  )}
                />
              </button>
              {adminExpanded ? (
                <div className="ml-3 space-y-0.5 border-l border-[hsl(var(--border)_/_0.3)] pl-2">
                  {adminSubItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/admin"}
                      className={({ isActive }) =>
                        cn(
                          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition",
                          isActive
                            ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] font-medium"
                            : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)_/_0.5)] hover:text-[hsl(var(--foreground))]",
                        )
                      }
                    >
                      {item.icon}
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Chat context list */}
          {isChatRoute ? (
            <SidebarChatList activeContextId={activeContextId} />
          ) : null}
        </div>
      </div>

      {/* User menu (pinned bottom) */}
      <SidebarUserMenu />

    </nav>
  );

  const searchModal = <SearchChatsModal open={searchOpen} onClose={() => setSearchOpen(false)} />;

  // Desktop: animated inline sidebar (always rendered, width transitions)
  if (!isMobile) {
    return (
      <>
        <aside
          className={cn(
            "flex h-screen shrink-0 overflow-hidden border-r border-[hsl(var(--border))] transition-[width] duration-200 ease-in-out",
            isOpen ? "w-[260px]" : "w-0 border-r-0",
          )}
        >
          <div className="flex h-full w-[260px] min-w-[260px] flex-col">
            {sidebarContent}
          </div>
        </aside>
        {searchModal}
      </>
    );
  }

  // Mobile: overlay (always rendered, animated via translate)
  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-50 transition-visibility",
          isOpen ? "visible" : "pointer-events-none invisible",
        )}
      >
        {/* Backdrop (behind sidebar) */}
        <button
          type="button"
          className={cn(
            "absolute inset-0 transition-opacity duration-200 ease-in-out",
            isOpen ? "bg-black/40 opacity-100" : "opacity-0",
          )}
          aria-label={t("actions.close")}
          onClick={() => setOpen(false)}
        />
        {/* Sidebar (above backdrop) */}
        <aside
          className={cn(
            "relative z-10 h-full w-[70%] max-w-[320px] shadow-xl transition-transform duration-200 ease-in-out",
            isOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          {sidebarContent}
        </aside>
      </div>
      {searchModal}
    </>
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
