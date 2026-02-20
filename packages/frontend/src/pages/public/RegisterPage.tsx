import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Box, Eye, EyeOff, UserPlus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { FormField } from "../../components/ui/form";
import { Input } from "../../components/ui/input";
import { useAuth } from "../../hooks/useAuth";

interface RegisterPageProps {
  waitlistEnabled: boolean;
}

function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z\d]/.test(password)) score++;

  if (score <= 1) return { score, label: "Weak", color: "bg-[hsl(var(--destructive))]" };
  if (score <= 2) return { score, label: "Fair", color: "bg-[hsl(var(--warning))]" };
  if (score <= 3) return { score, label: "Good", color: "bg-[hsl(var(--info))]" };
  return { score, label: "Strong", color: "bg-[hsl(var(--success))]" };
}

export function RegisterPage({ waitlistEnabled }: RegisterPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { register } = useAuth();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [registrationToken, setRegistrationToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);

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
    <div className="mx-auto max-w-md">
      {/* Branding header */}
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]">
          <Box className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold">Create your Chat3D account</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Start building 3D models with AI</p>
      </div>

      {waitlistEnabled ? (
        <p className="mb-4 rounded-lg border border-[hsl(var(--warning)_/_0.3)] bg-[hsl(var(--warning)_/_0.08)] p-3 text-sm text-[hsl(var(--warning))]">
          Waitlist mode is active. Registration requires a valid activation token sent by email after approval.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Register</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
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
              <div className="relative">
                <Input
                  id="register-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))]"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {/* Password strength indicator */}
              {password.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div
                        key={level}
                        className={`h-1.5 flex-1 rounded-full transition-colors ${
                          level <= passwordStrength.score ? passwordStrength.color : "bg-[hsl(var(--muted))]"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    Password strength: <span className="font-medium">{passwordStrength.label}</span>
                  </p>
                </div>
              )}
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
              <p className="rounded-md border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.06)] p-2.5 text-sm text-[hsl(var(--destructive))]">
                {error}
              </p>
            ) : null}
            <Button
              loading={busy}
              disabled={busy}
              type="submit"
              className="w-full"
              iconLeft={<UserPlus className="h-4 w-4" />}
            >
              Create account
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-[hsl(var(--muted-foreground))]">
            Already registered?{" "}
            <Link className="font-medium text-[hsl(var(--primary))] underline" to="/login">
              Sign in
            </Link>
            {waitlistEnabled ? (
              <>
                {" "}
                · Need access first?{" "}
                <Link className="font-medium text-[hsl(var(--primary))] underline" to="/waitlist">
                  Join waitlist
                </Link>
              </>
            ) : null}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
