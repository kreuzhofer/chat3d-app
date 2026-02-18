import { pool, query } from "../db/connection.js";
import { config } from "../config.js";
import { emailService } from "./email.service.js";
import { notificationService } from "./notification.service.js";
import { generateOpaqueToken, hashToken } from "../utils/token.js";
import { recordAdminAuditLog } from "./audit.service.js";

interface AdminUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: "admin" | "user";
  status: "active" | "deactivated" | "pending_registration";
  deactivated_until: string | null;
  created_at: string;
}

interface SettingsRow {
  waitlist_enabled: boolean;
  invitations_enabled: boolean;
  invitation_waitlist_required: boolean;
  invitation_quota_per_user: number;
  updated_at: string;
}

interface UserEmailRow {
  id: string;
  email: string;
  display_name: string | null;
  status: "active" | "deactivated" | "pending_registration";
}

export class AdminError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

function toSettingsResponse(row: SettingsRow) {
  return {
    waitlistEnabled: row.waitlist_enabled,
    invitationsEnabled: row.invitations_enabled,
    invitationWaitlistRequired: row.invitation_waitlist_required,
    invitationQuotaPerUser: row.invitation_quota_per_user,
    updatedAt: row.updated_at,
  };
}

function buildUserSearchQuery(search?: string) {
  if (!search || search.trim() === "") {
    return {
      sql: `
        SELECT id, email, display_name, role, status, deactivated_until::text, created_at::text
        FROM users
        ORDER BY created_at DESC
        LIMIT 200;
      `,
      params: [] as unknown[],
    };
  }

  return {
    sql: `
      SELECT id, email, display_name, role, status, deactivated_until::text, created_at::text
      FROM users
      WHERE email ILIKE $1 OR COALESCE(display_name, '') ILIKE $1
      ORDER BY created_at DESC
      LIMIT 200;
    `,
    params: [`%${search.trim()}%`],
  };
}

export async function listUsers(search?: string) {
  const { sql, params } = buildUserSearchQuery(search);
  const result = await query<AdminUserRow>(sql, params);

  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    deactivatedUntil: row.deactivated_until,
    createdAt: row.created_at,
  }));
}

export async function getAdminSettings() {
  const result = await query<SettingsRow>(
    `
    SELECT waitlist_enabled, invitations_enabled, invitation_waitlist_required, invitation_quota_per_user, updated_at::text
    FROM app_settings
    WHERE id = TRUE;
    `,
  );

  const row = result.rows[0];
  if (!row) {
    const fallback: SettingsRow = {
      waitlist_enabled: false,
      invitations_enabled: true,
      invitation_waitlist_required: false,
      invitation_quota_per_user: 3,
      updated_at: new Date().toISOString(),
    };
    return toSettingsResponse(fallback);
  }

  return toSettingsResponse(row);
}

async function listActiveAdminUserIds(): Promise<string[]> {
  const result = await query<{ id: string }>(
    `
    SELECT id
    FROM users
    WHERE role = 'admin'
      AND status = 'active';
    `,
  );

  return result.rows.map((row) => row.id);
}

export async function updateAdminSettings(input: {
  adminUserId: string;
  waitlistEnabled?: boolean;
  invitationsEnabled?: boolean;
  invitationWaitlistRequired?: boolean;
  invitationQuotaPerUser?: number;
}) {
  const existing = await getAdminSettings();

  const nextWaitlistEnabled =
    input.waitlistEnabled !== undefined ? input.waitlistEnabled : existing.waitlistEnabled;
  const nextInvitationsEnabled =
    input.invitationsEnabled !== undefined ? input.invitationsEnabled : existing.invitationsEnabled;
  const nextInvitationWaitlistRequired =
    input.invitationWaitlistRequired !== undefined
      ? input.invitationWaitlistRequired
      : existing.invitationWaitlistRequired;
  const nextInvitationQuotaPerUser =
    input.invitationQuotaPerUser !== undefined
      ? input.invitationQuotaPerUser
      : existing.invitationQuotaPerUser;

  if (!Number.isInteger(nextInvitationQuotaPerUser) || nextInvitationQuotaPerUser < 0) {
    throw new AdminError("invitationQuotaPerUser must be a non-negative integer", 400);
  }

  const result = await query<SettingsRow>(
    `
    INSERT INTO app_settings (
      id,
      waitlist_enabled,
      invitations_enabled,
      invitation_waitlist_required,
      invitation_quota_per_user,
      updated_by,
      updated_at
    )
    VALUES (TRUE, $1, $2, $3, $4, $5, NOW())
    ON CONFLICT (id)
    DO UPDATE SET
      waitlist_enabled = EXCLUDED.waitlist_enabled,
      invitations_enabled = EXCLUDED.invitations_enabled,
      invitation_waitlist_required = EXCLUDED.invitation_waitlist_required,
      invitation_quota_per_user = EXCLUDED.invitation_quota_per_user,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING waitlist_enabled, invitations_enabled, invitation_waitlist_required, invitation_quota_per_user, updated_at::text;
    `,
    [
      nextWaitlistEnabled,
      nextInvitationsEnabled,
      nextInvitationWaitlistRequired,
      nextInvitationQuotaPerUser,
      input.adminUserId,
    ],
  );

  await recordAdminAuditLog({
    adminUserId: input.adminUserId,
    action: "settings.updated",
    metadata: {
      waitlistEnabled: nextWaitlistEnabled,
      invitationsEnabled: nextInvitationsEnabled,
      invitationWaitlistRequired: nextInvitationWaitlistRequired,
      invitationQuotaPerUser: nextInvitationQuotaPerUser,
    },
  });

  const adminUserIds = await listActiveAdminUserIds();
  for (const adminUserId of adminUserIds) {
    await notificationService.publishToUser(adminUserId, "admin.settings.updated", {
      action: "updated",
      updatedBy: input.adminUserId,
      waitlistEnabled: nextWaitlistEnabled,
      invitationsEnabled: nextInvitationsEnabled,
      invitationWaitlistRequired: nextInvitationWaitlistRequired,
      invitationQuotaPerUser: nextInvitationQuotaPerUser,
    });
  }

  return toSettingsResponse(result.rows[0]);
}

