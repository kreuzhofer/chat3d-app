import { prisma } from "../db/prisma.js";
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
    await prisma.securityEvent.create({
      data: {
        eventType: input.eventType,
        userId: input.userId ?? null,
        ipAddress: input.ipAddress ?? null,
        path: input.path ?? null,
        metadata: input.metadata ?? {},
      },
    });
  } catch (error) {
    logger.error({ err: error }, "failed to record event");
  }
}
