import type { Migration } from "./types.js";
import { migration001InitialSchema } from "./001_initial_schema.js";
import { migration002AuthAdminWaitlistInvites } from "./002_auth_admin_waitlist_invites.js";
import { migration003NotificationsAccountLifecycle } from "./003_notifications_account_lifecycle.js";
import { migration004WaitlistConfirmationTokens } from "./004_waitlist_confirmation_tokens.js";
import { migration005AdminAuditLogs } from "./005_admin_audit_logs.js";
import { migration006SecurityEvents } from "./006_security_events.js";

export const migrations: Migration[] = [
  migration001InitialSchema,
  migration002AuthAdminWaitlistInvites,
  migration003NotificationsAccountLifecycle,
  migration004WaitlistConfirmationTokens,
  migration005AdminAuditLogs,
  migration006SecurityEvents,
];
