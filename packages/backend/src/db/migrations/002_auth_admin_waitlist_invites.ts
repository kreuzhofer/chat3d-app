import type { Migration } from "./types.js";

export const migration002AuthAdminWaitlistInvites: Migration = {
  id: "002_auth_admin_waitlist_invites",
  up: [
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'user');
      END IF;
    END $$;
    `,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
        CREATE TYPE user_status AS ENUM ('active', 'deactivated', 'pending_registration');
      END IF;
    END $$;
    `,
    `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(255),
      role user_role NOT NULL DEFAULT 'user',
      status user_status NOT NULL DEFAULT 'active',
      deactivated_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`,
    `CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);`,
    `
    CREATE TABLE IF NOT EXISTS app_settings (
      id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
      waitlist_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      invitations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      invitation_waitlist_required BOOLEAN NOT NULL DEFAULT FALSE,
      invitation_quota_per_user INTEGER NOT NULL DEFAULT 3 CHECK (invitation_quota_per_user >= 0),
      updated_by UUID REFERENCES users(id),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'waitlist_status') THEN
        CREATE TYPE waitlist_status AS ENUM ('pending_email_confirmation', 'pending_admin_approval', 'approved', 'rejected');
      END IF;
    END $$;
    `,
    `
    CREATE TABLE IF NOT EXISTS waitlist_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
      email_confirmed_at TIMESTAMPTZ,
      status waitlist_status NOT NULL DEFAULT 'pending_email_confirmation',
      approved_by UUID REFERENCES users(id),
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'registration_token_source') THEN
        CREATE TYPE registration_token_source AS ENUM ('waitlist', 'admin_invite', 'user_invite');
      END IF;
    END $$;
    `,
    `
    CREATE TABLE IF NOT EXISTS registration_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255) NOT NULL,
      source registration_token_source NOT NULL,
      invited_by_user_id UUID REFERENCES users(id),
      max_uses INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_registration_tokens_email ON registration_tokens(email);`,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitation_status') THEN
        CREATE TYPE invitation_status AS ENUM ('pending', 'waitlisted', 'registration_sent', 'accepted', 'expired', 'revoked');
      END IF;
    END $$;
    `,
    `
    CREATE TABLE IF NOT EXISTS invitations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inviter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitee_email VARCHAR(255) NOT NULL,
      status invitation_status NOT NULL DEFAULT 'pending',
      registration_token_id UUID REFERENCES registration_tokens(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (inviter_user_id, invitee_email)
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON invitations(inviter_user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(invitee_email);`,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chat_contexts_owner_fk'
      ) THEN
        ALTER TABLE chat_contexts
          ADD CONSTRAINT chat_contexts_owner_fk
          FOREIGN KEY (owner_id)
          REFERENCES users(id)
          ON DELETE CASCADE;
      END IF;
    END $$;
    `,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chat_items_owner_fk'
      ) THEN
        ALTER TABLE chat_items
          ADD CONSTRAINT chat_items_owner_fk
          FOREIGN KEY (owner_id)
          REFERENCES users(id)
          ON DELETE CASCADE;
      END IF;
    END $$;
    `
  ],
  down: [
    `ALTER TABLE IF EXISTS chat_items DROP CONSTRAINT IF EXISTS chat_items_owner_fk;`,
    `ALTER TABLE IF EXISTS chat_contexts DROP CONSTRAINT IF EXISTS chat_contexts_owner_fk;`,
    `DROP TABLE IF EXISTS invitations;`,
    `DROP TABLE IF EXISTS registration_tokens;`,
    `DROP TABLE IF EXISTS waitlist_entries;`,
    `DROP TABLE IF EXISTS app_settings;`,
    `DROP TABLE IF EXISTS users;`,
    `DROP TYPE IF EXISTS invitation_status;`,
    `DROP TYPE IF EXISTS registration_token_source;`,
    `DROP TYPE IF EXISTS waitlist_status;`,
    `DROP TYPE IF EXISTS user_status;`,
    `DROP TYPE IF EXISTS user_role;`
  ],
};
