-- Reconcile the migrations folder with prisma/schema.prisma (issue #90).
--
-- The first run of the test suite against a freshly migrated database found
-- that the migrations do not reproduce the schema the app runs on: the app's
-- database had been changed by hand (or by an earlier knex migration) without
-- a Prisma migration recording it. Everything here is guarded so it applies
-- cleanly both to a fresh database and to the app's own, where it is a no-op.
--
-- Remaining, deliberately untouched, differences `prisma migrate diff` reports:
-- constraint and index *names* from the knex era (fk_* vs *_fkey), and the
-- pgvector / full-text indexes Prisma cannot express in the schema. Neither
-- changes what the client can read or write.

-- The prompt's description column the client selects on every prompt read.
ALTER TABLE "workbench_example_prompts" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- `fewShotCounts Int[] @default([])`
ALTER TABLE "experiment_experiments" ALTER COLUMN "few_shot_counts" SET DEFAULT ARRAY[]::INTEGER[];

-- `language String @default("en")` — required in the schema; backfill any null first.
UPDATE "users" SET "language" = 'en' WHERE "language" IS NULL;
ALTER TABLE "users" ALTER COLUMN "language" SET NOT NULL;

-- 0_init created the (provider, model_name) uniqueness as an INDEX, and the
-- 20260515 migration dropped it as a CONSTRAINT (`DROP CONSTRAINT IF EXISTS`,
-- a no-op on an index), so a freshly migrated database still refused the
-- model variants the app has allowed since then. The schema's uniqueness
-- is (provider, display_name).
DROP INDEX IF EXISTS "llm_models_provider_model_name_key";
