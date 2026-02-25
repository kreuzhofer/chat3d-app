import type { Migration } from "./types.js";
import { migration001InitialSchema } from "./001_initial_schema.js";
import { migration002AuthAdminWaitlistInvites } from "./002_auth_admin_waitlist_invites.js";
import { migration003NotificationsAccountLifecycle } from "./003_notifications_account_lifecycle.js";
import { migration004WaitlistConfirmationTokens } from "./004_waitlist_confirmation_tokens.js";
import { migration005AdminAuditLogs } from "./005_admin_audit_logs.js";
import { migration006SecurityEvents } from "./006_security_events.js";
import { migration007WorkbenchTables } from "./007_workbench_tables.js";
import { migration008PgvectorEmbeddings } from "./008_pgvector_embeddings.js";
import { migration009EmbeddingModelColumn } from "./009_embedding_model_column.js";
import { migration010LlmModelConfig } from "./010_llm_model_config.js";
import { migration011LlmProvidersTable } from "./011_llm_api_key_in_db.js";
import { migration012ProviderMaxConcurrent } from "./012_provider_max_concurrent.js";

export const migrations: Migration[] = [
  migration001InitialSchema,
  migration002AuthAdminWaitlistInvites,
  migration003NotificationsAccountLifecycle,
  migration004WaitlistConfirmationTokens,
  migration005AdminAuditLogs,
  migration006SecurityEvents,
  migration007WorkbenchTables,
  migration008PgvectorEmbeddings,
  migration009EmbeddingModelColumn,
  migration010LlmModelConfig,
  migration011LlmProvidersTable,
  migration012ProviderMaxConcurrent,
];
