-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "language" VARCHAR(5) DEFAULT 'en';
