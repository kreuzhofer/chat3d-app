import { useAdmin } from "../../contexts/AdminContext";
import { WaitlistTab } from "../../components/admin/WaitlistTab";

export function AdminWaitlistPage() {
  const admin = useAdmin();

  return (
    <WaitlistTab
      waitlistEntries={admin.waitlistEntries}
      pendingEntries={admin.pendingWaitlistEntries}
      queueEntry={admin.queueEntry}
      queueIndex={admin.queueIndex}
      moderationReason={admin.moderationReason}
      busyWaitlistEntryIds={admin.busyWaitlistEntryIds}
      token={admin.token}
      waitlistEnabled={admin.settingsDraft.waitlistEnabled}
      isTogglingWaitlist={admin.isTogglingWaitlist}
      onToggleWaitlist={(enabled) => void admin.handleDirectToggleWaitlist(enabled)}
      onQueueIndexChange={admin.setQueueIndex}
      onModerationReasonChange={admin.setModerationReason}
      onOpenConfirm={admin.openConfirm}
      onApproveEntry={admin.handleApproveEntry}
      onRejectEntry={admin.handleRejectEntry}
      onDeleteEntry={admin.handleDeleteEntry}
    />
  );
}
