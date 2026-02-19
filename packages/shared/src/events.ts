export type SseEventType =
  | "chat.item.updated"
  | "chat.query.state"
  | "notification.created"
  | "admin.settings.updated"
  | "account.status.changed";

export interface SseEventPayload {
  type: SseEventType;
  data: Record<string, unknown>;
  createdAt: string;
}
