import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  XCircle,
} from "lucide-react";
import type { AdminWaitlistEntry } from "../../api/admin.api";
import { EmptyState } from "../layout/EmptyState";
import { SectionCard } from "../layout/SectionCard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { FormField } from "../ui/form";
import { Textarea } from "../ui/textarea";
import { toWaitlistTone, type ConfirmState } from "./utils";

export interface WaitlistTabProps {
  waitlistEntries: AdminWaitlistEntry[];
  pendingEntries: AdminWaitlistEntry[];
  queueEntry: AdminWaitlistEntry | null;
  queueIndex: number;
  moderationReason: string;
  busyWaitlistEntryIds: Set<string>;
  token: string | null;
  onQueueIndexChange: (index: number) => void;
  onModerationReasonChange: (value: string) => void;
  onOpenConfirm: (state: ConfirmState) => void;
  onApproveEntry: (entry: AdminWaitlistEntry) => Promise<void>;
  onRejectEntry: (entry: AdminWaitlistEntry) => Promise<void>;
}

export function WaitlistTab({
  waitlistEntries,
  pendingEntries,
  queueEntry,
  queueIndex,
  moderationReason,
  busyWaitlistEntryIds,
  token,
  onQueueIndexChange,
  onModerationReasonChange,
  onOpenConfirm,
  onApproveEntry,
  onRejectEntry,
}: WaitlistTabProps) {
  return (
    <div className="space-y-4">
      <SectionCard title="Moderation queue" description="Single-item moderation workflow (bulk is intentionally deferred).">
        {!queueEntry ? (
          <EmptyState title="Queue empty" description="No waitlist entries are pending admin approval." />
        ) : (
          <div className="space-y-3">
            {/* Queue depth indicator */}
            <div className="flex items-center gap-3 rounded-md bg-[hsl(var(--muted)_/_0.5)] px-3 py-2 text-sm">
              <span className="font-medium text-[hsl(var(--foreground))]">
                {queueIndex + 1} of {pendingEntries.length}
              </span>
              <div className="flex-1">
                <div className="h-1.5 rounded-full bg-[hsl(var(--muted))]">
                  <div
                    className="h-full rounded-full bg-[hsl(var(--primary))] transition-all"
                    style={{ width: `${((queueIndex + 1) / pendingEntries.length) * 100}%` }}
                  />
                </div>
              </div>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">entries pending</span>
            </div>

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
                onChange={(event) => onModerationReasonChange(event.target.value)}
                rows={3}
                placeholder="Optional note for this moderation decision"
              />
            </FormField>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                iconLeft={<CheckCircle2 className="h-3.5 w-3.5" />}
                disabled={busyWaitlistEntryIds.has(queueEntry.id)}
                onClick={() => {
                  if (!token) {
                    return;
                  }
                  onOpenConfirm({
                    title: "Approve waitlist entry",
                    description: `Approve ${queueEntry.email} and issue registration token?`,
                    confirmLabel: "Approve",
                    onConfirm: () => onApproveEntry(queueEntry),
                  });
                }}
              >
                Approve
              </Button>
              <Button
                variant="destructive"
                iconLeft={<XCircle className="h-3.5 w-3.5" />}
                disabled={busyWaitlistEntryIds.has(queueEntry.id)}
                onClick={() => {
                  if (!token) {
                    return;
                  }
                  onOpenConfirm({
                    title: "Reject waitlist entry",
                    description: `Reject ${queueEntry.email}${moderationReason.trim() ? ` (reason: ${moderationReason.trim()})` : ""}?`,
                    confirmLabel: "Reject",
                    danger: true,
                    onConfirm: () => onRejectEntry(queueEntry),
                  });
                }}
              >
                Reject
              </Button>
              <Button
                variant="outline"
                iconLeft={<ChevronLeft className="h-3.5 w-3.5" />}
                disabled={queueIndex <= 0}
                onClick={() => onQueueIndexChange(Math.max(0, queueIndex - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                iconRight={<ChevronRight className="h-3.5 w-3.5" />}
                disabled={queueIndex >= pendingEntries.length - 1}
                onClick={() => onQueueIndexChange(Math.min(pendingEntries.length - 1, queueIndex + 1))}
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
  );
}
