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
  type AdminSettingsPatch,
  type AdminUser,
  type AdminWaitlistEntry,
} from "../api/admin.api";
import { useNotifications } from "../contexts/NotificationsContext";
import { useAuth } from "../hooks/useAuth";
import { EmptyState } from "./layout/EmptyState";
import { InlineAlert } from "./layout/InlineAlert";
import { PageHeader } from "./layout/PageHeader";
import { SectionCard } from "./layout/SectionCard";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Drawer } from "./ui/drawer";
import { FormField, DestructiveActionNotice } from "./ui/form";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Tabs } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
import { useToast } from "./ui/toast";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sortUsersByCreatedDate(users: AdminUser[]): AdminUser[] {
  return [...users].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function sortWaitlistByCreatedDate(entries: AdminWaitlistEntry[]): AdminWaitlistEntry[] {
  return [...entries].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

type AdminTab = "dashboard" | "users" | "waitlist" | "settings";
type UserStatusFilter = "all" | "active" | "deactivated" | "pending_registration";

interface ConfirmState {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}

function toRoleTone(role: AdminUser["role"]) {
  return role === "admin" ? "info" : "neutral";
}

function toStatusTone(status: AdminUser["status"]) {
  if (status === "active") {
    return "success";
  }
  if (status === "deactivated") {
    return "danger";
  }
  return "warning";
}

function toWaitlistTone(status: AdminWaitlistEntry["status"]) {
  if (status === "approved") {
    return "success";
  }
  if (status === "rejected") {
    return "danger";
  }
  if (status === "pending_admin_approval") {
    return "warning";
  }
  return "neutral";
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

export function AdminPanel() {
  const { token, user } = useAuth();
  const { notifications } = useNotifications();
  const { pushToast } = useToast();

  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("all");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [waitlistEntries, setWaitlistEntries] = useState<AdminWaitlistEntry[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({
    waitlistEnabled: false,
    invitationsEnabled: true,
    invitationWaitlistRequired: false,
    invitationQuotaPerUser: 3,
  });
  const [moderationReason, setModerationReason] = useState("");
  const [queueIndex, setQueueIndex] = useState(0);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
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
          notification.eventType === "account.status.changed" ||
          notification.eventType === "waitlist.status.changed"),
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
        throw actionError;
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
        throw actionError;
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

  const applySettingsPatch = useCallback(
    async (patch: AdminSettingsPatch) => {
      if (!token) {
        return;
      }

      const updated = await updateAdminSettings(token, patch);
      setSettings(updated);
      setSettingsDraft({
        waitlistEnabled: updated.waitlistEnabled,
        invitationsEnabled: updated.invitationsEnabled,
        invitationWaitlistRequired: updated.invitationWaitlistRequired,
        invitationQuotaPerUser: updated.invitationQuotaPerUser,
      });
      await loadAdminData(search);
    },
    [loadAdminData, search, token],
  );

  const openConfirm = useCallback((state: ConfirmState) => {
    setConfirmState(state);
  }, []);

  const executeConfirm = useCallback(async () => {
    if (!confirmState) {
      return;
    }

    setConfirmBusy(true);
    try {
      await confirmState.onConfirm();
      setConfirmState(null);
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setConfirmBusy(false);
    }
  }, [confirmState]);

  const visibleUsers = useMemo(() => {
    return users.filter((entry) => {
      if (statusFilter !== "all" && entry.status !== statusFilter) {
        return false;
      }

      if (!search.trim()) {
        return true;
      }

      const searchValue = search.toLowerCase();
      return (
        entry.email.toLowerCase().includes(searchValue) ||
        (entry.displayName ?? "").toLowerCase().includes(searchValue)
      );
    });
  }, [search, statusFilter, users]);

  const selectedUser = useMemo(
    () => users.find((entry) => entry.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );

  const pendingWaitlistEntries = useMemo(
    () => waitlistEntries.filter((entry) => entry.status === "pending_admin_approval"),
    [waitlistEntries],
  );

  useEffect(() => {
    if (queueIndex >= pendingWaitlistEntries.length) {
      setQueueIndex(0);
    }
  }, [pendingWaitlistEntries.length, queueIndex]);

  const queueEntry = pendingWaitlistEntries[queueIndex] ?? null;

  const dashboardKpis = useMemo(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const oneDayMs = 24 * 60 * 60 * 1000;

    const pendingWaitlistCount = pendingWaitlistEntries.length;

    const approvalDurations = waitlistEntries
      .filter((entry) => entry.approvedAt)
      .map((entry) => {
        const start = Date.parse(entry.createdAt);
        const end = Date.parse(entry.approvedAt ?? entry.createdAt);
        return (end - start) / (1000 * 60 * 60);
      })
      .filter((value) => Number.isFinite(value) && value >= 0);

    const avgWaitlistApprovalHours =
      approvalDurations.length === 0
        ? null
        : approvalDurations.reduce((sum, value) => sum + value, 0) / approvalDurations.length;

    const newRegistrations7d = users.filter((entry) => now - Date.parse(entry.createdAt) <= sevenDaysMs).length;

    const activeUsers7d = users.filter(
      (entry) => entry.status === "active" && now - Date.parse(entry.createdAt) <= sevenDaysMs,
    ).length;

    const deactivatedUsersCount = users.filter((entry) => entry.status === "deactivated").length;

    const queryEvents = notifications.filter((notification) => notification.eventType === "chat.query.state");

    const successRate = (windowMs: number) => {
      const scoped = queryEvents.filter((notification) => now - Date.parse(notification.createdAt) <= windowMs);
      const completed = scoped.filter((notification) => notification.payload.state === "completed").length;
      const failed = scoped.filter((notification) => notification.payload.state === "error").length;
      const total = completed + failed;
      return total === 0 ? Number.NaN : completed / total;
    };

    return {
      pendingWaitlistCount,
      avgWaitlistApprovalHours,
      newRegistrations7d,
      activeUsers7d,
      deactivatedUsersCount,
      querySuccessRate24h: successRate(oneDayMs),
      querySuccessRate7d: successRate(sevenDaysMs),
    };
  }, [notifications, pendingWaitlistEntries.length, users, waitlistEntries]);

  const hasSettingsChanges = useMemo(() => {
    if (!settings) {
      return false;
    }

    return (
      settings.waitlistEnabled !== settingsDraft.waitlistEnabled ||
      settings.invitationsEnabled !== settingsDraft.invitationsEnabled ||
      settings.invitationWaitlistRequired !== settingsDraft.invitationWaitlistRequired ||
      settings.invitationQuotaPerUser !== settingsDraft.invitationQuotaPerUser
    );
  }, [settings, settingsDraft]);

  async function saveSettings() {
    if (!token || !settings) {
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
      pushToast({
        tone: "success",
        title: "Settings saved",
        description: "Policy changes are now active.",
      });
    } catch (settingsError) {
      setError(toErrorMessage(settingsError));
    } finally {
      setIsSavingSettings(false);
    }
  }

  if (!canRender) {
    return (
      <SectionCard title="Admin access required" description="Only authenticated admins can open this control plane.">
        <p className="text-sm">Sign in with an admin account to continue.</p>
      </SectionCard>
    );
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="Admin Control Center"
        description="User operations, waitlist moderation, and policy controls in one task-oriented surface."
        breadcrumbs={["Workspace", "Admin"]}
        actions={
          <>
            <Badge tone="warning">{pendingWaitlistEntries.length} pending waitlist</Badge>
            <Badge tone="info">{users.length} users</Badge>
          </>
        }
      />

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {isLoading ? <InlineAlert tone="info">Loading admin data...</InlineAlert> : null}

      <Tabs
        tabs={[
          { id: "dashboard", label: "Dashboard" },
          { id: "users", label: "Users" },
          { id: "waitlist", label: "Waitlist" },
          { id: "settings", label: "Settings" },
        ]}
        activeTab={activeTab}
        onChange={(tabId) => setActiveTab(tabId as AdminTab)}
      />

      {activeTab === "dashboard" ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SectionCard title="Pending waitlist" description="Entries awaiting moderation.">
              <p className="text-3xl font-semibold">{dashboardKpis.pendingWaitlistCount}</p>
            </SectionCard>
            <SectionCard title="Avg approval time" description="Mean time from join to approval.">
              <p className="text-3xl font-semibold">
                {dashboardKpis.avgWaitlistApprovalHours === null
                  ? "n/a"
                  : `${dashboardKpis.avgWaitlistApprovalHours.toFixed(1)}h`}
              </p>
            </SectionCard>
            <SectionCard title="New registrations (7d)">
              <p className="text-3xl font-semibold">{dashboardKpis.newRegistrations7d}</p>
            </SectionCard>
            <SectionCard title="Active users (7d)">
              <p className="text-3xl font-semibold">{dashboardKpis.activeUsers7d}</p>
            </SectionCard>
            <SectionCard title="Deactivated users">
              <p className="text-3xl font-semibold">{dashboardKpis.deactivatedUsersCount}</p>
            </SectionCard>
            <SectionCard title="Query success">
              <p className="text-base font-medium">24h: {formatPct(dashboardKpis.querySuccessRate24h)}</p>
              <p className="text-base font-medium">7d: {formatPct(dashboardKpis.querySuccessRate7d)}</p>
            </SectionCard>
          </div>

          <SectionCard title="Quick actions" description="Prioritized operations for user and waitlist workflows.">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setActiveTab("waitlist");
                }}
              >
                Review Waitlist
              </Button>
              <Button
                variant="outline"
                disabled={!queueEntry}
                onClick={() => {
                  if (!queueEntry || !token) {
                    return;
                  }
                  openConfirm({
                    title: "Approve next waitlist entry",
                    description: `Approve ${queueEntry.email} and send a registration token email?`,
                    confirmLabel: "Approve",
                    onConfirm: async () => {
                      await runWaitlistAction(queueEntry.id, async () => {
                        if (!token) {
                          return;
                        }
                        await approveAdminWaitlistEntry(token, queueEntry.id);
                      });
                      pushToast({
                        tone: "success",
                        title: "Entry approved",
                        description: `${queueEntry.email} can now register.`,
                      });
                    },
                  });
                }}
              >
                Approve Next
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setActiveTab("users");
                  setStatusFilter("deactivated");
                }}
              >
                Open Deactivated Users
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const previous = settingsDraft.waitlistEnabled;
                  const next = !previous;
                  openConfirm({
                    title: `${next ? "Enable" : "Disable"} waitlist`,
                    description:
                      "This changes how new users enter the system. Confirm this high-impact policy update.",
                    confirmLabel: next ? "Enable waitlist" : "Disable waitlist",
                    danger: true,
                    onConfirm: async () => {
                      await applySettingsPatch({ waitlistEnabled: next });
                      pushToast({
                        tone: "warning",
                        title: `Waitlist ${next ? "enabled" : "disabled"}`,
                        description: "Use undo to restore previous state.",
                        actionLabel: "Undo",
                        onAction: async () => {
                          await applySettingsPatch({ waitlistEnabled: previous });
                        },
                      });
                    },
                  });
                }}
              >
                Toggle Waitlist
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Queue snapshot" description="Single-item moderation is active in this milestone; bulk actions are deferred.">
            {pendingWaitlistEntries.length === 0 ? (
              <EmptyState title="No pending entries" description="Waitlist queue is currently clear." />
            ) : (
              <ul className="space-y-2">
                {pendingWaitlistEntries.slice(0, 5).map((entry) => (
                  <li key={entry.id} className="rounded-md border border-[hsl(var(--border))] p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span>{entry.email}</span>
                      <Badge tone={toWaitlistTone(entry.status)}>{entry.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                      Joined {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "users" ? (
        <div className="space-y-4">
          <SectionCard title="User management" description="Filter users, inspect details, and execute account actions.">
            <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
              <FormField label="Search" htmlFor="user-search">
                <Input
                  id="user-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by email or display name"
                />
              </FormField>
              <FormField label="Status filter" htmlFor="status-filter">
                <select
                  id="status-filter"
                  className="h-9 w-full rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-white px-2 text-sm"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as UserStatusFilter)}
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="deactivated">Deactivated</option>
                  <option value="pending_registration">Pending registration</option>
                </select>
              </FormField>
            </div>

            {visibleUsers.length === 0 ? (
              <EmptyState title="No matching users" description="Adjust filters or search terms." />
            ) : (
              <ul className="space-y-2">
                {visibleUsers.map((entry) => (
                  <li key={entry.id} className="rounded-md border border-[hsl(var(--border))] p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{entry.email}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          {entry.displayName ?? "No display name"} · joined {new Date(entry.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={toRoleTone(entry.role)}>{entry.role}</Badge>
                        <Badge tone={toStatusTone(entry.status)}>{entry.status}</Badge>
                        <Button size="sm" variant="outline" onClick={() => setSelectedUserId(entry.id)}>
                          Open
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "waitlist" ? (
        <div className="space-y-4">
          <SectionCard title="Moderation queue" description="Single-item moderation workflow (bulk is intentionally deferred).">
            {!queueEntry ? (
              <EmptyState title="Queue empty" description="No waitlist entries are pending admin approval." />
            ) : (
              <div className="space-y-3">
                <div className="rounded-md border border-[hsl(var(--border))] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{queueEntry.email}</p>
                    <Badge tone={toWaitlistTone(queueEntry.status)}>{queueEntry.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                    Joined {new Date(queueEntry.createdAt).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                    Marketing consent: {queueEntry.marketingConsent ? "yes" : "no"}
                  </p>
                </div>

                <FormField
                  label="Moderation reason"
                  htmlFor="moderation-reason"
                  helperText="Reason is captured for operator context in this phase."
                >
                  <Textarea
                    id="moderation-reason"
                    value={moderationReason}
                    onChange={(event) => setModerationReason(event.target.value)}
                    rows={3}
                    placeholder="Optional note for this moderation decision"
                  />
                </FormField>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busyWaitlistEntryIds.has(queueEntry.id)}
                    onClick={() => {
                      if (!token) {
                        return;
                      }
                      openConfirm({
                        title: "Approve waitlist entry",
                        description: `Approve ${queueEntry.email} and issue registration token?`,
                        confirmLabel: "Approve",
                        onConfirm: async () => {
                          await runWaitlistAction(queueEntry.id, async () => {
                            if (!token) {
                              return;
                            }
                            await approveAdminWaitlistEntry(token, queueEntry.id);
                          });
                          pushToast({
                            tone: "success",
                            title: "Entry approved",
                            description: `${queueEntry.email} received registration instructions.`,
                          });
                        },
                      });
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busyWaitlistEntryIds.has(queueEntry.id)}
                    onClick={() => {
                      if (!token) {
                        return;
                      }
                      openConfirm({
                        title: "Reject waitlist entry",
                        description: `Reject ${queueEntry.email}${moderationReason.trim() ? ` (reason: ${moderationReason.trim()})` : ""}?`,
                        confirmLabel: "Reject",
                        danger: true,
                        onConfirm: async () => {
                          await runWaitlistAction(queueEntry.id, async () => {
                            if (!token) {
                              return;
                            }
                            await rejectAdminWaitlistEntry(token, queueEntry.id);
                          });
                          pushToast({
                            tone: "warning",
                            title: "Entry rejected",
                            description: `${queueEntry.email} was rejected from waitlist.`,
                          });
                        },
                      });
                    }}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="outline"
                    disabled={queueIndex <= 0}
                    onClick={() => setQueueIndex((current) => Math.max(0, current - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    disabled={queueIndex >= pendingWaitlistEntries.length - 1}
                    onClick={() => setQueueIndex((current) => Math.min(pendingWaitlistEntries.length - 1, current + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Queue overview">
            {waitlistEntries.length === 0 ? (
              <EmptyState title="No waitlist records" description="No users have entered the waitlist yet." />
            ) : (
              <ul className="space-y-2">
                {waitlistEntries.slice(0, 20).map((entry) => (
                  <li key={entry.id} className="rounded-md border border-[hsl(var(--border))] p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span>{entry.email}</span>
                      <Badge tone={toWaitlistTone(entry.status)}>{entry.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "settings" ? (
        <div className="space-y-4">
          <SectionCard title="Policy controls" description="Grouped settings with impact context and guarded save flow.">
            {settings ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Last updated: {new Date(settings.updatedAt).toLocaleString()}
              </p>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-[hsl(var(--border))] p-3">
                <h3 className="font-medium">Waitlist mode</h3>
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                  When enabled, new users must join waitlist before registration.
                </p>
                <label className="mt-3 flex items-center gap-2 text-sm">
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
                </label>
              </div>

              <div className="rounded-md border border-[hsl(var(--border))] p-3">
                <h3 className="font-medium">Invitations</h3>
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                  Control invitation availability and whether invited users still go through waitlist.
                </p>
                <label className="mt-3 flex items-center gap-2 text-sm">
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
                </label>
                <label className="mt-2 flex items-center gap-2 text-sm">
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
                </label>
              </div>

              <div className="rounded-md border border-[hsl(var(--border))] p-3 md:col-span-2">
                <FormField
                  label="Invitation quota per user"
                  htmlFor="invitation-quota"
                  helperText="Maximum number of active invites each user can issue."
                >
                  <Input
                    id="invitation-quota"
                    type="number"
                    min={0}
                    value={settingsDraft.invitationQuotaPerUser}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      setSettingsDraft((existing) => ({
                        ...existing,
                        invitationQuotaPerUser: Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0,
                      }));
                    }}
                  />
                </FormField>
              </div>
            </div>

            <DestructiveActionNotice>
              High-impact policy updates (waitlist and invitation mode) should be confirmed before applying.
            </DestructiveActionNotice>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isSavingSettings || !hasSettingsChanges}
                onClick={() => {
                  openConfirm({
                    title: "Save policy settings",
                    description: "Apply policy changes to registration and invitation workflows?",
                    confirmLabel: "Save settings",
                    onConfirm: async () => {
                      await saveSettings();
                    },
                  });
                }}
              >
                Save Settings
              </Button>
              <Button
                variant="outline"
                disabled={!settings}
                onClick={() => {
                  if (!settings) {
                    return;
                  }
                  setSettingsDraft({
                    waitlistEnabled: settings.waitlistEnabled,
                    invitationsEnabled: settings.invitationsEnabled,
                    invitationWaitlistRequired: settings.invitationWaitlistRequired,
                    invitationQuotaPerUser: settings.invitationQuotaPerUser,
                  });
                }}
              >
                Reset Draft
              </Button>
            </div>
          </SectionCard>
        </div>
      ) : null}

      <Drawer
        open={selectedUser !== null}
        title="User detail"
        description="Inspect account state and execute account actions."
        onClose={() => setSelectedUserId(null)}
      >
        {selectedUser ? (
          <div className="space-y-4">
            <div className="rounded-md border border-[hsl(var(--border))] p-3">
              <p className="font-medium">{selectedUser.email}</p>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                {selectedUser.displayName ?? "No display name"}
              </p>
              <div className="mt-2 flex gap-2">
                <Badge tone={toRoleTone(selectedUser.role)}>{selectedUser.role}</Badge>
                <Badge tone={toStatusTone(selectedUser.status)}>{selectedUser.status}</Badge>
              </div>
              <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                Created {new Date(selectedUser.createdAt).toLocaleString()}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busyUserIds.has(selectedUser.id) || selectedUser.status !== "deactivated"}
                onClick={() => {
                  if (!token) {
                    return;
                  }
                  void runUserAction(selectedUser.id, async () => {
                    if (!token) {
                      return;
                    }
                    await activateAdminUser(token, selectedUser.id);
                  }).then(() => {
                    pushToast({
                      tone: "success",
                      title: "User activated",
                      description: `${selectedUser.email} is active again.`,
                    });
                  });
                }}
              >
                Activate
              </Button>

              <Button
                variant="destructive"
                disabled={busyUserIds.has(selectedUser.id) || selectedUser.status === "deactivated"}
                onClick={() => {
                  if (!token) {
                    return;
                  }
                  openConfirm({
                    title: "Deactivate user",
                    description: `Deactivate ${selectedUser.email} for 30 days?`,
                    confirmLabel: "Deactivate",
                    danger: true,
                    onConfirm: async () => {
                      await runUserAction(selectedUser.id, async () => {
                        if (!token) {
                          return;
                        }
                        await deactivateAdminUser(token, selectedUser.id);
                      });
                      pushToast({
                        tone: "warning",
                        title: "User deactivated",
                        description: `${selectedUser.email} is now deactivated.`,
                        actionLabel: "Undo",
                        onAction: async () => {
                          if (!token) {
                            return;
                          }
                          await runUserAction(selectedUser.id, async () => {
                            if (!token) {
                              return;
                            }
                            await activateAdminUser(token, selectedUser.id);
                          });
                        },
                      });
                    },
                  });
                }}
              >
                Deactivate
              </Button>

              <Button
                variant="secondary"
                disabled={busyUserIds.has(selectedUser.id)}
                onClick={() => {
                  if (!token) {
                    return;
                  }
                  void runUserAction(selectedUser.id, async () => {
                    if (!token) {
                      return;
                    }
                    await triggerAdminPasswordReset(token, selectedUser.id);
                  }).then(() => {
                    pushToast({
                      tone: "info",
                      title: "Reset requested",
                      description: `Password reset email sent to ${selectedUser.email}.`,
                    });
                  });
                }}
              >
                Reset Password
              </Button>
            </div>
          </div>
        ) : null}
      </Drawer>

      <Dialog
        open={confirmState !== null}
        title={confirmState?.title ?? "Confirm action"}
        description={confirmState?.description}
        onClose={() => {
          if (confirmBusy) {
            return;
          }
          setConfirmState(null);
        }}
      >
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={confirmBusy}
            onClick={() => {
              setConfirmState(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant={confirmState?.danger ? "destructive" : "default"}
            disabled={confirmBusy}
            onClick={() => {
              void executeConfirm();
            }}
          >
            {confirmState?.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
