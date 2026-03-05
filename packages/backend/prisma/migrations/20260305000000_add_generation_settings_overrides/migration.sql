-- CreateTable
CREATE TABLE "generation_settings_overrides" (
    "key" VARCHAR(80) NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_settings_overrides_pkey" PRIMARY KEY ("key")
);
