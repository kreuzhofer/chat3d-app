import { prisma } from "../db/prisma.js";
import { notificationBus } from "./notification-bus.service.js";
import { sseService, type PersistedNotificationEvent } from "./sse.service.js";

interface ListNotificationsOptions {
  afterId?: number;
  limit?: number;
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
    const row = await prisma.notification.create({
      data: { userId, eventType, payload },
    });

    return {
      id: Number(row.id),
      userId: row.userId,
      eventType: row.eventType,
      payload: row.payload as Record<string, unknown>,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listNotificationsForUser(
    userId: string,
    options: ListNotificationsOptions = {},
  ): Promise<PersistedNotificationEvent[]> {
    const afterId = options.afterId ?? 0;
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));

    const rows = await prisma.notification.findMany({
      where: { userId, id: { gt: afterId } },
      orderBy: { id: "asc" },
      take: limit,
    });

    return rows.map((row) => ({
      id: Number(row.id),
      userId: row.userId,
      eventType: row.eventType,
      payload: row.payload as Record<string, unknown>,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
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
