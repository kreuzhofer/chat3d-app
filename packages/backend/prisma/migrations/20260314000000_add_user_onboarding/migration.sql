-- Add onboarding tracking fields to users table
ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN generation_count INTEGER NOT NULL DEFAULT 0;
