import type { Request, Response } from "express";

export interface PersistedNotificationEvent {
  id: number;
  userId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

interface SseClient {
  userId: string;
  response: Response;
  heartbeatTimer: NodeJS.Timeout;
}

interface ConnectOptions {
  request: Request;
  response: Response;
  userId: string;
  replayEvents?: PersistedNotificationEvent[];
}

export class SseService {
  private readonly clientsByUser = new Map<string, Set<SseClient>>();

  constructor(private readonly heartbeatIntervalMs = 25000) {}

  connect({ request, response, userId, replayEvents = [] }: ConnectOptions): void {
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");

    const client: SseClient = {
      userId,
      response,
      heartbeatTimer: setInterval(() => {
        response.write(": heartbeat\\n\\n");
      }, this.heartbeatIntervalMs),
    };

    this.addClient(client);

    response.write(": connected\\n\\n");

    for (const replayEvent of replayEvents) {
      this.sendToClient(client, replayEvent);
    }

    request.on("close", () => {
      this.removeClient(client);
    });
  }

  publishToUser(event: PersistedNotificationEvent): void {
    const clients = this.clientsByUser.get(event.userId);
    if (!clients || clients.size === 0) {
      return;
    }

    for (const client of clients) {
      this.sendToClient(client, event);
    }
  }

  private addClient(client: SseClient): void {
    const clients = this.clientsByUser.get(client.userId);
    if (clients) {
      clients.add(client);
      return;
    }

    this.clientsByUser.set(client.userId, new Set([client]));
  }

  private removeClient(client: SseClient): void {
    clearInterval(client.heartbeatTimer);

    const clients = this.clientsByUser.get(client.userId);
    if (!clients) {
      return;
    }

    clients.delete(client);
    if (clients.size === 0) {
      this.clientsByUser.delete(client.userId);
    }
  }

  private sendToClient(client: SseClient, event: PersistedNotificationEvent): void {
    const payload = JSON.stringify({
      notificationId: event.id,
      eventType: event.eventType,
      payload: event.payload,
      createdAt: event.createdAt,
    });

    client.response.write(`id: ${event.id}\\n`);
    client.response.write(`event: ${event.eventType}\\n`);
    client.response.write(`data: ${payload}\\n\\n`);
  }
}

export const sseService = new SseService();
