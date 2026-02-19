import { query } from "../db/connection.js";
import { notificationBus } from "./notification-bus.service.js";
import { sseService, type PersistedNotificationEvent } from "./sse.service.js";

interface NotificationRow {
  id: number;
  user_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

interface ListNotificationsOptions {
  afterId?: number;
  limit?: number;
}

function mapNotificationRow(row: NotificationRow): PersistedNotificationEvent {
  return {
    id: row.id,
    userId: row.user_id,
    eventType: row.event_type,
    payload: row.payload,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export class NotificationService {
  constructor() {
    notificationBus.registerHandler((event) => {
      sseService.publishToUser(event);
    });
  }

  async createNotification(
    userId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<PersistedNotificationEvent> {
    const result = await query<NotificationRow>(
      `
      INSERT INTO notifications (user_id, event_type, payload)
      VALUES ($1, $2, $3::jsonb)
      RETURNING id, user_id, event_type, payload, read_at, created_at;
      `,
      [userId, eventType, JSON.stringify(payload)],
    );

    return mapNotificationRow(result.rows[0]);
  }

  async listNotificationsForUser(
    userId: string,
    options: ListNotificationsOptions = {},
  ): Promise<PersistedNotificationEvent[]> {
    const afterId = options.afterId ?? 0;
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));

    const result = await query<NotificationRow>(
      `
      SELECT id, user_id, event_type, payload, read_at, created_at
      FROM notifications
      WHERE user_id = $1
        AND id > $2
      ORDER BY id ASC
      LIMIT $3;
      `,
      [userId, afterId, limit],
    );

    return result.rows.map(mapNotificationRow);
  }

  async publishToUser(
    userId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<PersistedNotificationEvent> {
    const notification = await this.createNotification(userId, eventType, payload);
    const publishedViaBus = await notificationBus.publish(notification);
    if (!publishedViaBus) {
      sseService.publishToUser(notification);
    }
    return notification;
  }
}

export const notificationService = new NotificationService();
