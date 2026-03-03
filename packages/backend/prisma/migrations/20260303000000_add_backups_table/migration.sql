-- CreateTable
CREATE TABLE "backups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" VARCHAR(50) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_path" TEXT NOT NULL,
    "size_bytes" BIGINT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'completed',
    "counts" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_backups_type" ON "backups"("type");

-- CreateIndex
CREATE INDEX "idx_backups_created" ON "backups"("created_at" DESC);
