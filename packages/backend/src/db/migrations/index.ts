import type { Migration } from "./types.js";
import { migration001InitialSchema } from "./001_initial_schema.js";
import { migration002AuthAdminWaitlistInvites } from "./002_auth_admin_waitlist_invites.js";
import { migration003NotificationsAccountLifecycle } from "./003_notifications_account_lifecycle.js";

export const migrations: Migration[] = [
  migration001InitialSchema,
  migration002AuthAdminWaitlistInvites,
  migration003NotificationsAccountLifecycle,
];
