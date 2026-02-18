import { FormEvent, useMemo, useState } from "react";
import { AdminPanel } from "./components/AdminPanel";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { ProfilePanel } from "./components/ProfilePanel";
import { QueryWorkbench } from "./components/QueryWorkbench";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { useNotifications } from "./contexts/NotificationsContext";
import { useAuth } from "./hooks/useAuth";

type ViewKey = "chat" | "query" | "profile" | "admin";

interface AuthFormState {
  email: string;
  password: string;
  displayName: string;
}

const initialAuthFormState: AuthFormState = {
  email: "",
  password: "",
  displayName: "",
};

export function App() {
  const { user, isAuthenticated, isLoading, login, register, logout } = useAuth();
  const { unreadCount, connectionState, refreshReplay, markAllRead } = useNotifications();

  const [loginForm, setLoginForm] = useState<AuthFormState>(initialAuthFormState);
  const [registerForm, setRegisterForm] = useState<AuthFormState>(initialAuthFormState);
  const [activeView, setActiveView] = useState<ViewKey>("chat");
  const [busyAction, setBusyAction] = useState<"login" | "register" | null>(null);
  const [authError, setAuthError] = useState("");

  const availableViews = useMemo(() => {
    if (user?.role === "admin") {
      return (["chat", "query", "profile", "admin"] as const).map((key) => ({
        key,
        label: key === "query" ? "Query" : key === "profile" ? "Profile" : key === "admin" ? "Admin" : "Chat",
      }));
    }
    return (["chat", "query", "profile"] as const).map((key) => ({
      key,
      label: key === "query" ? "Query" : key === "profile" ? "Profile" : "Chat",
    }));
  }, [user?.role]);

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
      await register(registerForm.email, registerForm.password, registerForm.displayName || undefined);
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
    return (
      <main className="min-h-screen bg-[hsl(var(--background))] p-6 text-[hsl(var(--foreground))]">
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
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
                <Button disabled={busyAction !== null} type="submit">
                  Create account
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
        {authError ? <p className="mx-auto mt-4 max-w-5xl text-sm text-[hsl(var(--destructive))]">{authError}</p> : null}
      </main>
    );
  }

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
              {availableViews.map((view) => (
                <Button
                  key={view.key}
                  variant={activeView === view.key ? "secondary" : "outline"}
                  onClick={() => setActiveView(view.key)}
                >
                  {view.label}
                </Button>
              ))}
              <Button variant="outline" onClick={() => void refreshReplay()}>
                Refresh Replay
              </Button>
              <Button variant="outline" onClick={() => markAllRead()}>
                Mark All Read
              </Button>
              <Button variant="destructive" onClick={() => logout()}>
                Logout
              </Button>
            </div>
          </CardContent>
        </Card>

        {activeView === "chat" ? <ChatWorkspace /> : null}
        {activeView === "query" ? <QueryWorkbench /> : null}
        {activeView === "profile" ? <ProfilePanel /> : null}
        {activeView === "admin" && user?.role === "admin" ? <AdminPanel /> : null}
      </div>
    </main>
  );
}
