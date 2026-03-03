import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Box, CheckCircle, Mail, XCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { FormField } from "../../components/ui/form";
import { Input } from "../../components/ui/input";
import { confirmProfileAction } from "../../api/profile.api";
import * as authApi from "../../auth/auth.api";

export function ConfirmEmailPage() {
  const { t } = useTranslation(["pages", "common"]);
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<"loading" | "success" | "error">(token ? "loading" : "error");
  const [errorMessage, setErrorMessage] = useState(token ? "" : t("pages:confirmEmail.missingToken"));
  const confirmedRef = useRef(false);

  // Resend state
  const [resendEmail, setResendEmail] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  useEffect(() => {
    if (!token || confirmedRef.current) return;
    confirmedRef.current = true;

    void confirmProfileAction(token)
      .then(() => {
        setStatus("success");
      })
      .catch((error) => {
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : String(error));
      });
  }, [token]);

  async function handleResend() {
    if (!resendEmail) return;
    setResendBusy(true);
    setResendMessage("");
    try {
      await authApi.resendConfirmation(resendEmail);
      setResendMessage(t("pages:confirmEmail.resendSuccess"));
    } catch {
      setResendMessage(t("pages:confirmEmail.resendSuccess")); // Always show success to prevent enumeration
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]">
          <Box className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold">{t("pages:confirmEmail.title")}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("pages:confirmEmail.heading")}</CardTitle>
        </CardHeader>
        <CardContent>
          {status === "loading" ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("pages:confirmEmail.verifying")}</p>
          ) : status === "success" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-md border border-[hsl(var(--success)_/_0.3)] bg-[hsl(var(--success)_/_0.06)] p-3">
                <CheckCircle className="h-5 w-5 shrink-0 text-[hsl(var(--success))]" />
                <p className="text-sm text-[hsl(var(--foreground))]">
                  {t("pages:confirmEmail.successMessage")}
                </p>
              </div>
              <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
                <Link className="font-medium text-[hsl(var(--primary))] underline" to="/login">
                  {t("pages:confirmEmail.goToLogin")}
                </Link>
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-md border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.06)] p-3">
                <XCircle className="h-5 w-5 shrink-0 text-[hsl(var(--destructive))]" />
                <p className="text-sm text-[hsl(var(--foreground))]">{errorMessage}</p>
              </div>

              <div className="space-y-3">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("pages:confirmEmail.resendPrompt")}</p>
                <FormField label={t("common:labels.email")} htmlFor="resend-email">
                  <Input
                    id="resend-email"
                    type="email"
                    value={resendEmail}
                    onChange={(event) => setResendEmail(event.target.value)}
                  />
                </FormField>
                {resendMessage ? (
                  <p className="rounded-md border border-[hsl(var(--success)_/_0.3)] bg-[hsl(var(--success)_/_0.06)] p-2.5 text-sm text-[hsl(var(--foreground))]">
                    {resendMessage}
                  </p>
                ) : null}
                <Button
                  loading={resendBusy}
                  disabled={resendBusy || !resendEmail}
                  onClick={() => void handleResend()}
                  iconLeft={<Mail className="h-4 w-4" />}
                >
                  {t("pages:confirmEmail.resendButton")}
                </Button>
              </div>

              <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
                <Link className="font-medium text-[hsl(var(--primary))] underline" to="/login">
                  {t("pages:confirmEmail.goToLogin")}
                </Link>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
