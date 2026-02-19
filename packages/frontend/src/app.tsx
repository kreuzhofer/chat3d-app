import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { getPublicConfig } from "./api/public.api";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
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

function RouteLoadingFallback() {
  return <p className="p-6 text-sm text-[hsl(var(--muted-foreground))]">Loading view...</p>;
}

function navigationItems(isAdmin: boolean) {
  return [
    { path: "/chat", label: "Chat" },
    { path: "/query", label: "Query" },
    { path: "/profile", label: "Profile" },
    { path: "/notifications", label: "Notifications" },
    ...(isAdmin ? [{ path: "/admin", label: "Admin" }] : []),
  ];
}

function AuthenticatedApp() {
  const { user, logout } = useAuth();
  const { unreadCount, connectionState, refreshReplay, markAllRead } = useNotifications();

  const navItems = navigationItems(user?.role === "admin");

  return (
    <main className="min-h-screen bg-[hsl(var(--background))] p-4 text-[hsl(var(--foreground))]">
      <div className="mx-auto max-w-7xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Chat3D Control Surface</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{user?.email}</span>
              <span className="rounded border px-2 py-1">{user?.role}</span>
              <span className="rounded border px-2 py-1">{user?.status}</span>
              <span className="rounded border px-2 py-1">SSE: {connectionState}</span>
              <span className="rounded border px-2 py-1">Unread: {unreadCount}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {navItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `inline-flex h-9 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition ${
                      isActive
                        ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
                        : "border border-[hsl(var(--border))] bg-white text-[hsl(var(--foreground))]"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <Button variant="outline" onClick={() => void refreshReplay()}>
                Refresh Replay
              </Button>
              <Button variant="outline" onClick={() => markAllRead()}>
                Mark All Read
              </Button>
              <Button variant="destructive" onClick={() => void logout()}>
                Logout
              </Button>
            </div>
          </CardContent>
        </Card>

        <Suspense fallback={<RouteLoadingFallback />}>
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
      </div>
    </main>
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
    return <main className="p-6 text-sm text-[hsl(var(--muted-foreground))]">Loading...</main>;
  }

  return isAuthenticated ? <AuthenticatedApp /> : <PublicApp />;
}
