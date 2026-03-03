import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArchiveRestore,
  Bell,
  FlaskConical,
  Layers,
  MessageSquare,
  Shield,
  User,
  type LucideIcon,
} from "lucide-react";
import { getPublicConfig } from "./api/public.api";
import { remixModel } from "./api/gallery.api";
import { AppShell } from "./components/layout/AppShell";
import { LoadingView } from "./components/layout/StateViews";
import { Button } from "./components/ui/button";
import { Drawer } from "./components/ui/drawer";
import { DropdownMenu, type DropdownItem } from "./components/ui/dropdown-menu";
import { LanguageSelector } from "./components/LanguageSelector";
import { useNotifications } from "./contexts/NotificationsContext";
import { useAuth } from "./hooks/useAuth";
import { AdminRouteGuard } from "./components/AdminRouteGuard";
import { CookieBanner } from "./components/CookieBanner";
import { DataDeletionPage } from "./pages/public/DataDeletionPage";
import { HomePage } from "./pages/public/HomePage";
import { ImprintPage } from "./pages/public/ImprintPage";
import { LegalPage } from "./pages/public/LegalPage";
import { ConfirmEmailPage } from "./pages/public/ConfirmEmailPage";
import { ForgotPasswordPage } from "./pages/public/ForgotPasswordPage";
import { LoginPage } from "./pages/public/LoginPage";
import { PricingPage } from "./pages/public/PricingPage";
import { PrivacyPage } from "./pages/public/PrivacyPage";
import { PublicShell } from "./pages/public/PublicShell";
import { RegisterPage } from "./pages/public/RegisterPage";
import { ResetPasswordPage } from "./pages/public/ResetPasswordPage";
import { SetupPage } from "./pages/public/SetupPage";
import { TermsPage } from "./pages/public/TermsPage";
import { WaitlistPage } from "./pages/public/WaitlistPage";

const AdminPanel = lazy(async () => {
  const module = await import("./components/AdminPanel");
  return { default: module.AdminPanel };
});
const BackupsPage = lazy(async () => {
  const module = await import("./components/BackupsPage");
  return { default: module.BackupsPage };
});
const ChatPage = lazy(async () => {
  const module = await import("./components/ChatPage");
  return { default: module.ChatPage };
});
const NotificationCenter = lazy(async () => {
  const module = await import("./components/NotificationCenter");
  return { default: module.NotificationCenter };
});
const ProfilePanel = lazy(async () => {
  const module = await import("./components/ProfilePanel");
  return { default: module.ProfilePanel };
});
const QueryWorkbench = lazy(async () => {
  const module = await import("./components/QueryWorkbench");
  return { default: module.QueryWorkbench };
});
const WorkbenchPage = lazy(async () => {
  const module = await import("./components/WorkbenchPage");
  return { default: module.WorkbenchPage };
});
const WorkbenchCategoryPage = lazy(async () => {
  const module = await import("./components/WorkbenchCategoryPage");
  return { default: module.WorkbenchCategoryPage };
});
const WorkbenchPromptPage = lazy(async () => {
  const module = await import("./components/WorkbenchPromptPage");
  return { default: module.WorkbenchPromptPage };
});
const GalleryPage = lazy(async () => {
  const module = await import("./pages/public/GalleryPage");
  return { default: module.GalleryPage };
});

interface NavItem {
  path: string;
  labelKey: string;
  routePrefix: string;
  icon?: LucideIcon;
}

interface NavGroup {
  id: string;
  labelKey: string;
  items: NavItem[];
}

function authenticatedNavGroups(isAdmin: boolean): NavGroup[] {
  return [
    {
      id: "workspace",
      labelKey: "common:groups.workspace",
      items: [
        { path: "/chat", labelKey: "common:nav.chat", routePrefix: "/chat", icon: MessageSquare },
        { path: "/gallery", labelKey: "common:nav.gallery", routePrefix: "/gallery", icon: Layers },
      ],
    },
    {
      id: "account",
      labelKey: "common:groups.account",
      items: [{ path: "/profile", labelKey: "common:nav.profile", routePrefix: "/profile", icon: User }],
    },
    ...(isAdmin
      ? [
          {
            id: "admin",
            labelKey: "common:groups.administration",
            items: [
              { path: "/admin", labelKey: "common:nav.admin", routePrefix: "/admin", icon: Shield },
              { path: "/workbench", labelKey: "common:nav.workbench", routePrefix: "/workbench", icon: FlaskConical },
              { path: "/backups", labelKey: "common:nav.backups", routePrefix: "/backups", icon: ArchiveRestore },
            ],
          },
        ]
      : []),
  ];
}

