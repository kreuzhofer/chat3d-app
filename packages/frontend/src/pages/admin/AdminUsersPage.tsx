import { useAdmin, type UserStatusFilter } from "../../contexts/AdminContext";
import { UsersTab } from "../../components/admin/UsersTab";

export function AdminUsersPage() {
  const admin = useAdmin();

  return (
    <UsersTab
      users={admin.visibleUsers}
      search={admin.search}
      statusFilter={admin.statusFilter}
      busyUserIds={admin.busyUserIds}
      onSearchChange={admin.setSearch}
      onStatusFilterChange={(value) => admin.setStatusFilter(value as UserStatusFilter)}
      onSelectUser={admin.setSelectedUserId}
    />
  );
}
