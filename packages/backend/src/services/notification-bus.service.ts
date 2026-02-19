import { createClient, type RedisClientType } from "redis";
import { config } from "../config.js";
import type { PersistedNotificationEvent } from "./sse.service.js";

type NotificationHandler = (event: PersistedNotificationEvent) => void;

export class NotificationBusService {
  private readonly handlers = new Set<NotificationHandler>();
  private readonly enabled = config.eventBus.mode === "redis";
  private readonly channel = config.eventBus.channel;
  private publisher: RedisClientType | null = null;
  private subscriber: RedisClientType | null = null;
  private started = false;
  private startPromise: Promise<void> | null = null;

  registerHandler(handler: NotificationHandler): void {
    this.handlers.add(handler);

    if (this.enabled) {
      void this.ensureStarted();
    }
  }

  async publish(event: PersistedNotificationEvent): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    await this.ensureStarted();
    if (!this.publisher) {
      throw new Error("Notification publisher is not initialized");
    }

    await this.publisher.publish(this.channel, JSON.stringify(event));
    return true;
  }

  private async ensureStarted(): Promise<void> {
    if (!this.enabled || this.started) {
      return;
    }

    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = (async () => {
      this.publisher = createClient({
        socket: {
          host: config.redis.host,
          port: config.redis.port,
        },
      });
      this.subscriber = createClient({
        socket: {
          host: config.redis.host,
          port: config.redis.port,
        },
      });

      this.publisher.on("error", (error: unknown) => {
        console.error("[notification-bus] publisher error", error);
      });

      this.subscriber.on("error", (error: unknown) => {
        console.error("[notification-bus] subscriber error", error);
      });

      await this.publisher.connect();
      await this.subscriber.connect();

      await this.subscriber.subscribe(this.channel, (payload: string) => {
        this.handlePayload(payload);
      });
      this.started = true;
      console.log(`[notification-bus] subscribed channel=${this.channel}`);
    })();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private handlePayload(payload: string): void {
    try {
      const parsed = JSON.parse(payload) as Partial<PersistedNotificationEvent>;
      if (
        typeof parsed.id !== "number" ||
        typeof parsed.userId !== "string" ||
        typeof parsed.eventType !== "string" ||
        typeof parsed.payload !== "object" ||
        parsed.payload === null ||
        typeof parsed.createdAt !== "string"
      ) {
        return;
      }

      const event: PersistedNotificationEvent = {
        id: parsed.id,
        userId: parsed.userId,
        eventType: parsed.eventType,
        payload: parsed.payload as Record<string, unknown>,
        createdAt: parsed.createdAt,
        readAt: typeof parsed.readAt === "string" ? parsed.readAt : null,
      };

      for (const handler of this.handlers) {
        handler(event);
      }
    } catch {
      // Ignore malformed payloads from bus channel.
    }
  }
}

export const notificationBus = new NotificationBusService();
