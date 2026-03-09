import { useAdmin } from "../../contexts/AdminContext";
import { SettingsTab } from "../../components/admin/SettingsTab";

export function AdminSettingsPage() {
  const admin = useAdmin();

  return (
    <SettingsTab
      settings={admin.settings}
      draft={admin.settingsDraft}
      hasChanges={admin.hasSettingsChanges}
      isSaving={admin.isSavingSettings}
      onDraftChange={admin.setSettingsDraft}
      onSave={() => void admin.saveSettings()}
      onReset={admin.handleResetDraft}
      onOpenConfirm={admin.openConfirm}
    />
  );
}
