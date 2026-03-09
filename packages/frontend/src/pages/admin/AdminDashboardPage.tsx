import { useNavigate } from "react-router-dom";
import { useAdmin, type UserStatusFilter } from "../../contexts/AdminContext";
import { PageHeader } from "../../components/layout/PageHeader";
import { Badge } from "../../components/ui/badge";
import { DashboardTab } from "../../components/admin/DashboardTab";

export function AdminDashboardPage() {
  const navigate = useNavigate();
  const admin = useAdmin();

  const tabRoutes: Record<string, string> = {
    users: "/admin/users",
    waitlist: "/admin/waitlist",
    settings: "/admin/settings",
    providers: "/admin/providers",
    models: "/admin/models",
    generation: "/admin/generation",
    curation: "/admin/curation",
    knowledge: "/admin/knowledge",
    "cost-analysis": "/admin/costs",
  };

  return (
    <>
      <PageHeader
        title="Admin Control Center"
        description="User operations, waitlist moderation, and policy controls in one task-oriented surface."
        breadcrumbs={["Workspace", "Admin"]}
        actions={
          <>
            <Badge tone="warning">{admin.pendingWaitlistEntries.length} pending waitlist</Badge>
            <Badge tone="info">{admin.users.length} users</Badge>
          </>
        }
      />
      <DashboardTab
        kpis={admin.dashboardKpis}
        pendingWaitlistEntries={admin.pendingWaitlistEntries}
        queueEntry={admin.queueEntry}
        token={admin.token}
        onSwitchTab={(tab) => navigate(tabRoutes[tab] ?? "/admin")}
        onOpenConfirm={admin.openConfirm}
        onApproveEntry={admin.handleApproveEntry}
        onToggleWaitlist={(enabled) => void admin.handleDirectToggleWaitlist(enabled)}
        onSetStatusFilter={(filter) => admin.setStatusFilter(filter as UserStatusFilter)}
        settingsDraftWaitlistEnabled={admin.settingsDraft.waitlistEnabled}
      />
    </>
  );
}
