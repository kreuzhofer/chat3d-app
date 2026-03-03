import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Box, Mail } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { FormField } from "../../components/ui/form";
import { Input } from "../../components/ui/input";
import * as authApi from "../../auth/auth.api";

export function ForgotPasswordPage() {
  const { t } = useTranslation(["pages", "common"]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await authApi.forgotPassword(email);
      setSubmitted(true);
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
        <h1 className="text-lg font-semibold">{t("pages:forgotPassword.title")}</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("pages:forgotPassword.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("pages:forgotPassword.heading")}</CardTitle>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-md border border-[hsl(var(--success)_/_0.3)] bg-[hsl(var(--success)_/_0.06)] p-3">
                <Mail className="h-5 w-5 shrink-0 text-[hsl(var(--success))]" />
                <p className="text-sm text-[hsl(var(--foreground))]">
                  {t("pages:forgotPassword.successMessage")}
                </p>
              </div>
              <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
                <Link className="font-medium text-[hsl(var(--primary))] underline" to="/login">
                  {t("pages:forgotPassword.backToLogin")}
                </Link>
              </p>
            </div>
          ) : (
            <>
              <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
                <FormField label={t("common:labels.email")} htmlFor="forgot-email" required>
                  <Input
                    id="forgot-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
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
                  iconLeft={<Mail className="h-4 w-4" />}
                >
                  {t("pages:forgotPassword.sendResetLink")}
                </Button>
              </form>

              <p className="mt-5 text-center text-sm text-[hsl(var(--muted-foreground))]">
                {t("pages:forgotPassword.rememberPassword")}{" "}
                <Link className="font-medium text-[hsl(var(--primary))] underline" to="/login">
                  {t("pages:forgotPassword.signIn")}
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
