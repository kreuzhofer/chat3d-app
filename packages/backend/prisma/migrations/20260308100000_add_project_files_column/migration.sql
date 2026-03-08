-- Add current_files JSONB column for multi-file project support (Phase 6 agent mode).
-- Stores the full file map when the project has more than one file.
-- Format: { "main.py": "code...", "components/gear.py": "code..." }
-- When null, the project is single-file and current_code is the only source.
ALTER TABLE code_projects ADD COLUMN current_files JSONB DEFAULT NULL;
