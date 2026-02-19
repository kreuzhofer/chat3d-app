import { query } from "../db/connection.js";

export async function recordAdminAuditLog(input: {
  adminUserId: string;
  action: string;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `
    INSERT INTO admin_audit_logs (admin_user_id, action, target_user_id, metadata)
    VALUES ($1, $2, $3, $4::jsonb);
    `,
    [input.adminUserId, input.action, input.targetUserId ?? null, JSON.stringify(input.metadata ?? {})],
  );
}
