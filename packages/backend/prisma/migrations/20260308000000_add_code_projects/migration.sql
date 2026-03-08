-- Code projects: tracks the current working code per chat context
CREATE TABLE code_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_context_id UUID NOT NULL UNIQUE REFERENCES chat_contexts(id) ON DELETE CASCADE,
  current_code TEXT NOT NULL DEFAULT '',
  last_rendered_item_id UUID REFERENCES chat_items(id) ON DELETE SET NULL,
  file_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Code project versions: version history per project
CREATE TABLE code_project_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES code_projects(id) ON DELETE CASCADE,
  chat_item_id UUID REFERENCES chat_items(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_code_project_versions_project ON code_project_versions(project_id);

-- Data migration tracking (for non-SQL migrations like file moves)
CREATE TABLE data_migrations (
  name VARCHAR(255) PRIMARY KEY,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
