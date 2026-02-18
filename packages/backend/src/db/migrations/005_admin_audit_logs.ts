import type { Migration } from "./types.js";

export const migration005AdminAuditLogs: Migration = {
  id: "005_admin_audit_logs",
  up: [
    `
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action VARCHAR(120) NOT NULL,
      target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_created ON admin_audit_logs(admin_user_id, created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target_created ON admin_audit_logs(target_user_id, created_at DESC);`,
  ],
  down: [
    `DROP TABLE IF EXISTS admin_audit_logs;`,
  ],
};
