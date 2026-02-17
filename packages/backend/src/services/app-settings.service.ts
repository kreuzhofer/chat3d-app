import type { PoolClient, QueryResultRow } from "pg";
import { query } from "../db/connection.js";

interface AppSettingsRow {
  waitlist_enabled: boolean;
  invitations_enabled: boolean;
  invitation_waitlist_required: boolean;
  invitation_quota_per_user: number;
}

export async function isWaitlistEnabled(): Promise<boolean> {
  const result = await query<AppSettingsRow>(
    `
    SELECT waitlist_enabled
    FROM app_settings
    WHERE id = TRUE;
    `,
  );

  const row = result.rows[0];
  return row ? row.waitlist_enabled : false;
}

interface QueryExecutor {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

async function readInvitationPolicy(executor: QueryExecutor): Promise<{
  invitationsEnabled: boolean;
  invitationWaitlistRequired: boolean;
  invitationQuotaPerUser: number;
}> {
  const result = await executor.query<AppSettingsRow>(
    `
    SELECT invitations_enabled, invitation_waitlist_required, invitation_quota_per_user, waitlist_enabled
    FROM app_settings
    WHERE id = TRUE;
    `,
  );

  const row = result.rows[0];
  if (!row) {
    return {
      invitationsEnabled: true,
      invitationWaitlistRequired: false,
      invitationQuotaPerUser: 3,
    };
  }

  return {
    invitationsEnabled: row.invitations_enabled,
    invitationWaitlistRequired: row.invitation_waitlist_required,
    invitationQuotaPerUser: row.invitation_quota_per_user,
  };
}

export async function getInvitationPolicy(): Promise<{
  invitationsEnabled: boolean;
  invitationWaitlistRequired: boolean;
  invitationQuotaPerUser: number;
}> {
  return readInvitationPolicy({ query });
}

export async function getInvitationPolicyWithClient(client: PoolClient): Promise<{
  invitationsEnabled: boolean;
  invitationWaitlistRequired: boolean;
  invitationQuotaPerUser: number;
}> {
  return readInvitationPolicy(client);
}