async function findUserById(userId: string): Promise<UserEmailRow | null> {
  const result = await query<UserEmailRow>(
    `
    SELECT id, email, display_name, status
    FROM users
    WHERE id = $1;
    `,
    [userId],
  );

  return result.rows[0] ?? null;
}

export async function deactivateUser(input: {
  adminUserId: string;
  targetUserId: string;
  reason?: string;
}) {
  if (input.adminUserId === input.targetUserId) {
    throw new AdminError("Admins cannot deactivate their own account", 400);
  }

  const result = await query<UserEmailRow & { deactivated_until: string | null }>(
    `
    UPDATE users
    SET status = 'deactivated',
        deactivated_until = NOW() + INTERVAL '30 days',
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, email, display_name, status, deactivated_until::text;
    `,
    [input.targetUserId],
  );

  const user = result.rows[0];
  if (!user) {
    throw new AdminError("User not found", 404);
  }

  await recordAdminAuditLog({
    adminUserId: input.adminUserId,
    action: "user.deactivated",
    targetUserId: input.targetUserId,
    metadata: { reason: input.reason ?? null },
  });

  await notificationService.publishToUser(input.targetUserId, "account.status.changed", {
    action: "deactivated",
    changedBy: input.adminUserId,
    deactivatedUntil: user.deactivated_until,
    reason: input.reason ?? null,
  });

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    status: user.status,
    deactivatedUntil: user.deactivated_until,
  };
}

export async function activateUser(input: {
  adminUserId: string;
  targetUserId: string;
}) {
  const result = await query<UserEmailRow & { deactivated_until: string | null }>(
    `
    UPDATE users
    SET status = 'active',
        deactivated_until = NULL,
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, email, display_name, status, deactivated_until::text;
    `,
    [input.targetUserId],
  );

  const user = result.rows[0];
  if (!user) {
    throw new AdminError("User not found", 404);
  }

  await recordAdminAuditLog({
    adminUserId: input.adminUserId,
    action: "user.activated",
    targetUserId: input.targetUserId,
  });

  await notificationService.publishToUser(input.targetUserId, "account.status.changed", {
    action: "activated",
    changedBy: input.adminUserId,
  });

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    status: user.status,
    deactivatedUntil: user.deactivated_until,
  };
}

export async function triggerAdminPasswordReset(input: {
  adminUserId: string;
  targetUserId: string;
}) {
  const targetUser = await findUserById(input.targetUserId);
  if (!targetUser) {
    throw new AdminError("User not found", 404);
  }

  const resetToken = generateOpaqueToken();
  const resetTokenHash = hashToken(resetToken);

  await query(
    `
    INSERT INTO account_actions (
      user_id,
      action_type,
      token_hash,
      payload,
      status,
      expires_at
    )
    VALUES (
      $1,
      'password_reset',
      $2,
      $3::jsonb,
      'pending',
      NOW() + INTERVAL '24 hours'
    );
    `,
    [
      input.targetUserId,
      resetTokenHash,
      JSON.stringify({
        requestedByAdminId: input.adminUserId,
        source: "admin",
      }),
    ],
  );

  await recordAdminAuditLog({
    adminUserId: input.adminUserId,
    action: "user.password_reset_requested",
    targetUserId: input.targetUserId,
  });

  const resetUrl = `${config.app.baseUrl.replace(/\/$/, "")}/profile/password-reset?token=${encodeURIComponent(resetToken)}`;
  await emailService.sendTransactionalEmail({
    to: targetUser.email,
    subject: "Password reset requested by admin",
    text: `An administrator requested a password reset for your account. Use this link to continue: ${resetUrl}`,
  });

  await notificationService.publishToUser(input.targetUserId, "notification.created", {
    domain: "account",
    action: "password_reset_requested",
    requestedByAdminId: input.adminUserId,
  });

  return {
    userId: targetUser.id,
    email: targetUser.email,
    status: "pending",
  };
}
