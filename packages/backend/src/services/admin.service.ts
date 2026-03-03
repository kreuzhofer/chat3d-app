import { prisma } from "../db/prisma.js";
import { config } from "../config.js";
import { emailService } from "./email.service.js";
import { notificationService } from "./notification.service.js";
import { generateOpaqueToken, hashToken } from "../utils/token.js";
import { recordAdminAuditLog } from "./audit.service.js";

export class AdminError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export async function listUsers(search?: string) {
  const where = search && search.trim() !== ""
    ? {
        OR: [
          { email: { contains: search.trim(), mode: "insensitive" as const } },
          { displayName: { contains: search.trim(), mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const rows = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      deactivatedUntil: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    deactivatedUntil: row.deactivatedUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getAdminSettings() {
  const row = await prisma.appSettings.findUnique({
    where: { id: true },
    select: {
      waitlistEnabled: true,
      invitationsEnabled: true,
      invitationWaitlistRequired: true,
      invitationQuotaPerUser: true,
      emailConfirmationEnabled: true,
      updatedAt: true,
    },
  });

  if (!row) {
    return {
      waitlistEnabled: false,
      invitationsEnabled: true,
      invitationWaitlistRequired: false,
      invitationQuotaPerUser: 3,
      emailConfirmationEnabled: true,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    waitlistEnabled: row.waitlistEnabled,
    invitationsEnabled: row.invitationsEnabled,
    invitationWaitlistRequired: row.invitationWaitlistRequired,
    invitationQuotaPerUser: row.invitationQuotaPerUser,
    emailConfirmationEnabled: row.emailConfirmationEnabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function listActiveAdminUserIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { role: "admin", status: "active" },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function updateAdminSettings(input: {
  adminUserId: string;
  waitlistEnabled?: boolean;
  invitationsEnabled?: boolean;
  invitationWaitlistRequired?: boolean;
  invitationQuotaPerUser?: number;
  emailConfirmationEnabled?: boolean;
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
  const nextEmailConfirmationEnabled =
    input.emailConfirmationEnabled !== undefined
      ? input.emailConfirmationEnabled
      : existing.emailConfirmationEnabled;

  if (!Number.isInteger(nextInvitationQuotaPerUser) || nextInvitationQuotaPerUser < 0) {
    throw new AdminError("invitationQuotaPerUser must be a non-negative integer", 400);
  }

  const row = await prisma.appSettings.upsert({
    where: { id: true },
    create: {
      id: true,
      waitlistEnabled: nextWaitlistEnabled,
      invitationsEnabled: nextInvitationsEnabled,
      invitationWaitlistRequired: nextInvitationWaitlistRequired,
      invitationQuotaPerUser: nextInvitationQuotaPerUser,
      emailConfirmationEnabled: nextEmailConfirmationEnabled,
      updatedBy: input.adminUserId,
      updatedAt: new Date(),
    },
    update: {
      waitlistEnabled: nextWaitlistEnabled,
      invitationsEnabled: nextInvitationsEnabled,
      invitationWaitlistRequired: nextInvitationWaitlistRequired,
      invitationQuotaPerUser: nextInvitationQuotaPerUser,
      emailConfirmationEnabled: nextEmailConfirmationEnabled,
      updatedBy: input.adminUserId,
      updatedAt: new Date(),
    },
    select: {
      waitlistEnabled: true,
      invitationsEnabled: true,
      invitationWaitlistRequired: true,
      invitationQuotaPerUser: true,
      emailConfirmationEnabled: true,
      updatedAt: true,
    },
  });

  await recordAdminAuditLog({
    adminUserId: input.adminUserId,
    action: "settings.updated",
    metadata: {
      waitlistEnabled: nextWaitlistEnabled,
      invitationsEnabled: nextInvitationsEnabled,
      invitationWaitlistRequired: nextInvitationWaitlistRequired,
      invitationQuotaPerUser: nextInvitationQuotaPerUser,
      emailConfirmationEnabled: nextEmailConfirmationEnabled,
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
      emailConfirmationEnabled: nextEmailConfirmationEnabled,
    });
  }

  return {
    waitlistEnabled: row.waitlistEnabled,
    invitationsEnabled: row.invitationsEnabled,
    invitationWaitlistRequired: row.invitationWaitlistRequired,
    invitationQuotaPerUser: row.invitationQuotaPerUser,
    emailConfirmationEnabled: row.emailConfirmationEnabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function deactivateUser(input: {
  adminUserId: string;
  targetUserId: string;
  reason?: string;
}) {
  if (input.adminUserId === input.targetUserId) {
    throw new AdminError("Admins cannot deactivate their own account", 400);
  }

  const deactivatedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  let user;
  try {
    user = await prisma.user.update({
      where: { id: input.targetUserId },
      data: { status: "deactivated", deactivatedUntil, updatedAt: new Date() },
      select: { id: true, email: true, displayName: true, status: true, deactivatedUntil: true },
    });
  } catch {
    throw new AdminError("User not found", 404);
  }

  await recordAdminAuditLog({
    adminUserId: input.adminUserId,
    action: "user.deactivated",
    targetUserId: input.targetUserId,
    metadata: { reason: input.reason ?? null },
  });

  const deactivatedUntilIso = user.deactivatedUntil?.toISOString() ?? null;

  await notificationService.publishToUser(input.targetUserId, "account.status.changed", {
    action: "deactivated",
    changedBy: input.adminUserId,
    deactivatedUntil: deactivatedUntilIso,
    reason: input.reason ?? null,
  });

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    deactivatedUntil: deactivatedUntilIso,
  };
}

export async function activateUser(input: {
  adminUserId: string;
  targetUserId: string;
}) {
  let user;
  try {
    user = await prisma.user.update({
      where: { id: input.targetUserId },
      data: { status: "active", deactivatedUntil: null, updatedAt: new Date() },
      select: { id: true, email: true, displayName: true, status: true, deactivatedUntil: true },
    });
  } catch {
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
    displayName: user.displayName,
    status: user.status,
    deactivatedUntil: user.deactivatedUntil?.toISOString() ?? null,
  };
}

export async function triggerAdminPasswordReset(input: {
  adminUserId: string;
  targetUserId: string;
}) {
  const targetUser = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    select: { id: true, email: true, displayName: true, status: true },
  });

  if (!targetUser) {
    throw new AdminError("User not found", 404);
  }

  const resetToken = generateOpaqueToken();
  const resetTokenHash = hashToken(resetToken);

  await prisma.accountAction.create({
    data: {
      userId: input.targetUserId,
      actionType: "password_reset",
      tokenHash: resetTokenHash,
      payload: { requestedByAdminId: input.adminUserId, source: "admin" },
      status: "pending",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

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
