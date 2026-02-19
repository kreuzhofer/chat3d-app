import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useAuth } from "../../hooks/useAuth";

interface LoginPageProps {
  waitlistEnabled: boolean;
}

export function LoginPage({ waitlistEnabled }: LoginPageProps) {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      navigate("/chat", { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Login</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
            <div className="space-y-1">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            {error ? (
              <p className="rounded-md border border-[hsl(var(--destructive))] p-2 text-sm text-[hsl(var(--destructive))]">
                {error}
              </p>
            ) : null}
            <Button disabled={busy} type="submit">
              Sign in
            </Button>
          </form>

          <p className="mt-4 text-sm text-slate-600">
            {waitlistEnabled ? (
              <>
                Registration is currently gated. <Link className="underline" to="/waitlist">Join the waitlist</Link>.
              </>
            ) : (
              <>
                No account yet? <Link className="underline" to="/register">Create one now</Link>.
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
