import type { Migration } from "./types.js";

export const migration006SecurityEvents: Migration = {
  id: "006_security_events",
  up: [
    `
    CREATE TABLE IF NOT EXISTS security_events (
      id BIGSERIAL PRIMARY KEY,
      event_type VARCHAR(120) NOT NULL,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      ip_address VARCHAR(64),
      path VARCHAR(255),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type);`,
  ],
  down: [
    `DROP TABLE IF EXISTS security_events;`,
  ],
};
