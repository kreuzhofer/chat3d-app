import type { Migration } from "./types.js";

export const migration003NotificationsAccountLifecycle: Migration = {
  id: "003_notifications_account_lifecycle",
  up: [
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_action_type') THEN
        CREATE TYPE account_action_type AS ENUM ('password_reset', 'email_change', 'data_export', 'account_delete', 'account_reactivate');
      END IF;
    END $$;
    `,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_action_status') THEN
        CREATE TYPE account_action_status AS ENUM ('pending', 'completed', 'expired', 'cancelled');
      END IF;
    END $$;
    `,
    `
    CREATE TABLE IF NOT EXISTS account_actions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action_type account_action_type NOT NULL,
      token_hash VARCHAR(255) UNIQUE NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status account_action_status NOT NULL DEFAULT 'pending',
      expires_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_account_actions_user ON account_actions(user_id);`,
    `
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type VARCHAR(100) NOT NULL,
      payload JSONB NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);`
  ],
  down: [
    `DROP TABLE IF EXISTS notifications;`,
    `DROP TABLE IF EXISTS account_actions;`,
    `DROP TYPE IF EXISTS account_action_status;`,
    `DROP TYPE IF EXISTS account_action_type;`
  ],
};
