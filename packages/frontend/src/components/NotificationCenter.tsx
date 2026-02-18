import { useMemo } from "react";
import { useNotifications } from "../contexts/NotificationsContext";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

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
    <section className="space-y-4 bg-[hsl(var(--background))] p-4">
      <header>
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Notification Center</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          SSE status: <span className="font-medium">{connectionState}</span> | Unread:{" "}
          <span className="font-medium">{unreadCount}</span>
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void refreshReplay()}>
          Refresh Replay
        </Button>
        <Button variant="secondary" onClick={() => markAllRead()}>
          Mark All Read
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest Events</CardTitle>
        </CardHeader>
        <CardContent>
          {latest.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">No notifications yet.</p>
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
        </CardContent>
      </Card>
    </section>
  );
}
