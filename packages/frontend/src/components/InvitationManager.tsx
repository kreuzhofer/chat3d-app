import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createInvitations,
  listInvitations,
  revokeInvitation,
  type InvitationRecord,
} from "../api/invitations.api";
import { useNotifications } from "../contexts/NotificationsContext";
import { useAuth } from "../hooks/useAuth";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isInvitationNotification(payload: Record<string, unknown>): boolean {
  return payload.domain === "invitation";
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

  const activeInvitations = useMemo(
    () => invitations.filter((invitation) => invitation.status !== "revoked" && invitation.status !== "expired"),
    [invitations],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Invite one or more users. Separate emails by comma, space, or newline.
        </p>
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

        <div className="flex flex-col gap-2 md:flex-row">
          <Input
            value={inviteInput}
            onChange={(event) => setInviteInput(event.target.value)}
            placeholder="name1@example.com, name2@example.com"
          />
          <Button
            disabled={!token || busyAction !== null || parseEmails(inviteInput).length === 0}
            onClick={() => {
              if (!token) {
                return;
              }

              const emails = parseEmails(inviteInput);
              setBusyAction("create");
              setMessage(null);

              void createInvitations(token, emails)
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

        <p className="text-xs text-[hsl(var(--muted-foreground))]">Active invitations: {activeInvitations.length}</p>

        {invitations.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">No invitations yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invitation) => {
                  const canRevoke =
                    invitation.status === "pending" ||
                    invitation.status === "waitlisted" ||
                    invitation.status === "registration_sent";

                  return (
                    <TableRow key={invitation.id}>
                      <TableCell>{invitation.inviteeEmail}</TableCell>
                      <TableCell>{invitation.status}</TableCell>
                      <TableCell>{new Date(invitation.updatedAt).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
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
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
