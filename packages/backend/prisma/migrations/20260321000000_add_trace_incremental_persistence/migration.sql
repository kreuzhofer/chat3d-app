-- Add incremental persistence support to generation_traces
ALTER TABLE "generation_traces" ADD COLUMN "prompt_id" VARCHAR(255);
ALTER TABLE "generation_traces" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill updated_at from created_at for existing rows
UPDATE "generation_traces" SET "updated_at" = "created_at";

-- Index for prompt_id lookups
CREATE INDEX "idx_gen_traces_prompt_id" ON "generation_traces"("prompt_id");
