-- CreateTable
CREATE TABLE "generation_traces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workbench_example_id" UUID,
    "chat_item_id" UUID,
    "total_duration_ms" INTEGER,
    "total_cost_usd" DECIMAL(12,8),
    "total_steps" INTEGER,
    "total_llm_calls" INTEGER,
    "final_status" VARCHAR(20) NOT NULL,
    "pipeline_type" VARCHAR(20) NOT NULL,
    "trace" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_traces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "generation_traces_workbench_example_id_key" ON "generation_traces"("workbench_example_id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_traces_chat_item_id_key" ON "generation_traces"("chat_item_id");

-- CreateIndex
CREATE INDEX "idx_gen_traces_wb_example" ON "generation_traces"("workbench_example_id");

-- CreateIndex
CREATE INDEX "idx_gen_traces_chat_item" ON "generation_traces"("chat_item_id");

-- CreateIndex
CREATE INDEX "idx_gen_traces_created" ON "generation_traces"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "generation_traces" ADD CONSTRAINT "generation_traces_workbench_example_id_fkey" FOREIGN KEY ("workbench_example_id") REFERENCES "workbench_examples"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "generation_traces" ADD CONSTRAINT "generation_traces_chat_item_id_fkey" FOREIGN KEY ("chat_item_id") REFERENCES "chat_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
