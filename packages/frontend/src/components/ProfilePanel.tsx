import { useEffect, useMemo, useRef, useState } from "react";
import {
  confirmProfileAction,
  requestAccountDelete,
  requestDataExport,
  requestEmailChange,
  requestPasswordReset,
  updateDisplayName,
} from "../api/profile.api";
import { useAuth } from "../hooks/useAuth";
import { InvitationManager } from "./InvitationManager";
import { InlineAlert } from "./layout/InlineAlert";
import { PageHeader } from "./layout/PageHeader";
import { SectionCard } from "./layout/SectionCard";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { FormField, DestructiveActionNotice } from "./ui/form";
import { Input } from "./ui/input";

type MessageKind = "success" | "error";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ProfilePanel() {
  const { token, user, refreshProfile } = useAuth();

  const [editDisplayName, setEditDisplayName] = useState(user?.displayName ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
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
    <section className="space-y-4">
      <PageHeader
        title="Profile & Account"
        description="Journey-based account controls: security, identity, data, and lifecycle actions."
        breadcrumbs={["Workspace", "Profile"]}
        actions={
          <>
            <Badge tone={user?.status === "active" ? "success" : "warning"}>{user?.status ?? "unknown"}</Badge>
            <Badge tone={user?.role === "admin" ? "info" : "neutral"}>{user?.role ?? "user"}</Badge>
          </>
        }
      />

      {message ? (
        <InlineAlert tone={message.kind === "success" ? "success" : "danger"} role="status">
          {message.text}
        </InlineAlert>
      ) : null}

      <SectionCard title="Display Name" description="Update your public display name.">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <FormField label="Display name" htmlFor="edit-display-name" helperText="Visible to other users in shared contexts.">
            <Input
              id="edit-display-name"
              value={editDisplayName}
              onChange={(event) => setEditDisplayName(event.target.value)}
              placeholder="Your display name"
            />
          </FormField>
          <Button
            disabled={!isAuthenticated || busyAction !== null || editDisplayName.trim() === ""}
            onClick={() =>
              runAction("display-name", async () => {
                if (!token) return;
                await updateDisplayName(token, editDisplayName.trim());
                setMessage({ kind: "success", text: "Display name updated." });
                await refreshProfile();
              })
            }
          >
            Save
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Security" description="Password and credential controls.">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <FormField label="New password" htmlFor="new-password" helperText="A confirmation email is required to apply changes.">
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="Enter a new password"
            />
          </FormField>
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
      </SectionCard>

      <SectionCard title="Identity" description="Email ownership and confirmation flows.">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <FormField label="New email" htmlFor="new-email" helperText="A confirmation email will be sent to the new address.">
            <Input
              id="new-email"
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </FormField>
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

        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <FormField
            label="Manual confirmation token"
            htmlFor="confirm-token"
            helperText="Use only when opening email links is not possible."
          >
            <Input
              id="confirm-token"
              value={manualConfirmToken}
              onChange={(event) => setManualConfirmToken(event.target.value)}
              placeholder="Paste token from email link"
            />
          </FormField>
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
      </SectionCard>

      <SectionCard title="Data" description="Export your account and activity data.">
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
      </SectionCard>

      <SectionCard title="Account Lifecycle" description="Deactivate/reactivate lifecycle with mandatory confirmation emails.">
        <DestructiveActionNotice>
          Deleting your account deactivates it for 30 days before permanent cleanup.
        </DestructiveActionNotice>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="destructive"
            disabled={!isAuthenticated || busyAction !== null || user?.role === "admin"}
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
          {user?.role === "admin" && (
            <p className="mt-1 text-sm text-muted-foreground">Admins cannot delete their own account. Another admin must do this.</p>
          )}
        </div>

      </SectionCard>

      <InvitationManager />
    </section>
  );
}
