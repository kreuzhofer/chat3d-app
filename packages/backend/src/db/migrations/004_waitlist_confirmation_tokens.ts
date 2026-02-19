import type { Migration } from "./types.js";

export const migration004WaitlistConfirmationTokens: Migration = {
  id: "004_waitlist_confirmation_tokens",
  up: [
    `
    CREATE TABLE IF NOT EXISTS waitlist_email_confirmations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      waitlist_entry_id UUID NOT NULL REFERENCES waitlist_entries(id) ON DELETE CASCADE,
      token_hash VARCHAR(255) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_waitlist_email_confirmations_entry ON waitlist_email_confirmations(waitlist_entry_id);`,
    `CREATE INDEX IF NOT EXISTS idx_waitlist_email_confirmations_expires ON waitlist_email_confirmations(expires_at);`,
  ],
  down: [
    `DROP TABLE IF EXISTS waitlist_email_confirmations;`,
  ],
};
