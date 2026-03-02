import { FormEvent, useMemo, useState } from "react";
import { Box, Eye, EyeOff, Shield } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { FormField } from "../../components/ui/form";
import { Input } from "../../components/ui/input";
import { useAuth } from "../../hooks/useAuth";

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

export function SetupPage() {
  const { setupAdmin } = useAuth();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await setupAdmin(email, password, displayName || undefined);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))] p-4">
      <div className="w-full max-w-md">
        {/* Branding header */}
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]">
            <Box className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold">Welcome to Chat3D</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Create your admin account to get started</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Initial Setup
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
              <FormField label="Display name" htmlFor="setup-name" helperText="Optional.">
                <Input
                  id="setup-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Optional"
                />
              </FormField>
              <FormField label="Email" htmlFor="setup-email" required>
                <Input
                  id="setup-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </FormField>
              <FormField label="Password" htmlFor="setup-password" required>
                <div className="relative">
                  <Input
                    id="setup-password"
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
                iconLeft={<Shield className="h-4 w-4" />}
              >
                Create admin account
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
