-- CreateTable
CREATE TABLE "llm_usage_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "user_id" UUID,
    "chat_context_id" UUID,
    "chat_item_id" UUID,
    "workbench_example_id" UUID,
    "provider_name" VARCHAR(50) NOT NULL,
    "model_id" UUID,
    "model_name" VARCHAR(255) NOT NULL,
    "purpose" VARCHAR(50) NOT NULL,
    "input_tokens" INT NOT NULL DEFAULT 0,
    "output_tokens" INT NOT NULL DEFAULT 0,
    "reasoning_tokens" INT NOT NULL DEFAULT 0,
    "cache_read_tokens" INT NOT NULL DEFAULT 0,
    "cache_write_tokens" INT NOT NULL DEFAULT 0,
    "total_tokens" INT NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(12,8) NOT NULL DEFAULT 0,
    "duration_ms" INT,
    "is_estimated" BOOLEAN DEFAULT false,
    "generation_attempt" INT DEFAULT 1,

    CONSTRAINT "llm_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_usage_events_created" ON "llm_usage_events" ("created_at" DESC);
CREATE INDEX "idx_usage_events_user" ON "llm_usage_events" ("user_id", "created_at");
CREATE INDEX "idx_usage_events_model" ON "llm_usage_events" ("model_name", "created_at");
CREATE INDEX "idx_usage_events_provider" ON "llm_usage_events" ("provider_name", "created_at");
CREATE INDEX "idx_usage_events_purpose" ON "llm_usage_events" ("purpose", "created_at");
CREATE INDEX "idx_usage_events_context" ON "llm_usage_events" ("chat_context_id");

-- AddForeignKey
ALTER TABLE "llm_usage_events" ADD CONSTRAINT "llm_usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "llm_usage_events" ADD CONSTRAINT "llm_usage_events_chat_context_id_fkey" FOREIGN KEY ("chat_context_id") REFERENCES "chat_contexts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "llm_usage_events" ADD CONSTRAINT "llm_usage_events_chat_item_id_fkey" FOREIGN KEY ("chat_item_id") REFERENCES "chat_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
