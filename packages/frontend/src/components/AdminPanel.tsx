import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldOff,
  UserCheck,
  Users,
} from "lucide-react";
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
import { InlineAlert } from "./layout/InlineAlert";
import { PageHeader } from "./layout/PageHeader";
import { SectionCard } from "./layout/SectionCard";
import { Avatar } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Drawer } from "./ui/drawer";
import { Tabs } from "./ui/tabs";
import { useToast } from "./ui/toast";
import { DashboardTab } from "./admin/DashboardTab";
import { UsersTab } from "./admin/UsersTab";
import { WaitlistTab } from "./admin/WaitlistTab";
import { SettingsTab } from "./admin/SettingsTab";
import {
  toErrorMessage,
  sortUsersByCreatedDate,
  sortWaitlistByCreatedDate,
  toRoleTone,
  toStatusTone,
  type ConfirmState,
} from "./admin/utils";

type AdminTab = "dashboard" | "users" | "waitlist" | "settings";
type UserStatusFilter = "all" | "active" | "deactivated" | "pending_registration";

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

  const handleApproveEntry = useCallback(
    async (entry: AdminWaitlistEntry) => {
      await runWaitlistAction(entry.id, async () => {
        if (!token) {
          return;
        }
        await approveAdminWaitlistEntry(token, entry.id);
      });
      pushToast({
        tone: "success",
        title: "Entry approved",
        description: `${entry.email} can now register.`,
      });
    },
    [pushToast, runWaitlistAction, token],
  );

  const handleRejectEntry = useCallback(
    async (entry: AdminWaitlistEntry) => {
      await runWaitlistAction(entry.id, async () => {
        if (!token) {
          return;
        }
        await rejectAdminWaitlistEntry(token, entry.id);
      });
      pushToast({
        tone: "warning",
        title: "Entry rejected",
        description: `${entry.email} was rejected from waitlist.`,
      });
    },
    [pushToast, runWaitlistAction, token],
  );

  const handleToggleWaitlist = useCallback(
    (currentEnabled: boolean) => {
      const next = !currentEnabled;
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
              await applySettingsPatch({ waitlistEnabled: currentEnabled });
            },
          });
        },
      });
    },
    [applySettingsPatch, openConfirm, pushToast],
  );

  const handleResetDraft = useCallback(() => {
    if (!settings) {
      return;
    }
    setSettingsDraft({
      waitlistEnabled: settings.waitlistEnabled,
      invitationsEnabled: settings.invitationsEnabled,
      invitationWaitlistRequired: settings.invitationWaitlistRequired,
      invitationQuotaPerUser: settings.invitationQuotaPerUser,
    });
  }, [settings]);

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
          { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
          { id: "users", label: "Users", icon: <Users className="h-4 w-4" /> },
          { id: "waitlist", label: "Waitlist", icon: <ListChecks className="h-4 w-4" /> },
          { id: "settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
        ]}
        activeTab={activeTab}
        onChange={(tabId) => setActiveTab(tabId as AdminTab)}
      />

      {activeTab === "dashboard" ? (
        <DashboardTab
          kpis={dashboardKpis}
          pendingWaitlistEntries={pendingWaitlistEntries}
          queueEntry={queueEntry}
          token={token}
          onSwitchTab={(tab) => setActiveTab(tab as AdminTab)}
          onOpenConfirm={openConfirm}
          onApproveEntry={handleApproveEntry}
          onToggleWaitlist={handleToggleWaitlist}
          onSetStatusFilter={(filter) => setStatusFilter(filter as UserStatusFilter)}
          settingsDraftWaitlistEnabled={settingsDraft.waitlistEnabled}
        />
      ) : null}

      {activeTab === "users" ? (
        <UsersTab
          users={visibleUsers}
          search={search}
          statusFilter={statusFilter}
          busyUserIds={busyUserIds}
          onSearchChange={setSearch}
          onStatusFilterChange={(value) => setStatusFilter(value as UserStatusFilter)}
          onSelectUser={setSelectedUserId}
        />
      ) : null}

      {activeTab === "waitlist" ? (
        <WaitlistTab
          waitlistEntries={waitlistEntries}
          pendingEntries={pendingWaitlistEntries}
          queueEntry={queueEntry}
          queueIndex={queueIndex}
          moderationReason={moderationReason}
          busyWaitlistEntryIds={busyWaitlistEntryIds}
          token={token}
          onQueueIndexChange={setQueueIndex}
          onModerationReasonChange={setModerationReason}
          onOpenConfirm={openConfirm}
          onApproveEntry={handleApproveEntry}
          onRejectEntry={handleRejectEntry}
        />
      ) : null}

      {activeTab === "settings" ? (
        <SettingsTab
          settings={settings}
          draft={settingsDraft}
          hasChanges={hasSettingsChanges}
          isSaving={isSavingSettings}
          onDraftChange={setSettingsDraft}
          onSave={saveSettings}
          onReset={handleResetDraft}
          onOpenConfirm={openConfirm}
        />
      ) : null}

      <Drawer
        open={selectedUser !== null}
        title="User detail"
        description="Inspect account state and execute account actions."
        onClose={() => setSelectedUserId(null)}
      >
        {selectedUser ? (
          <div className="space-y-4">
            <div className="rounded-md border border-[hsl(var(--border))] p-4">
              <div className="flex items-center gap-3">
                <Avatar name={selectedUser.displayName ?? selectedUser.email} size="lg" />
                <div>
                  <p className="font-medium">{selectedUser.email}</p>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    {selectedUser.displayName ?? "No display name"}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
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
                iconLeft={<UserCheck className="h-3.5 w-3.5" />}
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
                iconLeft={<ShieldOff className="h-3.5 w-3.5" />}
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
                iconLeft={<KeyRound className="h-3.5 w-3.5" />}
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
            loading={confirmBusy}
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
