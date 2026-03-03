import { FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Box, Eye, EyeOff, KeyRound } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { FormField } from "../../components/ui/form";
import { Input } from "../../components/ui/input";
import { getPasswordStrength } from "../../utils/password-strength";
import * as authApi from "../../auth/auth.api";

export function ResetPasswordPage() {
  const { t } = useTranslation(["pages", "common"]);
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const passwordStrength = useMemo(() => getPasswordStrength(newPassword, t), [newPassword, t]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError(t("pages:resetPassword.passwordsMismatch"));
      return;
    }

    if (!token) {
      setError(t("pages:resetPassword.missingToken"));
      return;
    }

    setBusy(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setSuccess(true);
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
        <h1 className="text-lg font-semibold">{t("pages:resetPassword.title")}</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("pages:resetPassword.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("pages:resetPassword.heading")}</CardTitle>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="space-y-4">
              <p className="rounded-md border border-[hsl(var(--success)_/_0.3)] bg-[hsl(var(--success)_/_0.06)] p-3 text-sm text-[hsl(var(--foreground))]">
                {t("pages:resetPassword.successMessage")}
              </p>
              <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
                <Link className="font-medium text-[hsl(var(--primary))] underline" to="/login">
                  {t("pages:resetPassword.goToLogin")}
                </Link>
              </p>
            </div>
          ) : (
            <>
              <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
                <FormField label={t("pages:resetPassword.newPassword")} htmlFor="reset-password" required>
                  <div className="relative">
                    <Input
                      id="reset-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
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
                  {newPassword.length > 0 && (
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
                <FormField label={t("pages:resetPassword.confirmPassword")} htmlFor="reset-confirm" required>
                  <Input
                    id="reset-confirm"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
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
                  iconLeft={<KeyRound className="h-4 w-4" />}
                >
                  {t("pages:resetPassword.resetButton")}
                </Button>
              </form>

              <p className="mt-5 text-center text-sm text-[hsl(var(--muted-foreground))]">
                {t("pages:resetPassword.linkExpired")}{" "}
                <Link className="font-medium text-[hsl(var(--primary))] underline" to="/forgot-password">
                  {t("pages:resetPassword.requestNewLink")}
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
