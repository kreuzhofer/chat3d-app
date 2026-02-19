import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "../contexts/NotificationsContext";
import { EmptyState } from "./layout/EmptyState";
import { PageHeader } from "./layout/PageHeader";
import { SectionCard } from "./layout/SectionCard";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

function formatPayload(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return "{}";
  }
}

type NotificationDomain = "all" | "chat" | "admin" | "account" | "invitation" | "system";

function classifyDomain(eventType: string): NotificationDomain {
  if (eventType.startsWith("chat.")) {
    return "chat";
  }
  if (eventType.startsWith("admin.") || eventType.startsWith("waitlist.")) {
    return "admin";
  }
  if (eventType.startsWith("account.") || eventType.startsWith("profile.")) {
    return "account";
  }
  if (eventType.startsWith("invitation.")) {
    return "invitation";
  }
  return "system";
}

function resolveDeepLink(eventType: string, payload: Record<string, unknown>): string | null {
  const contextId = typeof payload.contextId === "string" ? payload.contextId : null;
  if (contextId) {
    return `/chat/${encodeURIComponent(contextId)}`;
  }

  if (eventType.startsWith("admin.") || eventType.startsWith("waitlist.")) {
    return "/admin";
  }

  if (eventType.startsWith("account.") || eventType.startsWith("profile.")) {
    return "/profile";
  }

  if (eventType.startsWith("invitation.")) {
    return "/profile";
  }

  return null;
}

export function NotificationCenter() {
  const navigate = useNavigate();
  const { notifications, unreadCount, connectionState, markAllRead, refreshReplay } = useNotifications();
  const [domainFilter, setDomainFilter] = useState<NotificationDomain>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return notifications
      .filter((notification) => {
        if (domainFilter === "all") {
          return true;
        }

        return classifyDomain(notification.eventType) === domainFilter;
      })
      .filter((notification) => {
        if (!normalizedQuery) {
          return true;
        }

        const payloadText = formatPayload(notification.payload).toLowerCase();
        return (
          notification.eventType.toLowerCase().includes(normalizedQuery) ||
          payloadText.includes(normalizedQuery)
        );
      })
      .slice(0, 100);
  }, [domainFilter, notifications, query]);

  const domainCounts = useMemo(() => {
    const counts: Record<NotificationDomain, number> = {
      all: notifications.length,
      chat: 0,
      admin: 0,
      account: 0,
      invitation: 0,
      system: 0,
    };

    for (const notification of notifications) {
      counts[classifyDomain(notification.eventType)] += 1;
    }

    return counts;
  }, [notifications]);

  return (
    <section className="space-y-4">
      <PageHeader
        title="Notification Inbox"
        description="Actionable chronological event log with filters and deep links."
        breadcrumbs={["Workspace", "Notifications"]}
        actions={
          <>
            <Badge tone={connectionState === "open" ? "success" : "warning"}>SSE {connectionState}</Badge>
            <Badge tone={unreadCount > 0 ? "info" : "neutral"}>{unreadCount} unread</Badge>
          </>
        }
      />

      <SectionCard
        title="Controls"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void refreshReplay()}>
              Refresh Replay
            </Button>
            <Button variant="secondary" onClick={() => markAllRead()}>
              Mark All Read
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search event type or payload"
          />
          <select
            value={domainFilter}
            onChange={(event) => setDomainFilter(event.target.value as NotificationDomain)}
            className="h-9 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-white px-2 text-sm"
          >
            <option value="all">All ({domainCounts.all})</option>
            <option value="chat">Chat ({domainCounts.chat})</option>
            <option value="admin">Admin ({domainCounts.admin})</option>
            <option value="account">Account ({domainCounts.account})</option>
            <option value="invitation">Invitation ({domainCounts.invitation})</option>
            <option value="system">System ({domainCounts.system})</option>
          </select>
        </div>
      </SectionCard>

      <SectionCard title="Event stream">
        {filtered.length === 0 ? (
          <EmptyState title="No matching notifications" description="Adjust filters or search query." />
        ) : (
          <ul className="space-y-3">
            {filtered.map((notification) => {
              const domain = classifyDomain(notification.eventType);
              const deepLink = resolveDeepLink(notification.eventType, notification.payload);

              return (
                <li key={notification.id} className="rounded-md border border-[hsl(var(--border))] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{notification.eventType}</span>
                      <Badge tone="neutral">{domain}</Badge>
                    </div>
                    <span className="text-[hsl(var(--muted-foreground))]">
                      #{notification.id} · {new Date(notification.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <pre className="mt-2 overflow-x-auto rounded bg-[hsl(var(--muted))] p-2 text-xs text-[hsl(var(--foreground))]">
                    {formatPayload(notification.payload)}
                  </pre>

                  {deepLink ? (
                    <div className="mt-2">
                      <Button size="sm" variant="outline" onClick={() => navigate(deepLink)}>
                        Open Related View
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </section>
  );
}
