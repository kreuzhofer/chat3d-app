import { Search } from "lucide-react";
import type { AdminUser } from "../../api/admin.api";
import { EmptyState } from "../layout/EmptyState";
import { SectionCard } from "../layout/SectionCard";
import { Avatar } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { FormField } from "../ui/form";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { toRoleTone, toStatusTone } from "./utils";

export interface UsersTabProps {
  users: AdminUser[];
  search: string;
  statusFilter: string;
  busyUserIds: Set<string>;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onSelectUser: (userId: string) => void;
}

export function UsersTab({
  users,
  search,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onSelectUser,
}: UsersTabProps) {
  return (
    <div className="space-y-4">
      <SectionCard title="User management" description="Filter users, inspect details, and execute account actions.">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <FormField label="Search" htmlFor="user-search">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <Input
                id="user-search"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search by email or display name"
                className="pl-9"
              />
            </div>
          </FormField>
          <FormField label="Status filter" htmlFor="status-filter">
            <Select
              id="status-filter"
              value={statusFilter}
              onChange={(event) => onStatusFilterChange(event.target.value)}
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "Active" },
                { value: "deactivated", label: "Deactivated" },
                { value: "pending_registration", label: "Pending registration" },
              ]}
            />
          </FormField>
        </div>

        {users.length === 0 ? (
          <EmptyState title="No matching users" description="Adjust filters or search terms." />
        ) : (
          <ul className="space-y-2">
            {users.map((entry) => (
              <li key={entry.id} className="rounded-md border border-[hsl(var(--border))] p-3 transition hover:border-[hsl(var(--primary)_/_0.3)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={entry.displayName ?? entry.email} size="sm" />
                    <div>
                      <p className="font-medium">{entry.email}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        {entry.displayName ?? "No display name"} · joined {new Date(entry.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={toRoleTone(entry.role)}>{entry.role}</Badge>
                    <Badge tone={toStatusTone(entry.status)}>{entry.status}</Badge>
                    <Button size="sm" variant="outline" onClick={() => onSelectUser(entry.id)}>
                      Open
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
