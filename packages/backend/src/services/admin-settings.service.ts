import { prisma } from "../db/prisma.js";
import { AdminError } from "./admin.service.js";
import { notificationService } from "./notification.service.js";
import { recordAdminAuditLog } from "./audit.service.js";

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
