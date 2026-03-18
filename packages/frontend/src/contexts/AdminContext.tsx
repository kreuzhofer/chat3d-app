import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  activateAdminUser,
  approveAdminWaitlistEntry,
  deactivateAdminUser,
  deleteAdminWaitlistEntry,
  getAdminSettings,
  listAdminUsers,
  listAdminWaitlist,
  rejectAdminWaitlistEntry,
  setAdminUserPassword,
  triggerAdminPasswordReset,
  updateAdminSettings,
  type AdminSettings,
  type AdminSettingsPatch,
  type AdminUser,
  type AdminWaitlistEntry,
} from "../api/admin.api";
import { useNotifications } from "./NotificationsContext";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../components/ui/toast";
import {
  toErrorMessage,
  sortUsersByCreatedDate,
  sortWaitlistByCreatedDate,
  type ConfirmState,
} from "../components/admin/utils";

export type UserStatusFilter = "all" | "active" | "deactivated" | "pending_registration";

export interface DashboardKpis {
  pendingWaitlistCount: number;
  avgWaitlistApprovalHours: number | null;
  newRegistrations7d: number;
  activeUsers7d: number;
  deactivatedUsersCount: number;
  querySuccessRate24h: number;
  querySuccessRate7d: number;
}

export interface AdminContextValue {
  // Auth
  token: string | null;
  canRender: boolean;

  // Data
  users: AdminUser[];
  visibleUsers: AdminUser[];
  waitlistEntries: AdminWaitlistEntry[];
  pendingWaitlistEntries: AdminWaitlistEntry[];
  settings: AdminSettings | null;
  dashboardKpis: DashboardKpis;

  // Users state
  search: string;
  setSearch: (value: string) => void;
  statusFilter: UserStatusFilter;
  setStatusFilter: (value: UserStatusFilter) => void;
  selectedUserId: string | null;
  setSelectedUserId: (id: string | null) => void;
  selectedUser: AdminUser | null;
  busyUserIds: Set<string>;
  runUserAction: (userId: string, action: () => Promise<void>) => Promise<void>;

  // Waitlist state
  queueIndex: number;
  setQueueIndex: (index: number) => void;
  queueEntry: AdminWaitlistEntry | null;
  moderationReason: string;
  setModerationReason: (value: string) => void;
  busyWaitlistEntryIds: Set<string>;
  handleApproveEntry: (entry: AdminWaitlistEntry) => Promise<void>;
  handleRejectEntry: (entry: AdminWaitlistEntry) => Promise<void>;
  handleDeleteEntry: (entry: AdminWaitlistEntry) => Promise<void>;

  // Settings state
  settingsDraft: SettingsDraft;
  setSettingsDraft: (draft: SettingsDraft) => void;
  hasSettingsChanges: boolean;
  isSavingSettings: boolean;
  saveSettings: () => Promise<void>;
  handleResetDraft: () => void;
  isTogglingWaitlist: boolean;
  handleDirectToggleWaitlist: (enabled: boolean) => Promise<void>;

  // Shared
  isLoading: boolean;
  error: string | null;
  confirmState: ConfirmState | null;
  openConfirm: (state: ConfirmState) => void;
  confirmBusy: boolean;
  executeConfirm: () => Promise<void>;
  closeConfirm: () => void;

  // Password dialog
  setPasswordDialogUserId: string | null;
  setSetPasswordDialogUserId: (id: string | null) => void;
  setPasswordValue: string;
  setSetPasswordValue: (value: string) => void;
  setPasswordConfirm: string;
  setSetPasswordConfirm: (value: string) => void;
}