function resolveActiveItem(pathname: string, groups: NavGroup[]): NavItem | null {
  const flat = groups.flatMap((group) => group.items).sort((a, b) => b.routePrefix.length - a.routePrefix.length);
  return flat.find((item) => pathname.startsWith(item.routePrefix)) ?? null;
}

function NavigationList({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const { t } = useTranslation("common");

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">Chat3D</p>
        <p className="mt-1 text-sm text-[hsl(var(--foreground))]">{t("common:shell.applicationShell")}</p>
      </div>

      {groups.map((group) => {
        const groupLabel = t(group.labelKey);
        return (
          <section key={group.id} className="space-y-1.5">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
              {groupLabel}
            </h3>
            <ul className="space-y-1" aria-label={`${groupLabel} navigation`}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition ${
                          isActive
                            ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                            : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                        }`
                      }
                    >
                      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
                      {t(item.labelKey)}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Catch-all route for authenticated users. If the URL has a `remixId` query param
 * (from a gallery remix redirect through login), execute the remix and navigate to the chat.
 * Otherwise, redirect to /chat.
 */
function AuthCatchAllRedirect() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const { t } = useTranslation("common");

  const remixId = searchParams.get("remixId");

  useEffect(() => {
    if (done) return;

    if (!remixId || !token) {
      navigate("/chat", { replace: true });
      setDone(true);
      return;
    }

    if (processing) return;
    setProcessing(true);

    remixModel(token, remixId)
      .then(({ contextId }) => {
        navigate(`/chat/${contextId}`, { replace: true });
      })
      .catch(() => {
        navigate("/chat", { replace: true });
      })
      .finally(() => setDone(true));
  }, [remixId, token, navigate, processing, done]);

  return <LoadingView label={t("common:labels.loading")} />;
}

function AuthenticatedApp() {
  const { t } = useTranslation("common");
  const { user, logout } = useAuth();
  const { unreadCount, connectionState, refreshReplay, markAllRead } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isAdmin = user?.role === "admin";

  const groups = useMemo(() => authenticatedNavGroups(isAdmin), [isAdmin]);
  const activeNavItem = useMemo(() => resolveActiveItem(location.pathname, groups), [groups, location.pathname]);

  // Chat routes render without the AppShell sidebar so ChatPage occupies full viewport width
  const isChatRoute = location.pathname === "/chat" || location.pathname === "/chat/new" || location.pathname.startsWith("/chat/");

  const dropdownItems = useMemo<DropdownItem[]>(() => {
    const navItems: DropdownItem[] = [
      {
        id: "open-profile",
        label: t("common:actions.openProfile"),
        onSelect: () => navigate("/profile"),
      },
    ];
    if (isAdmin) {
      navItems.push(
        {
          id: "admin",
          label: t("common:nav.admin"),
          onSelect: () => navigate("/admin"),
        },
        {
          id: "query-workbench",
          label: t("common:actions.queryWorkbench"),
          onSelect: () => navigate("/query"),
        },
        {
          id: "workbench",
          label: t("common:actions.llmWorkbench"),
          onSelect: () => navigate("/workbench"),
        },
      );
    }
    return [
      ...navItems,
      { id: "sep-nav-session", type: "separator" as const },
      {
        id: "refresh-replay",
        label: t("common:actions.refreshEventReplay"),
        onSelect: () => void refreshReplay(),
      },
      {
        id: "mark-all-read",
        label: t("common:actions.markAllRead"),
        onSelect: () => markAllRead(),
      },
      {
        id: "logout",
        label: t("common:actions.logout"),
        onSelect: () => {
          void logout();
        },
        danger: true,
      },
    ];
  }, [isAdmin, navigate, refreshReplay, markAllRead, logout, t]);

  const topBar = (
    <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button className="lg:hidden" size="sm" variant="outline" onClick={() => setMobileNavOpen(true)}>
          {t("common:actions.menu")}
        </Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[hsl(var(--foreground))]">
            {activeNavItem ? t(activeNavItem.labelKey) : t("common:groups.workspace")}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isAdmin && connectionState !== "open" ? (
          <span className="h-2 w-2 rounded-full bg-[hsl(var(--warning))]" title="SSE disconnected" />
        ) : null}
        {isAdmin ? (
          <button
            type="button"
            className="relative rounded-md p-2 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            onClick={() => navigate("/notifications")}
            aria-label={`${t("common:nav.notifications")}${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--destructive))] px-1 text-[10px] font-bold text-[hsl(var(--destructive-foreground))]">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </button>
        ) : null}
        <LanguageSelector />
        <DropdownMenu
          triggerLabel={user?.email ?? t("common:groups.account")}
          items={dropdownItems}
        />
      </div>
    </div>
  );

  return (
    <>
      <AppShell topbar={topBar} sidebar={isChatRoute ? undefined : <NavigationList groups={groups} />}>
        <Suspense fallback={<LoadingView label={t("common:labels.loadingRoute")} />}>
          <Routes>
            <Route path="/" element={<Navigate replace to="/chat" />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/new" element={<ChatPage />} />
            <Route path="/chat/:contextId" element={<ChatPage />} />
            <Route path="/query" element={<AdminRouteGuard><QueryWorkbench /></AdminRouteGuard>} />
            <Route path="/profile" element={<ProfilePanel />} />
            <Route path="/notifications" element={<AdminRouteGuard><NotificationCenter /></AdminRouteGuard>} />
            <Route
              path="/admin"
              element={<AdminRouteGuard><AdminPanel /></AdminRouteGuard>}
            />
            <Route path="/workbench" element={<AdminRouteGuard><WorkbenchPage /></AdminRouteGuard>} />
            <Route path="/workbench/:categoryId" element={<AdminRouteGuard><WorkbenchCategoryPage /></AdminRouteGuard>} />
            <Route path="/workbench/:categoryId/:promptId" element={<AdminRouteGuard><WorkbenchPromptPage /></AdminRouteGuard>} />
            <Route path="/backups" element={<AdminRouteGuard><BackupsPage /></AdminRouteGuard>} />
            <Route path="/gallery" element={<GalleryPage />} />
            <Route path="/gallery/category/:categoryId" element={<GalleryPage />} />
            <Route path="*" element={<AuthCatchAllRedirect />} />
          </Routes>
        </Suspense>
      </AppShell>

      <Drawer
        open={mobileNavOpen}
        title={t("common:drawer.navigationTitle")}
        description={t("common:drawer.navigationDescription")}
        side="left"
        onClose={() => setMobileNavOpen(false)}
      >
        <NavigationList groups={groups} onNavigate={() => setMobileNavOpen(false)} />
      </Drawer>
    </>
  );
}

function PublicApp() {
  const { t } = useTranslation("common");
  const [setupRequired, setSetupRequired] = useState(false);
  const [waitlistEnabled, setWaitlistEnabled] = useState(false);
  const [configState, setConfigState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let mounted = true;

    async function loadConfig() {
      setConfigState("loading");
      try {
        const config = await getPublicConfig();
        if (!mounted) {
          return;
        }
        setSetupRequired(config.setupRequired);
        setWaitlistEnabled(config.waitlistEnabled);
        setConfigState("ready");
      } catch {
        if (!mounted) {
          return;
        }
        setSetupRequired(false);
        setWaitlistEnabled(false);
        setConfigState("error");
      }
    }

    void loadConfig();

    return () => {
      mounted = false;
    };
  }, []);

  const resolvedWaitlistEnabled = useMemo(
    () => (configState === "error" ? false : waitlistEnabled),
    [waitlistEnabled, configState],
  );

  if (configState === "loading") {
    return <LoadingView label={t("common:labels.loading")} />;
  }

  if (setupRequired) {
    return <SetupPage />;
  }

  return (
    <PublicShell waitlistEnabled={resolvedWaitlistEnabled} waitlistState={configState}>
      <Routes>
        <Route path="/" element={<HomePage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/pricing" element={<PricingPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/gallery" element={<GalleryPage />} />
        <Route path="/gallery/category/:categoryId" element={<GalleryPage />} />
        <Route path="/login" element={<LoginPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/register" element={<RegisterPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/forgot-password/reset" element={<ResetPasswordPage />} />
        <Route path="/confirm-email" element={<ConfirmEmailPage />} />
        <Route path="/waitlist" element={<WaitlistPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/waitlist/confirm" element={<WaitlistPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/legal" element={<LegalPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/imprint" element={<ImprintPage />} />
        <Route path="/data-deletion" element={<DataDeletionPage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </PublicShell>
  );
}

export function App() {
  const { t } = useTranslation("common");
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingView label={t("common:labels.loadingSession")} />;
  }

  return (
    <>
      {isAuthenticated ? <AuthenticatedApp /> : <PublicApp />}
      <CookieBanner />
    </>
  );
}
