import { useMemo } from "react";
import { useNotifications } from "../contexts/NotificationsContext";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { EmptyState } from "./layout/EmptyState";
import { PageHeader } from "./layout/PageHeader";
import { SectionCard } from "./layout/SectionCard";

function formatPayload(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return "{}";
  }
}

export function NotificationCenter() {
  const { notifications, unreadCount, connectionState, markAllRead, refreshReplay } = useNotifications();

  const latest = useMemo(() => notifications.slice(0, 25), [notifications]);

  return (
    <section className="space-y-4">
      <PageHeader
        title="Notification Log"
        description="Chronological stream of system and workflow events."
        breadcrumbs={["Workspace", "Notifications"]}
        actions={
          <>
            <Badge tone={connectionState === "open" ? "success" : "warning"}>{connectionState}</Badge>
            <Badge tone={unreadCount > 0 ? "info" : "neutral"}>{unreadCount} unread</Badge>
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void refreshReplay()}>
          Refresh Replay
        </Button>
        <Button variant="secondary" onClick={() => markAllRead()}>
          Mark All Read
        </Button>
      </div>

      <SectionCard title="Latest Events">
        {latest.length === 0 ? (
          <EmptyState title="No notifications yet" description="Events appear here as users and admins perform actions." />
        ) : (
          <ul className="space-y-3">
            {latest.map((notification) => (
              <li key={notification.id} className="rounded-md border border-[hsl(var(--border))] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{notification.eventType}</span>
                  <span className="text-[hsl(var(--muted-foreground))]">
                    #{notification.id} · {new Date(notification.createdAt).toLocaleString()}
                  </span>
                </div>
                <pre className="mt-2 overflow-x-auto rounded bg-[hsl(var(--muted))] p-2 text-xs text-[hsl(var(--foreground))]">
                  {formatPayload(notification.payload)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </section>
  );
}
