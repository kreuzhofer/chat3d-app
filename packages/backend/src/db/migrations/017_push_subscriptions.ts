import type { Migration } from "./types.js";

export const migration017PushSubscriptions: Migration = {
  id: "017_push_subscriptions",
  up: [
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, endpoint)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);`,
  ],
  down: [
    `DROP INDEX IF EXISTS idx_push_subscriptions_user_id;`,
    `DROP TABLE IF EXISTS push_subscriptions;`,
  ],
};
