import { FormEvent, Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { useNotifications } from "./contexts/NotificationsContext";
import { useAuth } from "./hooks/useAuth";

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
const WaitlistPanel = lazy(async () => {
  const module = await import("./components/WaitlistPanel");
  return { default: module.WaitlistPanel };
});

function RouteLoadingFallback() {
  return <p className="p-4 text-sm text-[hsl(var(--muted-foreground))]">Loading view...</p>;
}

interface AuthFormState {
  email: string;
  password: string;
  displayName: string;
  registrationToken: string;
}

const initialAuthFormState: AuthFormState = {
  email: "",
  password: "",
  displayName: "",
  registrationToken: "",
};

function navigationItems(isAdmin: boolean) {
  return [
    { path: "/chat", label: "Chat" },
    { path: "/query", label: "Query" },
    { path: "/profile", label: "Profile" },
    { path: "/notifications", label: "Notifications" },
    ...(isAdmin ? [{ path: "/admin", label: "Admin" }] : []),
  ];
}

export function App() {
  const { user, isAuthenticated, isLoading, login, register, logout } = useAuth();
  const { unreadCount, connectionState, refreshReplay, markAllRead } = useNotifications();
  const location = useLocation();

  const [loginForm, setLoginForm] = useState<AuthFormState>(initialAuthFormState);
  const [registerForm, setRegisterForm] = useState<AuthFormState>(initialAuthFormState);
  const [busyAction, setBusyAction] = useState<"login" | "register" | null>(null);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const registerToken = new URLSearchParams(window.location.search).get("token");
    if (window.location.pathname.startsWith("/register") && registerToken) {
      setRegisterForm((state) => ({
        ...state,
        registrationToken: registerToken,
      }));
    }
  }, []);

  async function onLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("login");
    setAuthError("");
    try {
      await login(loginForm.email, loginForm.password);
      setLoginForm(initialAuthFormState);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function onRegisterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("register");
    setAuthError("");
    try {
      await register(
        registerForm.email,
        registerForm.password,
        registerForm.displayName || undefined,
        registerForm.registrationToken || undefined,
      );
      setRegisterForm(initialAuthFormState);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  if (isLoading) {
    return <main className="p-6 text-sm text-[hsl(var(--muted-foreground))]">Loading...</main>;
  }

  if (!isAuthenticated) {
    const waitlistOnly = location.pathname.startsWith("/waitlist");

    return (
      <main className="min-h-screen bg-[hsl(var(--background))] p-6 text-[hsl(var(--foreground))]">
        <div className={`mx-auto grid max-w-6xl gap-4 ${waitlistOnly ? "md:grid-cols-1" : "md:grid-cols-3"}`}>
          {!waitlistOnly ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Sign in</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={(event) => void onLoginSubmit(event)}>
                    <div className="space-y-1">
                      <Label htmlFor="login-email">Email</Label>
                      <Input
                        id="login-email"
                        type="email"
                        value={loginForm.email}
                        onChange={(event) => setLoginForm((state) => ({ ...state, email: event.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="login-password">Password</Label>
                      <Input
                        id="login-password"
                        type="password"
                        value={loginForm.password}
                        onChange={(event) => setLoginForm((state) => ({ ...state, password: event.target.value }))}
                        required
                      />
                    </div>
                    <Button disabled={busyAction !== null} type="submit">
                      Sign in
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Register</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={(event) => void onRegisterSubmit(event)}>
                    <div className="space-y-1">
                      <Label htmlFor="register-name">Display name</Label>
                      <Input
                        id="register-name"
                        value={registerForm.displayName}
                        onChange={(event) => setRegisterForm((state) => ({ ...state, displayName: event.target.value }))}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="register-email">Email</Label>
                      <Input
                        id="register-email"
                        type="email"
                        value={registerForm.email}
                        onChange={(event) => setRegisterForm((state) => ({ ...state, email: event.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="register-password">Password</Label>
                      <Input
                        id="register-password"
                        type="password"
                        value={registerForm.password}
                        onChange={(event) => setRegisterForm((state) => ({ ...state, password: event.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="register-token">Registration token</Label>
                      <Input
                        id="register-token"
                        value={registerForm.registrationToken}
                        onChange={(event) =>
                          setRegisterForm((state) => ({ ...state, registrationToken: event.target.value }))
                        }
                        placeholder="Required when waitlist is enabled"
                      />
                    </div>
                    <Button disabled={busyAction !== null} type="submit">
                      Create account
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </>
          ) : null}

          <Suspense fallback={<RouteLoadingFallback />}>
            <WaitlistPanel compact={!waitlistOnly} />
          </Suspense>
        </div>
        {authError ? (
          <p className="mx-auto mt-4 max-w-5xl text-sm text-[hsl(var(--destructive))]">{authError}</p>
        ) : null}
      </main>
    );
  }

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
            <Route path="/register" element={<Navigate replace to="/" />} />
            <Route path="/waitlist" element={<WaitlistPanel />} />
            <Route path="/waitlist/confirm" element={<WaitlistPanel />} />
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
