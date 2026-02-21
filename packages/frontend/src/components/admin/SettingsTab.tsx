import { RotateCcw, Save } from "lucide-react";
import type { AdminSettings } from "../../api/admin.api";
import { SectionCard } from "../layout/SectionCard";
import { Button } from "../ui/button";
import { DestructiveActionNotice, FormField } from "../ui/form";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import type { ConfirmState } from "./utils";

export interface SettingsDraft {
  waitlistEnabled: boolean;
  invitationsEnabled: boolean;
  invitationWaitlistRequired: boolean;
  invitationQuotaPerUser: number;
}

export interface SettingsTabProps {
  settings: AdminSettings | null;
  draft: SettingsDraft;
  hasChanges: boolean;
  isSaving: boolean;
  onDraftChange: (draft: SettingsDraft) => void;
  onSave: () => void;
  onReset: () => void;
  onOpenConfirm: (state: ConfirmState) => void;
}

export function SettingsTab({
  settings,
  draft,
  hasChanges,
  isSaving,
  onDraftChange,
  onSave,
  onReset,
  onOpenConfirm,
}: SettingsTabProps) {
  return (
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
                checked={draft.waitlistEnabled}
                onCheckedChange={(checked) =>
                  onDraftChange({
                    ...draft,
                    waitlistEnabled: checked,
                  })
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
                checked={draft.invitationsEnabled}
                onCheckedChange={(checked) =>
                  onDraftChange({
                    ...draft,
                    invitationsEnabled: checked,
                  })
                }
              />
              Enable invitations
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <Switch
                checked={draft.invitationWaitlistRequired}
                onCheckedChange={(checked) =>
                  onDraftChange({
                    ...draft,
                    invitationWaitlistRequired: checked,
                  })
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
                value={draft.invitationQuotaPerUser}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  onDraftChange({
                    ...draft,
                    invitationQuotaPerUser: Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0,
                  });
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
            iconLeft={<Save className="h-3.5 w-3.5" />}
            loading={isSaving}
            disabled={isSaving || !hasChanges}
            onClick={() => {
              onOpenConfirm({
                title: "Save policy settings",
                description: "Apply policy changes to registration and invitation workflows?",
                confirmLabel: "Save settings",
                onConfirm: async () => {
                  onSave();
                },
              });
            }}
          >
            Save Settings
          </Button>
          <Button
            variant="outline"
            iconLeft={<RotateCcw className="h-3.5 w-3.5" />}
            disabled={!settings}
            onClick={() => onReset()}
          >
            Reset Draft
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
