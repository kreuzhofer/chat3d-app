-- Replace single category_id with category_ids array for multi-category experiments

-- Add new array column and backfill from existing single category
ALTER TABLE "experiment_experiments" ADD COLUMN "category_ids" text[] NOT NULL DEFAULT '{}';
UPDATE "experiment_experiments" SET "category_ids" = ARRAY["category_id"::text];

-- Drop old single-category FK, index, and column
ALTER TABLE "experiment_experiments" DROP CONSTRAINT "fk_experiments_category";
DROP INDEX "idx_experiments_category";
ALTER TABLE "experiment_experiments" DROP COLUMN "category_id";
