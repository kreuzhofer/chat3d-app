import type { Migration } from "./types.js";

export const migration007WorkbenchTables: Migration = {
  id: "007_workbench_tables",
  up: [
    `
    CREATE TABLE IF NOT EXISTS workbench_categories (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rank        INTEGER NOT NULL UNIQUE,
      name        VARCHAR(255) NOT NULL,
      complexity  INTEGER NOT NULL CHECK (complexity BETWEEN 1 AND 10),
      description TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
    `
    CREATE TABLE IF NOT EXISTS workbench_example_prompts (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category_id  UUID NOT NULL REFERENCES workbench_categories(id) ON DELETE CASCADE,
      index        INTEGER NOT NULL,
      prompt       TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (category_id, index)
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_wb_prompts_category ON workbench_example_prompts(category_id);`,
    `
    CREATE TABLE IF NOT EXISTS workbench_examples (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      prompt_id           UUID NOT NULL REFERENCES workbench_example_prompts(id) ON DELETE CASCADE,
      iteration           INTEGER NOT NULL DEFAULT 1,
      generation_seed     INTEGER,
      code                TEXT NOT NULL,
      render_status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (render_status IN ('pending', 'rendering', 'success', 'error')),
      render_error        TEXT,
      stl_path            TEXT,
      step_path           TEXT,
      threemf_path        TEXT,
      screenshot_front    TEXT,
      screenshot_top      TEXT,
      screenshot_iso      TEXT,
      eval_score          INTEGER CHECK (eval_score BETWEEN 1 AND 10),
      eval_issues         JSONB,
      eval_suggestions    JSONB,
      approval_status     VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (approval_status IN ('pending', 'auto_approved', 'human_approved', 'rejected')),
      rejection_note      TEXT,
      llm_model           VARCHAR(255),
      vlm_model           VARCHAR(255),
      prompt_tokens       INTEGER,
      completion_tokens   INTEGER,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
    `CREATE INDEX IF NOT EXISTS idx_wb_examples_prompt ON workbench_examples(prompt_id);`,
    `CREATE INDEX IF NOT EXISTS idx_wb_examples_approval ON workbench_examples(approval_status);`,
    `CREATE INDEX IF NOT EXISTS idx_wb_examples_eval_score ON workbench_examples(eval_score);`,
    `
    CREATE TABLE IF NOT EXISTS workbench_system_prompts (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      version     INTEGER NOT NULL UNIQUE,
      label       VARCHAR(255) NOT NULL,
      content     TEXT NOT NULL,
      is_active   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
  ],
  down: [
    `DROP TABLE IF EXISTS workbench_examples;`,
    `DROP TABLE IF EXISTS workbench_example_prompts;`,
    `DROP TABLE IF EXISTS workbench_categories;`,
    `DROP TABLE IF EXISTS workbench_system_prompts;`,
  ],
};
