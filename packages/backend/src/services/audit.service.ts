import { prisma } from "../db/prisma.js";

export async function recordAdminAuditLog(input: {
  adminUserId: string;
  action: string;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      adminUserId: input.adminUserId,
      action: input.action,
      targetUserId: input.targetUserId ?? null,
      metadata: input.metadata ?? {},
    },
  });
}
