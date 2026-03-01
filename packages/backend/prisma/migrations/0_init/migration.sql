-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('admin', 'user');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'deactivated', 'pending_registration');

-- CreateEnum
CREATE TYPE "waitlist_status" AS ENUM ('pending_email_confirmation', 'pending_admin_approval', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "registration_token_source" AS ENUM ('waitlist', 'admin_invite', 'user_invite');

-- CreateEnum
CREATE TYPE "invitation_status" AS ENUM ('pending', 'waitlisted', 'registration_sent', 'accepted', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "account_action_type" AS ENUM ('password_reset', 'email_change', 'data_export', 'account_delete', 'account_reactivate');

-- CreateEnum
CREATE TYPE "account_action_status" AS ENUM ('pending', 'completed', 'expired', 'cancelled');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "role" "user_role" NOT NULL DEFAULT 'user',
    "status" "user_status" NOT NULL DEFAULT 'active',
    "deactivated_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_contexts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL DEFAULT 'unnamed chat',
    "conversation_model_id" VARCHAR(255),
    "chat_3d_model_id" VARCHAR(255),
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chat_context_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "rating" INTEGER NOT NULL DEFAULT 0,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prompt_tokens" INTEGER DEFAULT 0,
    "completion_tokens" INTEGER DEFAULT 0,
    "estimated_cost_usd" DECIMAL(12,8) DEFAULT 0,

    CONSTRAINT "chat_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" BOOLEAN NOT NULL DEFAULT true,
    "waitlist_enabled" BOOLEAN NOT NULL DEFAULT false,
    "invitations_enabled" BOOLEAN NOT NULL DEFAULT true,
    "invitation_waitlist_required" BOOLEAN NOT NULL DEFAULT false,
    "invitation_quota_per_user" INTEGER NOT NULL DEFAULT 3,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "email_confirmed_at" TIMESTAMPTZ,
    "status" "waitlist_status" NOT NULL DEFAULT 'pending_email_confirmation',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_email_confirmations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "waitlist_entry_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_email_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "source" "registration_token_source" NOT NULL,
    "invited_by_user_id" UUID,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inviter_user_id" UUID NOT NULL,
    "invitee_email" VARCHAR(255) NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'pending',
    "registration_token_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "action_type" "account_action_type" NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "account_action_status" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "target_user_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" BIGSERIAL NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "user_id" UUID,
    "ip_address" VARCHAR(64),
    "path" VARCHAR(255),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workbench_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rank" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "complexity" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workbench_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workbench_example_prompts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(1536),
    "embedding_model" TEXT,

    CONSTRAINT "workbench_example_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workbench_examples" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "prompt_id" UUID NOT NULL,
    "iteration" INTEGER NOT NULL DEFAULT 1,
    "generation_seed" INTEGER,
    "code" TEXT NOT NULL,
    "render_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "render_error" TEXT,
    "stl_path" TEXT,
    "step_path" TEXT,
    "threemf_path" TEXT,
    "screenshot_front" TEXT,
    "screenshot_top" TEXT,
    "screenshot_iso" TEXT,
    "eval_score" INTEGER,
    "eval_issues" JSONB,
    "eval_suggestions" JSONB,
    "approval_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "rejection_note" TEXT,
    "llm_model" VARCHAR(255),
    "vlm_model" VARCHAR(255),
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "screenshot_iso_back" TEXT,
    "screenshot_bottom" TEXT,
    "screenshot_back" TEXT,
    "screenshot_left" TEXT,
    "screenshot_right" TEXT,
    "screenshot_ortho_45" TEXT,
    "screenshot_ortho_45_bottom" TEXT,

    CONSTRAINT "workbench_examples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workbench_system_prompts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workbench_system_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_providers" (
    "name" VARCHAR(50) NOT NULL,
    "display_name" VARCHAR(100),
    "api_key" TEXT,
    "endpoint_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "max_concurrent" INTEGER,

    CONSTRAINT "llm_providers_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "llm_models" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(50) NOT NULL,
    "model_name" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "cost_per_1m_input" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "cost_per_1m_output" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "max_output_tokens" INTEGER,
    "max_context_tokens" INTEGER,
    "supports_thinking" BOOLEAN NOT NULL DEFAULT false,
    "default_thinking_effort" VARCHAR(20),
    "supports_vision" BOOLEAN NOT NULL DEFAULT false,
    "supports_embeddings" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_purpose_map" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purpose" VARCHAR(50) NOT NULL,
    "model_id" UUID NOT NULL,
    "override_max_output_tokens" INTEGER,
    "override_thinking_effort" VARCHAR(20),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_purpose_map_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_users_role" ON "users"("role");

-- CreateIndex
CREATE INDEX "idx_users_status" ON "users"("status");

-- CreateIndex
CREATE INDEX "idx_chat_contexts_owner" ON "chat_contexts"("owner_id");

-- CreateIndex
CREATE INDEX "idx_chat_items_context" ON "chat_items"("chat_context_id");

-- CreateIndex
CREATE INDEX "idx_chat_items_owner" ON "chat_items"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_email_key" ON "waitlist_entries"("email");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_email_confirmations_token_hash_key" ON "waitlist_email_confirmations"("token_hash");

-- CreateIndex
CREATE INDEX "idx_waitlist_email_confirmations_entry" ON "waitlist_email_confirmations"("waitlist_entry_id");

-- CreateIndex
CREATE INDEX "idx_waitlist_email_confirmations_expires" ON "waitlist_email_confirmations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "registration_tokens_token_hash_key" ON "registration_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_registration_tokens_email" ON "registration_tokens"("email");

-- CreateIndex
CREATE INDEX "idx_invitations_inviter" ON "invitations"("inviter_user_id");

-- CreateIndex
CREATE INDEX "idx_invitations_email" ON "invitations"("invitee_email");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_inviter_user_id_invitee_email_key" ON "invitations"("inviter_user_id", "invitee_email");

-- CreateIndex
CREATE UNIQUE INDEX "account_actions_token_hash_key" ON "account_actions"("token_hash");

-- CreateIndex
CREATE INDEX "idx_account_actions_user" ON "account_actions"("user_id");

-- CreateIndex
CREATE INDEX "idx_notifications_user_created" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_push_subscriptions_user_id" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_user_id_endpoint_key" ON "push_subscriptions"("user_id", "endpoint");

-- CreateIndex
CREATE INDEX "idx_admin_audit_logs_admin_created" ON "admin_audit_logs"("admin_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_admin_audit_logs_target_created" ON "admin_audit_logs"("target_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_security_events_created" ON "security_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_security_events_event_type" ON "security_events"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "workbench_categories_rank_key" ON "workbench_categories"("rank");

-- CreateIndex
CREATE INDEX "idx_wb_prompts_category" ON "workbench_example_prompts"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "workbench_example_prompts_category_id_index_key" ON "workbench_example_prompts"("category_id", "index");

-- CreateIndex
CREATE INDEX "idx_wb_examples_prompt" ON "workbench_examples"("prompt_id");

-- CreateIndex
CREATE INDEX "idx_wb_examples_approval" ON "workbench_examples"("approval_status");

-- CreateIndex
CREATE INDEX "idx_wb_examples_eval_score" ON "workbench_examples"("eval_score");

-- CreateIndex
CREATE UNIQUE INDEX "workbench_system_prompts_version_key" ON "workbench_system_prompts"("version");

-- CreateIndex
CREATE UNIQUE INDEX "llm_models_provider_model_name_key" ON "llm_models"("provider", "model_name");

-- CreateIndex
CREATE UNIQUE INDEX "llm_purpose_map_purpose_key" ON "llm_purpose_map"("purpose");

-- AddForeignKey
ALTER TABLE "chat_contexts" ADD CONSTRAINT "chat_contexts_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_items" ADD CONSTRAINT "chat_items_chat_context_id_fkey" FOREIGN KEY ("chat_context_id") REFERENCES "chat_contexts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_items" ADD CONSTRAINT "chat_items_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "waitlist_email_confirmations" ADD CONSTRAINT "waitlist_email_confirmations_waitlist_entry_id_fkey" FOREIGN KEY ("waitlist_entry_id") REFERENCES "waitlist_entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registration_tokens" ADD CONSTRAINT "registration_tokens_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_registration_token_id_fkey" FOREIGN KEY ("registration_token_id") REFERENCES "registration_tokens"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "account_actions" ADD CONSTRAINT "account_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workbench_example_prompts" ADD CONSTRAINT "workbench_example_prompts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "workbench_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workbench_examples" ADD CONSTRAINT "workbench_examples_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "workbench_example_prompts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "llm_models" ADD CONSTRAINT "fk_llm_models_provider" FOREIGN KEY ("provider") REFERENCES "llm_providers"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_purpose_map" ADD CONSTRAINT "llm_purpose_map_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "llm_models"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
