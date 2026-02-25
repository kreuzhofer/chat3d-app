import { query } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("security-audit");

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
    logger.error({ err: error }, "failed to record event");
  }
}
