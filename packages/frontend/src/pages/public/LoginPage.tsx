import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Box, Eye, EyeOff, LogIn } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { FormField } from "../../components/ui/form";
import { Input } from "../../components/ui/input";
import { useAuth } from "../../hooks/useAuth";

interface LoginPageProps {
  waitlistEnabled: boolean;
}

export function LoginPage({ waitlistEnabled }: LoginPageProps) {
  const { login } = useAuth();
  const { t } = useTranslation(["pages", "common"]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
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
        <h1 className="text-lg font-semibold">{t("pages:login.welcomeBack")}</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("pages:login.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("pages:login.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
            <FormField label={t("common:labels.email")} htmlFor="login-email" required>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </FormField>
            <FormField label={t("common:labels.password")} htmlFor="login-password" required>
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))]"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? t("common:a11y.hidePassword") : t("common:a11y.showPassword")}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </FormField>
            <div className="text-right">
              <Link className="text-sm font-medium text-[hsl(var(--primary))] underline" to="/forgot-password">
                {t("pages:login.forgotPassword")}
              </Link>
            </div>
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
              iconLeft={<LogIn className="h-4 w-4" />}
            >
              {t("pages:login.signIn")}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-[hsl(var(--muted-foreground))]">
            {waitlistEnabled ? (
              <>
                {t("pages:login.waitlistGated")}{" "}
                <Link className="font-medium text-[hsl(var(--primary))] underline" to="/waitlist">{t("pages:login.joinWaitlist")}</Link>.
              </>
            ) : (
              <>
                {t("pages:login.noAccount")}{" "}
                <Link className="font-medium text-[hsl(var(--primary))] underline" to="/register">{t("pages:login.createOne")}</Link>.
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
