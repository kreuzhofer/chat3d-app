import type { Migration } from "./types.js";

export const migration001InitialSchema: Migration = {
  id: "001_initial_schema",
  up: [
    `CREATE EXTENSION IF NOT EXISTS pgcrypto;`,
    `
    CREATE TABLE IF NOT EXISTS chat_contexts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL DEFAULT 'unnamed chat',
      conversation_model_id VARCHAR(255),
      chat_3d_model_id VARCHAR(255),
      owner_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_chat_contexts_owner ON chat_contexts(owner_id);`,
    `
    CREATE TABLE IF NOT EXISTS chat_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      chat_context_id UUID NOT NULL REFERENCES chat_contexts(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      rating INTEGER NOT NULL DEFAULT 0 CHECK (rating IN (-1, 0, 1)),
      owner_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_chat_items_context ON chat_items(chat_context_id);`,
    `CREATE INDEX IF NOT EXISTS idx_chat_items_owner ON chat_items(owner_id);`
  ],
  down: [
    `DROP TABLE IF EXISTS chat_items;`,
    `DROP TABLE IF EXISTS chat_contexts;`
  ],
};
