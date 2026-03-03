-- AlterTable
ALTER TABLE "workbench_examples" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex (partial index: only index rows where featured = true)
CREATE INDEX "idx_wb_examples_featured" ON "workbench_examples"("featured") WHERE "featured" = true;
