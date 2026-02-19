import { query } from "../db/connection.js";

export async function recordSecurityEvent(input: {
  eventType: string;
  userId?: string | null;
  ipAddress?: string | null;
  path?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await query(
      `
      INSERT INTO security_events (event_type, user_id, ip_address, path, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb);
      `,
      [
        input.eventType,
        input.userId ?? null,
        input.ipAddress ?? null,
        input.path ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  } catch (error) {
    console.error("[security-audit] failed to record event", error);
  }
}
