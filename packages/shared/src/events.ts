export type SseEventType =
  | "chat.item.updated"
  | "chat.query.state"
  | "notification.created"
  | "admin.settings.updated"
  | "account.status.changed"
  | "workbench.job.progress"
  | "workbench.trace.update";

export interface SseEventPayload {
  type: SseEventType;
  data: Record<string, unknown>;
  createdAt: string;
}
