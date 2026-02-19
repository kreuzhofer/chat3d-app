import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { FormField } from "../../components/ui/form";
import { Input } from "../../components/ui/input";
import { useAuth } from "../../hooks/useAuth";

interface RegisterPageProps {
  waitlistEnabled: boolean;
}

export function RegisterPage({ waitlistEnabled }: RegisterPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { register } = useAuth();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registrationToken, setRegistrationToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(location.search).get("token");
    if (token) {
      setRegistrationToken(token);
    }
  }, [location.search]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await register(email, password, displayName || undefined, registrationToken || undefined);
      navigate("/chat", { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      {waitlistEnabled ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Waitlist mode is active. Registration requires a valid activation token sent by email after approval.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Register</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
            <FormField label="Display name" htmlFor="register-name" helperText="Optional.">
              <Input
                id="register-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Optional"
              />
            </FormField>
            <FormField label="Email" htmlFor="register-email" required>
              <Input
                id="register-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Password" htmlFor="register-password" required>
              <Input
                id="register-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Registration token"
              htmlFor="register-token"
              helperText={waitlistEnabled ? "Required while waitlist mode is enabled." : "Optional when registration is open."}
              required={waitlistEnabled}
            >
              <Input
                id="register-token"
                value={registrationToken}
                onChange={(event) => setRegistrationToken(event.target.value)}
                placeholder={waitlistEnabled ? "Required while waitlist is active" : "Optional"}
                required={waitlistEnabled}
              />
            </FormField>
            {error ? (
              <p className="rounded-md border border-[hsl(var(--destructive))] p-2 text-sm text-[hsl(var(--destructive))]">
                {error}
              </p>
            ) : null}
            <Button disabled={busy} type="submit">
              Create account
            </Button>
          </form>

          <p className="mt-4 text-sm text-slate-600">
            Already registered? <Link className="underline" to="/login">Sign in</Link>
            {waitlistEnabled ? (
              <>
                {" "}Need access first? <Link className="underline" to="/waitlist">Join waitlist</Link>
              </>
            ) : null}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
