import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { getPublicConfig } from "./api/public.api";
import { AppShell } from "./components/layout/AppShell";
import { CommandBarTrigger } from "./components/layout/CommandBarTrigger";
import { LoadingView } from "./components/layout/StateViews";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Drawer } from "./components/ui/drawer";
import { DropdownMenu } from "./components/ui/dropdown-menu";
import { useNotifications } from "./contexts/NotificationsContext";
import { useAuth } from "./hooks/useAuth";
import { HomePage } from "./pages/public/HomePage";
import { ImprintPage } from "./pages/public/ImprintPage";
import { LegalPage } from "./pages/public/LegalPage";
import { LoginPage } from "./pages/public/LoginPage";
import { PricingPage } from "./pages/public/PricingPage";
import { PublicShell } from "./pages/public/PublicShell";
import { RegisterPage } from "./pages/public/RegisterPage";
import { WaitlistPage } from "./pages/public/WaitlistPage";

const AdminPanel = lazy(async () => {
  const module = await import("./components/AdminPanel");
  return { default: module.AdminPanel };
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

interface NavItem {
  path: string;
  label: string;
  routePrefix: string;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

function authenticatedNavGroups(isAdmin: boolean): NavGroup[] {
  return [
    {
      id: "workspace",
      label: "Workspace",
      items: [
        { path: "/chat", label: "Chat", routePrefix: "/chat" },
        { path: "/query", label: "Query", routePrefix: "/query" },
        { path: "/notifications", label: "Notifications", routePrefix: "/notifications" },
      ],
    },
    {
      id: "account",
      label: "Account",
      items: [{ path: "/profile", label: "Profile", routePrefix: "/profile" }],
    },
    ...(isAdmin
      ? [
          {
            id: "admin",
            label: "Administration",
            items: [{ path: "/admin", label: "Admin", routePrefix: "/admin" }],
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
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">Chat3D</p>
        <p className="mt-1 text-sm text-[hsl(var(--foreground))]">Application shell</p>
      </div>

      {groups.map((group) => (
        <section key={group.id} className="space-y-1.5">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            {group.label}
          </h3>
          <ul className="space-y-1" aria-label={`${group.label} navigation`}>
            {group.items.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `flex items-center rounded-md px-3 py-2 text-sm transition ${
                      isActive
                        ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                        : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AuthenticatedApp() {
  const { user, logout } = useAuth();
  const { unreadCount, connectionState, refreshReplay, markAllRead } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const groups = useMemo(() => authenticatedNavGroups(user?.role === "admin"), [user?.role]);
  const activeNavItem = useMemo(() => resolveActiveItem(location.pathname, groups), [groups, location.pathname]);

  const pageActions = useMemo(() => {
    if (location.pathname.startsWith("/notifications")) {
      return (
        <Button size="sm" variant="outline" onClick={() => markAllRead()}>
          Mark All Read
        </Button>
      );
    }

    if (location.pathname.startsWith("/chat") || location.pathname.startsWith("/query")) {
      return (
        <Button size="sm" variant="outline" onClick={() => void refreshReplay()}>
          Refresh Events
        </Button>
      );
    }

    if (location.pathname.startsWith("/admin")) {
      return (
        <Button size="sm" variant="outline" onClick={() => navigate("/admin")}> 
          Admin Dashboard
        </Button>
      );
    }

    return null;
  }, [location.pathname, markAllRead, navigate, refreshReplay]);

  const topBar = (
    <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button className="lg:hidden" size="sm" variant="outline" onClick={() => setMobileNavOpen(true)}>
          Menu
        </Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[hsl(var(--foreground))]">
            {activeNavItem?.label ?? "Workspace"}
          </p>
          <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">
            App / {activeNavItem?.label ?? "Home"}
          </p>
        </div>
      </div>

      <div className="hidden min-w-[280px] flex-1 justify-center xl:flex">
        <CommandBarTrigger onClick={() => navigate("/chat")} />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Badge tone={connectionState === "open" ? "success" : "warning"}>SSE {connectionState}</Badge>
        <Badge tone={unreadCount > 0 ? "info" : "neutral"}>{unreadCount} unread</Badge>
        {pageActions}
        <DropdownMenu
          triggerLabel={user?.email ?? "Account"}
          items={[
            {
              id: "open-profile",
              label: "Open Profile",
              onSelect: () => navigate("/profile"),
            },
            {
              id: "refresh-replay",
              label: "Refresh Event Replay",
              onSelect: () => void refreshReplay(),
            },
            {
              id: "logout",
              label: "Logout",
              onSelect: () => {
                void logout();
              },
              danger: true,
            },
          ]}
        />
      </div>
    </div>
  );

  return (
    <>
      <AppShell topbar={topBar} sidebar={<NavigationList groups={groups} />}>
        <Suspense fallback={<LoadingView label="Loading route..." />}>
          <Routes>
            <Route path="/" element={<Navigate replace to="/chat" />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/new" element={<ChatPage />} />
            <Route path="/chat/:contextId" element={<ChatPage />} />
            <Route path="/query" element={<QueryWorkbench />} />
            <Route path="/profile" element={<ProfilePanel />} />
            <Route path="/notifications" element={<NotificationCenter />} />
            <Route
              path="/admin"
              element={user?.role === "admin" ? <AdminPanel /> : <Navigate replace to="/chat" />}
            />
            <Route path="*" element={<Navigate replace to="/chat" />} />
          </Routes>
        </Suspense>
      </AppShell>

      <Drawer
        open={mobileNavOpen}
        title="Navigation"
        description="Switch primary workflow areas"
        side="left"
        onClose={() => setMobileNavOpen(false)}
      >
        <NavigationList groups={groups} onNavigate={() => setMobileNavOpen(false)} />
      </Drawer>
    </>
  );
}

function PublicApp() {
  const [waitlistEnabled, setWaitlistEnabled] = useState(false);
  const [waitlistState, setWaitlistState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let mounted = true;

    async function loadConfig() {
      setWaitlistState("loading");
      try {
        const config = await getPublicConfig();
        if (!mounted) {
          return;
        }
        setWaitlistEnabled(config.waitlistEnabled);
        setWaitlistState("ready");
      } catch {
        if (!mounted) {
          return;
        }
        setWaitlistEnabled(false);
        setWaitlistState("error");
      }
    }

    void loadConfig();

    return () => {
      mounted = false;
    };
  }, []);

  const resolvedWaitlistEnabled = useMemo(
    () => (waitlistState === "error" ? false : waitlistEnabled),
    [waitlistEnabled, waitlistState],
  );

  return (
    <PublicShell waitlistEnabled={resolvedWaitlistEnabled} waitlistState={waitlistState}>
      <Routes>
        <Route path="/" element={<HomePage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/pricing" element={<PricingPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/login" element={<LoginPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/register" element={<RegisterPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/waitlist" element={<WaitlistPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/waitlist/confirm" element={<WaitlistPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/legal" element={<LegalPage />} />
        <Route path="/imprint" element={<ImprintPage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </PublicShell>
  );
}

export function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingView label="Loading session..." />;
  }

  return isAuthenticated ? <AuthenticatedApp /> : <PublicApp />;
}
