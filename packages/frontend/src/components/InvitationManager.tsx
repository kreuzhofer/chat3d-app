import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createInvitations,
  listInvitations,
  revokeInvitation,
  type InvitationRecord,
} from "../api/invitations.api";
import { useNotifications } from "../contexts/NotificationsContext";
import { useAuth } from "../hooks/useAuth";
import { EmptyState } from "./layout/EmptyState";
import { InlineAlert } from "./layout/InlineAlert";
import { SectionCard } from "./layout/SectionCard";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { FormField } from "./ui/form";
import { Textarea } from "./ui/textarea";

function parseEmails(raw: string): string[] {
  return [...new Set(raw
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0))];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isInvitationNotification(payload: Record<string, unknown>): boolean {
  return payload.domain === "invitation";
}

function statusTone(status: InvitationRecord["status"]) {
  if (status === "accepted") {
    return "success";
  }
  if (status === "revoked" || status === "expired") {
    return "danger";
  }
  if (status === "waitlisted") {
    return "warning";
  }
  return "info";
}

export function InvitationManager() {
  const { token } = useAuth();
  const { notifications } = useNotifications();
  const [inviteInput, setInviteInput] = useState("");
  const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
  const [busyAction, setBusyAction] = useState<"load" | "create" | "revoke" | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const lastHandledNotificationIdRef = useRef<number>(0);

  const loadInvitations = useCallback(async () => {
    if (!token) {
      setInvitations([]);
      return;
    }

    setBusyAction("load");
    setMessage(null);
    try {
      const rows = await listInvitations(token);
      setInvitations(rows);
    } catch (error) {
      setMessage({ kind: "error", text: toErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }, [token]);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  useEffect(() => {
    if (notifications.length === 0) {
      return;
    }

    const latestId = notifications[0].id;
    const hasInvitationUpdate = notifications.some(
      (notification) =>
        notification.id > lastHandledNotificationIdRef.current &&
        notification.eventType === "notification.created" &&
        isInvitationNotification(notification.payload),
    );

    lastHandledNotificationIdRef.current = Math.max(lastHandledNotificationIdRef.current, latestId);

    if (hasInvitationUpdate) {
      void loadInvitations();
    }
  }, [loadInvitations, notifications]);

  const parsedEmails = useMemo(() => parseEmails(inviteInput), [inviteInput]);

  const invitationStats = useMemo(() => {
    return {
      active: invitations.filter((invitation) => invitation.status !== "revoked" && invitation.status !== "expired").length,
      accepted: invitations.filter((invitation) => invitation.status === "accepted").length,
      pending: invitations.filter((invitation) => invitation.status === "pending").length,
      waitlisted: invitations.filter((invitation) => invitation.status === "waitlisted").length,
    };
  }, [invitations]);

  return (
    <SectionCard title="Invitations" description="Invite teammates and track each invitation through acceptance or waitlist states.">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-[hsl(var(--border))] p-2">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Active</p>
          <p className="text-2xl font-semibold">{invitationStats.active}</p>
        </div>
        <div className="rounded-md border border-[hsl(var(--border))] p-2">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Pending</p>
          <p className="text-2xl font-semibold">{invitationStats.pending}</p>
        </div>
        <div className="rounded-md border border-[hsl(var(--border))] p-2">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Waitlisted</p>
          <p className="text-2xl font-semibold">{invitationStats.waitlisted}</p>
        </div>
        <div className="rounded-md border border-[hsl(var(--border))] p-2">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Accepted</p>
          <p className="text-2xl font-semibold">{invitationStats.accepted}</p>
        </div>
      </div>

      <InlineAlert tone="info">
        Invitation quota is enforced by admin policy. If the limit is reached, invite submission returns an explicit error.
      </InlineAlert>

      {message ? (
        <InlineAlert tone={message.kind === "success" ? "success" : "danger"} role="status">
          {message.text}
        </InlineAlert>
      ) : null}

      <FormField
        label="Invite emails"
        htmlFor="invite-emails"
        helperText="Separate addresses by comma, space, or newline. Duplicates are removed."
      >
        <Textarea
          id="invite-emails"
          rows={4}
          value={inviteInput}
          onChange={(event) => setInviteInput(event.target.value)}
          placeholder="name1@example.com\nname2@example.com"
        />
      </FormField>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Parsed recipients: {parsedEmails.length}</p>
        <Button
          disabled={!token || busyAction !== null || parsedEmails.length === 0}
          onClick={() => {
            if (!token) {
              return;
            }

            setBusyAction("create");
            setMessage(null);

            void createInvitations(token, parsedEmails)
              .then((created) => {
                setInviteInput("");
                setMessage({
                  kind: "success",
                  text: `Sent ${created.length} invitation${created.length === 1 ? "" : "s"}.`,
                });
                return loadInvitations();
              })
              .catch((error) => {
                setMessage({ kind: "error", text: toErrorMessage(error) });
              })
              .finally(() => {
                setBusyAction(null);
              });
          }}
        >
          Send Invites
        </Button>
      </div>

      {invitations.length === 0 ? (
        <EmptyState title="No invitations yet" description="Invite users to skip manual waitlist entry where policy allows." />
      ) : (
        <ul className="space-y-2">
          {invitations.map((invitation) => {
            const canRevoke =
              invitation.status === "pending" ||
              invitation.status === "waitlisted" ||
              invitation.status === "registration_sent";

            return (
              <li key={invitation.id} className="rounded-md border border-[hsl(var(--border))] p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{invitation.inviteeEmail}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      Updated {new Date(invitation.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={statusTone(invitation.status)}>{invitation.status}</Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!token || !canRevoke || busyAction !== null}
                      onClick={() => {
                        if (!token) {
                          return;
                        }

                        setBusyAction("revoke");
                        setMessage(null);
                        void revokeInvitation(token, invitation.id)
                          .then(() => {
                            setMessage({ kind: "success", text: `Revoked ${invitation.inviteeEmail}.` });
                            return loadInvitations();
                          })
                          .catch((error) => {
                            setMessage({ kind: "error", text: toErrorMessage(error) });
                          })
                          .finally(() => {
                            setBusyAction(null);
                          });
                      }}
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
