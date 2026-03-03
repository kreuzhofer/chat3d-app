-- AlterEnum: add email_confirmation to account_action_type
ALTER TYPE "account_action_type" ADD VALUE 'email_confirmation';

-- AlterTable: add email_confirmation_enabled to app_settings
ALTER TABLE "app_settings" ADD COLUMN "email_confirmation_enabled" BOOLEAN NOT NULL DEFAULT true;
