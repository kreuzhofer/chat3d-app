import { useEffect, useMemo, useRef, useState } from "react";
import {
  confirmProfileAction,
  requestAccountDelete,
  requestAccountReactivation,
  requestDataExport,
  requestEmailChange,
  requestPasswordReset,
} from "../api/profile.api";
import { useAuth } from "../hooks/useAuth";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type MessageKind = "success" | "error";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ProfilePanel() {
  const { token, user } = useAuth();

  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [reactivationEmail, setReactivationEmail] = useState(user?.email ?? "");
  const [manualConfirmToken, setManualConfirmToken] = useState("");
  const [message, setMessage] = useState<{ kind: MessageKind; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const confirmedFromQueryRef = useRef(false);

  useEffect(() => {
    if (confirmedFromQueryRef.current) {
      return;
    }

    const queryToken = new URLSearchParams(window.location.search).get("token");
    if (!queryToken) {
      return;
    }

    confirmedFromQueryRef.current = true;
    setBusyAction("confirm");

    void confirmProfileAction(queryToken)
      .then((result) => {
        setMessage({
          kind: "success",
          text: `Confirmed action: ${result.actionType ?? "unknown"}.`,
        });
      })
      .catch((error) => {
        setMessage({ kind: "error", text: toErrorMessage(error) });
      })
      .finally(() => {
        setBusyAction(null);
      });
  }, []);

  useEffect(() => {
    if (user?.email) {
      setReactivationEmail(user.email);
    }
  }, [user?.email]);

  const isAuthenticated = useMemo(() => Boolean(token), [token]);

  async function runAction(action: string, execute: () => Promise<void>) {
    setBusyAction(action);
    setMessage(null);
    try {
      await execute();
    } catch (error) {
      setMessage({ kind: "error", text: toErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="space-y-4 bg-[hsl(var(--background))] p-4">
      <header>
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Profile & Account</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Sensitive actions require email confirmation. Follow the link in your inbox to complete each request.
        </p>
      </header>

      {message ? (
        <p
          className={`rounded-md border p-2 text-sm ${
            message.kind === "success"
              ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]"
              : "border-[hsl(var(--destructive))] text-[hsl(var(--destructive))]"
          }`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Password Reset</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="Enter a new password"
            />
          </div>
          <div className="mt-3">
            <Button
              disabled={!isAuthenticated || busyAction !== null}
              onClick={() =>
                runAction("password-reset", async () => {
                  if (!token) {
                    return;
                  }
                  await requestPasswordReset(token, newPassword);
                  setMessage({ kind: "success", text: "Password reset confirmation email sent." });
                  setNewPassword("");
                })
              }
            >
              Request Password Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email Change</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="new-email">New email</Label>
            <Input
              id="new-email"
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </div>
          <div className="mt-3">
            <Button
              disabled={!isAuthenticated || busyAction !== null}
              onClick={() =>
                runAction("email-change", async () => {
                  if (!token) {
                    return;
                  }
                  await requestEmailChange(token, newEmail);
                  setMessage({ kind: "success", text: "Email change confirmation sent to the new address." });
                  setNewEmail("");
                })
              }
            >
              Request Email Change
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Export</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            disabled={!isAuthenticated || busyAction !== null}
            onClick={() =>
              runAction("data-export", async () => {
                if (!token) {
                  return;
                }
                await requestDataExport(token);
                setMessage({ kind: "success", text: "Data export confirmation email sent." });
              })
            }
          >
            Request Data Export
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete Account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-sm text-[hsl(var(--muted-foreground))]">
            Deleting your account deactivates it for 30 days before permanent cleanup.
          </p>
          <Button
            variant="destructive"
            disabled={!isAuthenticated || busyAction !== null}
            onClick={() =>
              runAction("account-delete", async () => {
                if (!token) {
                  return;
                }
                await requestAccountDelete(token);
                setMessage({ kind: "success", text: "Account deletion confirmation email sent." });
              })
            }
          >
            Request Account Deletion
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reactivate Account</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="reactivate-email">Account email</Label>
            <Input
              id="reactivate-email"
              type="email"
              value={reactivationEmail}
              onChange={(event) => setReactivationEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </div>
          <div className="mt-3">
            <Button
              variant="outline"
              disabled={busyAction !== null}
              onClick={() =>
                runAction("reactivate", async () => {
                  await requestAccountReactivation(reactivationEmail);
                  setMessage({ kind: "success", text: "Reactivation confirmation email sent if the account is eligible." });
                })
              }
            >
              Request Reactivation
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manual Confirmation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="confirm-token">Token</Label>
            <Input
              id="confirm-token"
              value={manualConfirmToken}
              onChange={(event) => setManualConfirmToken(event.target.value)}
              placeholder="Paste token from email link"
            />
          </div>
          <div className="mt-3">
            <Button
              variant="secondary"
              disabled={busyAction !== null || manualConfirmToken.trim() === ""}
              onClick={() =>
                runAction("confirm", async () => {
                  const result = await confirmProfileAction(manualConfirmToken.trim());
                  setMessage({ kind: "success", text: `Confirmed action: ${result.actionType ?? "unknown"}.` });
                  setManualConfirmToken("");
                })
              }
            >
              Confirm Token
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
