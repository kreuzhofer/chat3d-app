import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Box, Eye, EyeOff, Mail, UserPlus } from "lucide-react";
import * as authApi from "../../auth/auth.api";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { FormField } from "../../components/ui/form";
import { Input } from "../../components/ui/input";
import { useAuth } from "../../hooks/useAuth";
import { getPasswordStrength } from "../../utils/password-strength";

interface RegisterPageProps {
  waitlistEnabled: boolean;
}

export function RegisterPage({ waitlistEnabled }: RegisterPageProps) {
  const location = useLocation();
  const { register } = useAuth();
  const { t } = useTranslation(["pages", "common"]);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [registrationToken, setRegistrationToken] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  const passwordStrength = useMemo(() => getPasswordStrength(password, t), [password, t]);

  useEffect(() => {
    const token = new URLSearchParams(location.search).get("token");
    if (token) {
      setRegistrationToken(token);
    }
  }, [location.search]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!termsAccepted) {
      setError(t("pages:register_termsRequired"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await register(email, password, displayName || undefined, registrationToken || undefined);
      if (result.pendingConfirmation) {
        setPendingConfirmation(true);
      }
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
        <h1 className="text-lg font-semibold">{t("pages:register.createAccount")}</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("pages:register.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("pages:register.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {pendingConfirmation ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-md border border-[hsl(var(--success)_/_0.3)] bg-[hsl(var(--success)_/_0.06)] p-3">
                <Mail className="h-5 w-5 shrink-0 text-[hsl(var(--success))]" />
                <p className="text-sm text-[hsl(var(--foreground))]">
                  {t("pages:register.confirmationSent", { email })}
                </p>
              </div>
              {resendMessage ? (
                <p className="rounded-md border border-[hsl(var(--success)_/_0.3)] bg-[hsl(var(--success)_/_0.06)] p-2.5 text-sm text-[hsl(var(--foreground))]">
                  {resendMessage}
                </p>
              ) : null}
              <Button
                variant="outline"
                loading={resendBusy}
                disabled={resendBusy}
                onClick={() => {
                  setResendBusy(true);
                  setResendMessage("");
                  void authApi.resendConfirmation(email)
                    .then(() => setResendMessage(t("pages:register.confirmationResent")))
                    .catch(() => setResendMessage(t("pages:register.confirmationResent")))
                    .finally(() => setResendBusy(false));
                }}
                iconLeft={<Mail className="h-4 w-4" />}
              >
                {t("pages:register.resendConfirmation")}
              </Button>
              <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
                <Link className="font-medium text-[hsl(var(--primary))] underline" to="/login">
                  {t("pages:register.signIn")}
                </Link>
              </p>
            </div>
          ) : (
          <>
          <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
            <FormField label={t("common:labels.displayName")} htmlFor="register-name" helperText={t("pages:register.displayNameHelper")}>
              <Input
                id="register-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t("common:labels.optional")}
              />
            </FormField>
            <FormField label={t("common:labels.email")} htmlFor="register-email" required>
              <Input
                id="register-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </FormField>
            <FormField label={t("common:labels.password")} htmlFor="register-password" required>
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
                  aria-label={showPassword ? t("common:a11y.hidePassword") : t("common:a11y.showPassword")}
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
                    {t("common:passwordStrength.label")} <span className="font-medium">{passwordStrength.label}</span>
                  </p>
                </div>
              )}
            </FormField>
            <FormField
              label={t("pages:register.registrationToken")}
              htmlFor="register-token"
              helperText={waitlistEnabled ? t("pages:register.registrationTokenHelperWaitlist") : t("pages:register.registrationTokenHelperOpen")}
              required={waitlistEnabled}
            >
              <Input
                id="register-token"
                value={registrationToken}
                onChange={(event) => setRegistrationToken(event.target.value)}
                placeholder={waitlistEnabled ? t("pages:register.registrationTokenPlaceholderWaitlist") : t("pages:register.registrationTokenPlaceholderOpen")}
                required={waitlistEnabled}
              />
            </FormField>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
              />
              <span className="text-[hsl(var(--foreground))]">
                <Trans
                  i18nKey="pages:register_acceptTerms"
                  components={{
                    termsLink: <a className="font-medium text-[hsl(var(--primary))] underline" href="/terms" target="_blank" rel="noopener noreferrer" />,
                    privacyLink: <a className="font-medium text-[hsl(var(--primary))] underline" href="/privacy" target="_blank" rel="noopener noreferrer" />,
                  }}
                />
              </span>
            </label>
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
              {t("pages:register.createAccountButton")}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-[hsl(var(--muted-foreground))]">
            {t("pages:register.alreadyRegistered")}{" "}
            <Link className="font-medium text-[hsl(var(--primary))] underline" to="/login">
              {t("pages:register.signIn")}
            </Link>
            {waitlistEnabled ? (
              <>
                {" "}
                · {t("pages:register.needAccess")}{" "}
                <Link className="font-medium text-[hsl(var(--primary))] underline" to="/waitlist">
                  {t("pages:register.joinWaitlist")}
                </Link>
              </>
            ) : null}
          </p>
          </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
