import type { NotificationRecord } from "../contexts/NotificationsContext";

const EVENTS_API_BASE = "/api/events";

export async function fetchNotificationReplay(
  token: string,
  afterId?: number,
): Promise<NotificationRecord[]> {
  const search = new URLSearchParams();
  if (afterId !== undefined) {
    search.set("afterId", String(afterId));
  }

  const response = await fetch(`${EVENTS_API_BASE}/replay?${search.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Failed to load replay";
    throw new Error(message);
  }

  return Array.isArray(body.notifications) ? (body.notifications as NotificationRecord[]) : [];
}
