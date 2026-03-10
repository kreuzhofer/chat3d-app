import { Outlet } from "react-router-dom";
import {
  KeyRound,
  Lock,
  RotateCcw,
  ShieldOff,
  UserCheck,
} from "lucide-react";
import { AdminProvider, useAdmin, activateAdminUser, deactivateAdminUser, triggerAdminPasswordReset, setAdminUserPassword } from "../../contexts/AdminContext";
import { resetAdminUserOnboarding } from "../../api/admin.api";
import { useAuth } from "../../hooks/useAuth";
import { InlineAlert } from "../../components/layout/InlineAlert";
import { SectionCard } from "../../components/layout/SectionCard";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Drawer } from "../../components/ui/drawer";
import { useToast } from "../../components/ui/toast";
import { toRoleTone, toStatusTone } from "../../components/admin/utils";

function AdminLayoutInner() {
  const { user } = useAuth();
  const { pushToast } = useToast();
  const admin = useAdmin();

  if (!admin.canRender) {
    return (
      <SectionCard title="Admin access required" description="Only authenticated admins can open this control plane.">
        <p className="text-sm">Sign in with an admin account to continue.</p>
      </SectionCard>
    );
  }

  return (
    <section className="space-y-4">
      {admin.error ? <InlineAlert tone="danger">{admin.error}</InlineAlert> : null}
      {admin.isLoading ? <InlineAlert tone="info">Loading admin data...</InlineAlert> : null}

      <Outlet />

      {/* User detail drawer */}
      <Drawer
        open={admin.selectedUser !== null}
        title="User detail"
        description="Inspect account state and execute account actions."
        onClose={() => admin.setSelectedUserId(null)}
      >
        {admin.selectedUser ? (
          <div className="space-y-4">
            <div className="rounded-md border border-[hsl(var(--border))] p-4">
              <div className="flex items-center gap-3">
                <Avatar name={admin.selectedUser.displayName ?? admin.selectedUser.email} size="lg" />
                <div>
                  <p className="font-medium">{admin.selectedUser.email}</p>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    {admin.selectedUser.displayName ?? "No display name"}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Badge tone={toRoleTone(admin.selectedUser.role)}>{admin.selectedUser.role}</Badge>
                <Badge tone={toStatusTone(admin.selectedUser.status)}>{admin.selectedUser.status}</Badge>
              </div>
              <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                Created {new Date(admin.selectedUser.createdAt).toLocaleString()}
              </p>
              <div className="mt-2 flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
                <span>
                  Generations: <strong className="text-[hsl(var(--foreground))]">{admin.selectedUser.generationCount}</strong>
                </span>
                <span>
                  Onboarding:{" "}
                  <strong className={admin.selectedUser.onboardingCompletedAt ? "text-[hsl(var(--success))]" : "text-[hsl(var(--warning))]"}>
                    {admin.selectedUser.onboardingCompletedAt ? "completed" : "pending"}
                  </strong>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                iconLeft={<UserCheck className="h-3.5 w-3.5" />}
                disabled={admin.busyUserIds.has(admin.selectedUser.id) || admin.selectedUser.status !== "deactivated"}
                onClick={() => {
                  if (!admin.token || !admin.selectedUser) return;
                  const su = admin.selectedUser;
                  void admin.runUserAction(su.id, async () => {
                    if (!admin.token) return;
                    await activateAdminUser(admin.token, su.id);
                  }).then(() => {
                    pushToast({ tone: "success", title: "User activated", description: `${su.email} is active again.` });
                  });
                }}
              >
                Activate
              </Button>

              <Button
                variant="destructive"
                iconLeft={<ShieldOff className="h-3.5 w-3.5" />}
                disabled={admin.busyUserIds.has(admin.selectedUser.id) || admin.selectedUser.status === "deactivated" || admin.selectedUser.id === user?.id}
                onClick={() => {
                  if (!admin.token || !admin.selectedUser) return;
                  const su = admin.selectedUser;
                  admin.openConfirm({
                    title: "Deactivate user",
                    description: `Deactivate ${su.email} for 30 days?`,
                    confirmLabel: "Deactivate",
                    danger: true,
                    onConfirm: async () => {
                      await admin.runUserAction(su.id, async () => {
                        if (!admin.token) return;
                        await deactivateAdminUser(admin.token, su.id);
                      });
                      pushToast({
                        tone: "warning",
                        title: "User deactivated",
                        description: `${su.email} is now deactivated.`,
                        actionLabel: "Undo",
                        onAction: async () => {
                          if (!admin.token) return;
                          await admin.runUserAction(su.id, async () => {
                            if (!admin.token) return;
                            await activateAdminUser(admin.token, su.id);
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
                disabled={admin.busyUserIds.has(admin.selectedUser.id)}
                onClick={() => {
                  if (!admin.token || !admin.selectedUser) return;
                  const su = admin.selectedUser;
                  void admin.runUserAction(su.id, async () => {
                    if (!admin.token) return;
                    await triggerAdminPasswordReset(admin.token, su.id);
                  }).then(() => {
                    pushToast({ tone: "info", title: "Reset requested", description: `Password reset email sent to ${su.email}.` });
                  });
                }}
              >
                Reset Password
              </Button>

              <Button
                variant="secondary"
                iconLeft={<Lock className="h-3.5 w-3.5" />}
                disabled={admin.busyUserIds.has(admin.selectedUser.id)}
                onClick={() => {
                  admin.setSetPasswordValue("");
                  admin.setSetPasswordConfirm("");
                  admin.setSetPasswordDialogUserId(admin.selectedUser!.id);
                }}
              >
                Set Password
              </Button>

              <Button
                variant="outline"
                iconLeft={<RotateCcw className="h-3.5 w-3.5" />}
                disabled={admin.busyUserIds.has(admin.selectedUser.id)}
                onClick={() => {
                  if (!admin.token || !admin.selectedUser) return;
                  const su = admin.selectedUser;
                  admin.openConfirm({
                    title: "Reset onboarding",
                    description: `Reset onboarding state and generation counter for ${su.email}? This restores their first-time experience.`,
                    confirmLabel: "Reset",
                    danger: false,
                    onConfirm: async () => {
                      await admin.runUserAction(su.id, async () => {
                        if (!admin.token) return;
                        await resetAdminUserOnboarding(admin.token, su.id);
                      });
                      pushToast({ tone: "success", title: "Onboarding reset", description: `${su.email} will see the first-time experience.` });
                    },
                  });
                }}
              >
                Reset Onboarding
              </Button>
            </div>
          </div>
        ) : null}
      </Drawer>

      {/* Confirm dialog */}
      <Dialog
        open={admin.confirmState !== null}
        title={admin.confirmState?.title ?? "Confirm action"}
        description={admin.confirmState?.description}
        onClose={admin.closeConfirm}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={admin.confirmBusy} onClick={admin.closeConfirm}>
            Cancel
          </Button>
          <Button
            variant={admin.confirmState?.danger ? "destructive" : "default"}
            loading={admin.confirmBusy}
            disabled={admin.confirmBusy}
            onClick={() => void admin.executeConfirm()}
          >
            {admin.confirmState?.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </Dialog>

      {/* Set password dialog */}
      <Dialog
        open={admin.setPasswordDialogUserId !== null}
        title="Set password"
        description={`Set a new password for ${admin.selectedUser?.email ?? "this user"}.`}
        onClose={() => {
          if (admin.confirmBusy) return;
          admin.setSetPasswordDialogUserId(null);
          admin.setSetPasswordValue("");
          admin.setSetPasswordConfirm("");
        }}
      >
        <div className="space-y-4">
          <input
            type="password"
            placeholder="New password (min 8 characters)"
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
            value={admin.setPasswordValue}
            onChange={(e) => admin.setSetPasswordValue(e.target.value)}
            minLength={8}
          />
          <input
            type="password"
            placeholder="Confirm password"
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
            value={admin.setPasswordConfirm}
            onChange={(e) => admin.setSetPasswordConfirm(e.target.value)}
            minLength={8}
          />
          {admin.setPasswordValue.length > 0 && admin.setPasswordConfirm.length > 0 && admin.setPasswordValue !== admin.setPasswordConfirm && (
            <p className="text-sm text-destructive">Passwords do not match.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={admin.confirmBusy}
              onClick={() => {
                admin.setSetPasswordDialogUserId(null);
                admin.setSetPasswordValue("");
                admin.setSetPasswordConfirm("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              loading={admin.confirmBusy}
              disabled={admin.confirmBusy || admin.setPasswordValue.length < 8 || admin.setPasswordValue !== admin.setPasswordConfirm}
              onClick={() => {
                if (!admin.token || !admin.setPasswordDialogUserId) return;
                const targetId = admin.setPasswordDialogUserId;
                const targetEmail = admin.selectedUser?.email ?? "";
                void admin.runUserAction(targetId, async () => {
                  if (!admin.token) return;
                  await setAdminUserPassword(admin.token, targetId, admin.setPasswordValue);
                }).then(() => {
                  pushToast({ tone: "success", title: "Password set", description: `Password updated for ${targetEmail}.` });
                  admin.setSetPasswordDialogUserId(null);
                  admin.setSetPasswordValue("");
                  admin.setSetPasswordConfirm("");
                });
              }}
            >
              Set Password
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}

export function AdminLayout() {
  return (
    <AdminProvider>
      <AdminLayoutInner />
    </AdminProvider>
  );
}
