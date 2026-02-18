import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activateAdminUser,
  approveAdminWaitlistEntry,
  deactivateAdminUser,
  getAdminSettings,
  listAdminUsers,
  listAdminWaitlist,
  rejectAdminWaitlistEntry,
  triggerAdminPasswordReset,
  updateAdminSettings,
  type AdminSettings,
  type AdminUser,
  type AdminWaitlistEntry,
} from "../api/admin.api";
import { useNotifications } from "../contexts/NotificationsContext";
import { useAuth } from "../hooks/useAuth";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sortUsersByCreatedDate(users: AdminUser[]): AdminUser[] {
  return [...users].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function sortWaitlistByCreatedDate(entries: AdminWaitlistEntry[]): AdminWaitlistEntry[] {
  return [...entries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function AdminPanel() {
  const { token, user } = useAuth();
  const { notifications } = useNotifications();

  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [waitlistEntries, setWaitlistEntries] = useState<AdminWaitlistEntry[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({
    waitlistEnabled: false,
    invitationsEnabled: true,
    invitationWaitlistRequired: false,
    invitationQuotaPerUser: 3,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [busyUserIds, setBusyUserIds] = useState<Set<string>>(new Set());
  const [busyWaitlistEntryIds, setBusyWaitlistEntryIds] = useState<Set<string>>(new Set());
  const lastHandledNotificationIdRef = useRef<number>(0);

  const canRender = Boolean(token && user?.role === "admin");

  const loadAdminData = useCallback(
    async (searchValue: string) => {
      if (!token) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const [nextUsers, nextWaitlistEntries, nextSettings] = await Promise.all([
          listAdminUsers(token, searchValue),
          listAdminWaitlist(token),
          getAdminSettings(token),
        ]);

        setUsers(sortUsersByCreatedDate(nextUsers));
        setWaitlistEntries(sortWaitlistByCreatedDate(nextWaitlistEntries));
        setSettings(nextSettings);
        setSettingsDraft({
          waitlistEnabled: nextSettings.waitlistEnabled,
          invitationsEnabled: nextSettings.invitationsEnabled,
          invitationWaitlistRequired: nextSettings.invitationWaitlistRequired,
          invitationQuotaPerUser: nextSettings.invitationQuotaPerUser,
        });
      } catch (loadError) {
        setError(toErrorMessage(loadError));
      } finally {
        setIsLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!canRender) {
      return;
    }
    void loadAdminData(search);
  }, [canRender, loadAdminData, search]);

  useEffect(() => {
    if (!canRender || notifications.length === 0) {
      return;
    }

    const latestId = notifications[0].id;
    const hasRelevantEvent = notifications.some(
      (notification) =>
        notification.id > lastHandledNotificationIdRef.current &&
        (notification.eventType === "admin.settings.updated" ||
          notification.eventType === "account.status.changed"),
    );

    lastHandledNotificationIdRef.current = Math.max(lastHandledNotificationIdRef.current, latestId);

    if (hasRelevantEvent) {
      void loadAdminData(search);
    }
  }, [canRender, loadAdminData, notifications, search]);

  const runUserAction = useCallback(
    async (targetUserId: string, action: () => Promise<void>) => {
      setBusyUserIds((existing) => new Set(existing).add(targetUserId));
      setError(null);
      try {
        await action();
        await loadAdminData(search);
      } catch (actionError) {
        setError(toErrorMessage(actionError));
      } finally {
        setBusyUserIds((existing) => {
          const next = new Set(existing);
          next.delete(targetUserId);
          return next;
        });
      }
    },
    [loadAdminData, search],
  );

  const runWaitlistAction = useCallback(
    async (entryId: string, action: () => Promise<void>) => {
      setBusyWaitlistEntryIds((existing) => new Set(existing).add(entryId));
      setError(null);
      try {
        await action();
        await loadAdminData(search);
      } catch (actionError) {
        setError(toErrorMessage(actionError));
      } finally {
        setBusyWaitlistEntryIds((existing) => {
          const next = new Set(existing);
          next.delete(entryId);
          return next;
        });
      }
    },
    [loadAdminData, search],
  );

  const saveSettings = useCallback(async () => {
    if (!token) {
      return;
    }

    setIsSavingSettings(true);
    setError(null);
    try {
      const updated = await updateAdminSettings(token, settingsDraft);
      setSettings(updated);
      setSettingsDraft({
        waitlistEnabled: updated.waitlistEnabled,
        invitationsEnabled: updated.invitationsEnabled,
        invitationWaitlistRequired: updated.invitationWaitlistRequired,
        invitationQuotaPerUser: updated.invitationQuotaPerUser,
      });
      await loadAdminData(search);
    } catch (settingsError) {
      setError(toErrorMessage(settingsError));
    } finally {
      setIsSavingSettings(false);
    }
  }, [loadAdminData, search, settingsDraft, token]);

  const visibleUsers = useMemo(() => users, [users]);

  if (!canRender) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>Admin access required</CardTitle>
        </CardHeader>
        <CardContent>Only authenticated admins can open this control plane.</CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-4 bg-[hsl(var(--background))] p-4 text-[hsl(var(--foreground))]">
      <header>
        <h2 className="text-2xl font-semibold">Admin Panel</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Manage accounts, waitlist moderation, and registration policy in one place.
        </p>
      </header>
      {error ? (
        <p role="alert" className="rounded-md border border-[hsl(var(--destructive))] p-2 text-sm">
          {error}
        </p>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading admin data...</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 max-w-md space-y-2">
            <Label htmlFor="user-search">Search users</Label>
            <Input
              id="user-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by email or display name"
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleUsers.map((entry) => {
                const isBusy = busyUserIds.has(entry.id);
                return (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.email}</TableCell>
                    <TableCell>{entry.role}</TableCell>
                    <TableCell>{entry.status}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy || entry.status !== "deactivated"}
                          onClick={() =>
                            void runUserAction(entry.id, async () => {
                              if (!token) {
                                return;
                              }
                              await activateAdminUser(token, entry.id);
                            })
                          }
                        >
                          Activate
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isBusy || entry.status === "deactivated"}
                          onClick={() =>
                            void runUserAction(entry.id, async () => {
                              if (!token) {
                                return;
                              }
                              await deactivateAdminUser(token, entry.id);
                            })
                          }
                        >
                          Deactivate
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isBusy}
                          onClick={() =>
                            void runUserAction(entry.id, async () => {
                              if (!token) {
                                return;
                              }
                              await triggerAdminPasswordReset(token, entry.id);
                            })
                          }
                        >
                          Reset Password
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Waitlist</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {waitlistEntries.map((entry) => {
                const isBusy = busyWaitlistEntryIds.has(entry.id);
                return (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.email}</TableCell>
                    <TableCell>{entry.status}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy || entry.status !== "pending_admin_approval"}
                          onClick={() =>
                            void runWaitlistAction(entry.id, async () => {
                              if (!token) {
                                return;
                              }
                              await approveAdminWaitlistEntry(token, entry.id);
                            })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isBusy || entry.status === "rejected"}
                          onClick={() =>
                            void runWaitlistAction(entry.id, async () => {
                              if (!token) {
                                return;
                              }
                              await rejectAdminWaitlistEntry(token, entry.id);
                            })
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          {settings ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Last updated: {new Date(settings.updatedAt).toLocaleString()}
            </p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <Label className="flex items-center gap-2">
              <Switch
                checked={settingsDraft.waitlistEnabled}
                onCheckedChange={(checked) =>
                  setSettingsDraft((existing) => ({
                    ...existing,
                    waitlistEnabled: checked,
                  }))
                }
              />
              Enable waitlist
            </Label>
            <Label className="flex items-center gap-2">
              <Switch
                checked={settingsDraft.invitationsEnabled}
                onCheckedChange={(checked) =>
                  setSettingsDraft((existing) => ({
                    ...existing,
                    invitationsEnabled: checked,
                  }))
                }
              />
              Enable invitations
            </Label>
            <Label className="flex items-center gap-2">
              <Switch
                checked={settingsDraft.invitationWaitlistRequired}
                onCheckedChange={(checked) =>
                  setSettingsDraft((existing) => ({
                    ...existing,
                    invitationWaitlistRequired: checked,
                  }))
                }
              />
              Waitlist invited users
            </Label>
            <div className="space-y-2">
              <Label htmlFor="invitation-quota">Invitation quota per user</Label>
              <Input
                id="invitation-quota"
                type="number"
                min={0}
                value={settingsDraft.invitationQuotaPerUser}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  setSettingsDraft((existing) => ({
                    ...existing,
                    invitationQuotaPerUser: Number.isFinite(parsed)
                      ? Math.max(0, Math.trunc(parsed))
                      : 0,
                  }));
                }}
              />
            </div>
          </div>
          <div className="mt-4">
            <Button disabled={isSavingSettings} onClick={() => void saveSettings()}>
              Save Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
