import {
  Activity,
  CheckCircle2,
  Clock,
  ListChecks,
  Shield,
  TrendingUp,
  UserCheck,
  UserMinus,
  UserX,
  Users,
} from "lucide-react";
import type { AdminWaitlistEntry } from "../../api/admin.api";
import { EmptyState } from "../layout/EmptyState";
import { SectionCard } from "../layout/SectionCard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { formatPct, toWaitlistTone, type ConfirmState } from "./utils";

export interface DashboardKpis {
  pendingWaitlistCount: number;
  avgWaitlistApprovalHours: number | null;
  newRegistrations7d: number;
  activeUsers7d: number;
  deactivatedUsersCount: number;
  querySuccessRate24h: number;
  querySuccessRate7d: number;
}

export interface DashboardTabProps {
  kpis: DashboardKpis;
  pendingWaitlistEntries: AdminWaitlistEntry[];
  queueEntry: AdminWaitlistEntry | null;
  token: string | null;
  onSwitchTab: (tab: string) => void;
  onOpenConfirm: (state: ConfirmState) => void;
  onApproveEntry: (entry: AdminWaitlistEntry) => Promise<void>;
  onToggleWaitlist: (currentEnabled: boolean) => void;
  onSetStatusFilter: (filter: string) => void;
  settingsDraftWaitlistEnabled: boolean;
}

export function DashboardTab({
  kpis,
  pendingWaitlistEntries,
  queueEntry,
  token,
  onSwitchTab,
  onOpenConfirm,
  onApproveEntry,
  onToggleWaitlist,
  onSetStatusFilter,
  settingsDraftWaitlistEnabled,
}: DashboardTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <SectionCard title="Pending waitlist" description="Entries awaiting moderation.">
          <div className="flex items-center justify-between">
            <p className="text-3xl font-semibold">{kpis.pendingWaitlistCount}</p>
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${kpis.pendingWaitlistCount > 0 ? "bg-[hsl(var(--warning)_/_0.1)] text-[hsl(var(--warning))]" : "bg-[hsl(var(--success)_/_0.1)] text-[hsl(var(--success))]"}`}>
              <Clock className="h-5 w-5" />
            </div>
          </div>
          {kpis.pendingWaitlistCount > 0 && (
            <div className="mt-2 h-1.5 rounded-full bg-[hsl(var(--muted))]">
              <div
                className="h-full rounded-full bg-[hsl(var(--warning))] transition-all"
                style={{ width: `${Math.min(100, kpis.pendingWaitlistCount * 10)}%` }}
              />
            </div>
          )}
        </SectionCard>
        <SectionCard title="Avg approval time" description="Mean time from join to approval.">
          <div className="flex items-center justify-between">
            <p className="text-3xl font-semibold">
              {kpis.avgWaitlistApprovalHours === null
                ? "n/a"
                : `${kpis.avgWaitlistApprovalHours.toFixed(1)}h`}
            </p>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--info)_/_0.1)] text-[hsl(var(--info))]">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>
        </SectionCard>
        <SectionCard title="New registrations (7d)">
          <div className="flex items-center justify-between">
            <p className="text-3xl font-semibold">{kpis.newRegistrations7d}</p>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]">
              <UserCheck className="h-5 w-5" />
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Active users (7d)">
          <div className="flex items-center justify-between">
            <p className="text-3xl font-semibold">{kpis.activeUsers7d}</p>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--success)_/_0.1)] text-[hsl(var(--success))]">
              <Users className="h-5 w-5" />
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Deactivated users">
          <div className="flex items-center justify-between">
            <p className="text-3xl font-semibold">{kpis.deactivatedUsersCount}</p>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--destructive)_/_0.1)] text-[hsl(var(--destructive))]">
              <UserX className="h-5 w-5" />
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Query success">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-base font-medium">24h: {formatPct(kpis.querySuccessRate24h)}</p>
              <p className="text-base font-medium">7d: {formatPct(kpis.querySuccessRate7d)}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--accent)_/_0.1)] text-[hsl(var(--accent))]">
              <Activity className="h-5 w-5" />
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Quick actions" description="Prioritized operations for user and waitlist workflows.">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            iconLeft={<ListChecks className="h-3.5 w-3.5" />}
            onClick={() => {
              onSwitchTab("waitlist");
            }}
          >
            Review Waitlist
          </Button>
          <Button
            variant="outline"
            iconLeft={<CheckCircle2 className="h-3.5 w-3.5" />}
            disabled={!queueEntry}
            onClick={() => {
              if (!queueEntry || !token) {
                return;
              }
              onOpenConfirm({
                title: "Approve next waitlist entry",
                description: `Approve ${queueEntry.email} and send a registration token email?`,
                confirmLabel: "Approve",
                onConfirm: () => onApproveEntry(queueEntry),
              });
            }}
          >
            Approve Next
          </Button>
          <Button
            variant="outline"
            iconLeft={<UserMinus className="h-3.5 w-3.5" />}
            onClick={() => {
              onSwitchTab("users");
              onSetStatusFilter("deactivated");
            }}
          >
            Open Deactivated Users
          </Button>
          <Button
            variant="destructive"
            iconLeft={<Shield className="h-3.5 w-3.5" />}
            onClick={() => {
              onToggleWaitlist(settingsDraftWaitlistEnabled);
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
  );
}