interface SettingsDraft {
  waitlistEnabled: boolean;
  invitationsEnabled: boolean;
  invitationWaitlistRequired: boolean;
  invitationQuotaPerUser: number;
  emailConfirmationEnabled: boolean;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const { notifications } = useNotifications();
  const { pushToast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("all");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [waitlistEntries, setWaitlistEntries] = useState<AdminWaitlistEntry[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({
    waitlistEnabled: false,
    invitationsEnabled: true,
    invitationWaitlistRequired: false,
    invitationQuotaPerUser: 3,
    emailConfirmationEnabled: true,
  });
  const [moderationReason, setModerationReason] = useState("");
  const [queueIndex, setQueueIndex] = useState(0);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [setPasswordDialogUserId, setSetPasswordDialogUserId] = useState<string | null>(null);
  const [setPasswordValue, setSetPasswordValue] = useState("");
  const [setPasswordConfirm, setSetPasswordConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isTogglingWaitlist, setIsTogglingWaitlist] = useState(false);
  const [busyUserIds, setBusyUserIds] = useState<Set<string>>(new Set());
  const [busyWaitlistEntryIds, setBusyWaitlistEntryIds] = useState<Set<string>>(new Set());
  const lastHandledNotificationIdRef = useRef<number>(0);

  const canRender = Boolean(token && user?.role === "admin");

  const loadAdminData = useCallback(
    async (searchValue: string) => {
      if (!token) return;
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
          emailConfirmationEnabled: nextSettings.emailConfirmationEnabled,
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
    if (!canRender) return;
    void loadAdminData(search);
  }, [canRender, loadAdminData, search]);

  useEffect(() => {
    if (!canRender || notifications.length === 0) return;
    const latestId = notifications[0].id;
    const hasRelevantEvent = notifications.some(
      (notification) =>
        notification.id > lastHandledNotificationIdRef.current &&
        (notification.eventType === "admin.settings.updated" ||
          notification.eventType === "account.status.changed" ||
          notification.eventType === "waitlist.status.changed"),
    );
    lastHandledNotificationIdRef.current = Math.max(lastHandledNotificationIdRef.current, latestId);
    if (hasRelevantEvent) void loadAdminData(search);
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
      if (!token) return;
      const updated = await updateAdminSettings(token, patch);
      setSettings(updated);
      setSettingsDraft({
        waitlistEnabled: updated.waitlistEnabled,
        invitationsEnabled: updated.invitationsEnabled,
        invitationWaitlistRequired: updated.invitationWaitlistRequired,
        invitationQuotaPerUser: updated.invitationQuotaPerUser,
        emailConfirmationEnabled: updated.emailConfirmationEnabled,
      });
      await loadAdminData(search);
    },
    [loadAdminData, search, token],
  );

  const openConfirm = useCallback((state: ConfirmState) => setConfirmState(state), []);
  const closeConfirm = useCallback(() => { if (!confirmBusy) setConfirmState(null); }, [confirmBusy]);

  const executeConfirm = useCallback(async () => {
    if (!confirmState) return;
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
      if (statusFilter !== "all" && entry.status !== statusFilter) return false;
      if (!search.trim()) return true;
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
    if (queueIndex >= pendingWaitlistEntries.length) setQueueIndex(0);
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
    if (!settings) return false;
    return (
      settings.waitlistEnabled !== settingsDraft.waitlistEnabled ||
      settings.invitationsEnabled !== settingsDraft.invitationsEnabled ||
      settings.invitationWaitlistRequired !== settingsDraft.invitationWaitlistRequired ||
      settings.invitationQuotaPerUser !== settingsDraft.invitationQuotaPerUser ||
      settings.emailConfirmationEnabled !== settingsDraft.emailConfirmationEnabled
    );
  }, [settings, settingsDraft]);

  const saveSettings = useCallback(async () => {
    if (!token || !settings) return;
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
        emailConfirmationEnabled: updated.emailConfirmationEnabled,
      });
      await loadAdminData(search);
      pushToast({ tone: "success", title: "Settings saved", description: "Policy changes are now active." });
    } catch (settingsError) {
      setError(toErrorMessage(settingsError));
    } finally {
      setIsSavingSettings(false);
    }
  }, [loadAdminData, pushToast, search, settings, settingsDraft, token]);

  const handleResetDraft = useCallback(() => {
    if (!settings) return;
    setSettingsDraft({
      waitlistEnabled: settings.waitlistEnabled,
      invitationsEnabled: settings.invitationsEnabled,
      invitationWaitlistRequired: settings.invitationWaitlistRequired,
      invitationQuotaPerUser: settings.invitationQuotaPerUser,
      emailConfirmationEnabled: settings.emailConfirmationEnabled,
    });
  }, [settings]);

  const handleApproveEntry = useCallback(
    async (entry: AdminWaitlistEntry) => {
      await runWaitlistAction(entry.id, async () => {
        if (!token) return;
        await approveAdminWaitlistEntry(token, entry.id);
      });
      pushToast({ tone: "success", title: "Entry approved", description: `${entry.email} can now register.` });
    },
    [pushToast, runWaitlistAction, token],
  );

  const handleRejectEntry = useCallback(
    async (entry: AdminWaitlistEntry) => {
      await runWaitlistAction(entry.id, async () => {
        if (!token) return;
        await rejectAdminWaitlistEntry(token, entry.id);
      });
      pushToast({ tone: "warning", title: "Entry rejected", description: `${entry.email} was rejected from waitlist.` });
    },
    [pushToast, runWaitlistAction, token],
  );

  const handleDeleteEntry = useCallback(
    async (entry: AdminWaitlistEntry) => {
      await runWaitlistAction(entry.id, async () => {
        if (!token) return;
        await deleteAdminWaitlistEntry(token, entry.id);
      });
      pushToast({ tone: "info", title: "Entry deleted", description: `${entry.email} removed from waitlist.` });
    },
    [pushToast, runWaitlistAction, token],
  );

  const handleDirectToggleWaitlist = useCallback(
    async (enabled: boolean) => {
      setIsTogglingWaitlist(true);
      try {
        await applySettingsPatch({ waitlistEnabled: enabled });
        pushToast({ tone: enabled ? "warning" : "info", title: `Waitlist ${enabled ? "enabled" : "disabled"}` });
      } catch (toggleError) {
        setError(toErrorMessage(toggleError));
      } finally {
        setIsTogglingWaitlist(false);
      }
    },
    [applySettingsPatch, pushToast],
  );

  const value = useMemo<AdminContextValue>(
    () => ({
      token,
      canRender,
      users,
      visibleUsers,
      waitlistEntries,
      pendingWaitlistEntries,
      settings,
      dashboardKpis,
      search,
      setSearch,
      statusFilter,
      setStatusFilter,
      selectedUserId,
      setSelectedUserId,
      selectedUser,
      busyUserIds,
      runUserAction,
      queueIndex,
      setQueueIndex,
      queueEntry,
      moderationReason,
      setModerationReason,
      busyWaitlistEntryIds,
      handleApproveEntry,
      handleRejectEntry,
      handleDeleteEntry,
      settingsDraft,
      setSettingsDraft,
      hasSettingsChanges,
      isSavingSettings,
      saveSettings,
      handleResetDraft,
      isTogglingWaitlist,
      handleDirectToggleWaitlist,
      isLoading,
      error,
      confirmState,
      openConfirm,
      confirmBusy,
      executeConfirm,
      closeConfirm,
      setPasswordDialogUserId,
      setSetPasswordDialogUserId,
      setPasswordValue,
      setSetPasswordValue,
      setPasswordConfirm,
      setSetPasswordConfirm,
    }),
    [
      token, canRender, users, visibleUsers, waitlistEntries, pendingWaitlistEntries,
      settings, dashboardKpis, search, statusFilter, selectedUserId, selectedUser,
      busyUserIds, runUserAction, queueIndex, queueEntry, moderationReason,
      busyWaitlistEntryIds, handleApproveEntry, handleRejectEntry, handleDeleteEntry, settingsDraft,
      hasSettingsChanges, isSavingSettings, saveSettings, handleResetDraft,
      isTogglingWaitlist, handleDirectToggleWaitlist, isLoading, error,
      confirmState, openConfirm, confirmBusy, executeConfirm, closeConfirm,
      setPasswordDialogUserId, setPasswordValue, setPasswordConfirm,
    ],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

// Re-export types needed by page components
export type { AdminUser, AdminWaitlistEntry, AdminSettings } from "../api/admin.api";
export type { ConfirmState } from "../components/admin/utils";
export { activateAdminUser, deactivateAdminUser, triggerAdminPasswordReset, setAdminUserPassword } from "../api/admin.api";
