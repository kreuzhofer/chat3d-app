import { prisma } from "../db/prisma.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { emailService } from "./email.service.js";
import { renderEmail } from "./email-template.service.js";
import { notificationService } from "./notification.service.js";
import { generateOpaqueToken, hashToken } from "../utils/token.js";
import { recordAdminAuditLog } from "./audit.service.js";
import { assertValidPassword, hashPassword } from "./auth.service.js";

export { getAdminSettings, updateAdminSettings } from "./admin-settings.service.js";

const logger = createLogger("admin");

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
      onboardingCompletedAt: true,
      generationCount: true,
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
    onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
    generationCount: row.generationCount,
    createdAt: row.createdAt.toISOString(),
  }));
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
  const rendered = renderEmail("admin-password-reset", "en", { resetUrl });
  await emailService.sendTransactionalEmail({ to: targetUser.email, ...rendered });

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

export async function setUserPassword(input: {
  adminUserId: string;
  targetUserId: string;
  newPassword: string;
}) {
  if (!assertValidPassword(input.newPassword)) {
    throw new AdminError("Password must be at least 8 characters", 400);
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    select: { id: true, email: true },
  });

  if (!targetUser) {
    throw new AdminError("User not found", 404);
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.user.update({
    where: { id: input.targetUserId },
    data: { passwordHash, updatedAt: new Date() },
  });

  await recordAdminAuditLog({
    adminUserId: input.adminUserId,
    action: "user.password_set",
    targetUserId: input.targetUserId,
  });

  await notificationService.publishToUser(input.targetUserId, "notification.created", {
    domain: "account",
    action: "password_set_by_admin",
  });

  return {
    userId: targetUser.id,
    email: targetUser.email,
    status: "completed",
  };
}

export async function resetUserOnboarding(input: { adminUserId: string; targetUserId: string }) {
  const targetUser = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    select: { id: true, email: true },
  });
  if (!targetUser) throw new AdminError("User not found", 404);

  await prisma.user.update({
    where: { id: input.targetUserId },
    data: { onboardingCompletedAt: null, generationCount: 0, updatedAt: new Date() },
  });
  await recordAdminAuditLog({
    adminUserId: input.adminUserId, action: "user.onboarding_reset", targetUserId: input.targetUserId,
  });
  logger.info({ adminUserId: input.adminUserId, targetUserId: input.targetUserId }, "reset user onboarding");
  return { userId: targetUser.id, email: targetUser.email, status: "reset" };
}

export async function deleteUserPermanently(input: {
  adminUserId: string;
  targetUserId: string;
}) {
  if (input.adminUserId === input.targetUserId) {
    throw new AdminError("Admins cannot delete their own account", 400);
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    select: { id: true, email: true, role: true, status: true },
  });

  if (!targetUser) {
    throw new AdminError("User not found", 404);
  }

  if (targetUser.status !== "deactivated") {
    throw new AdminError("Only deactivated users can be permanently deleted", 400);
  }

  await recordAdminAuditLog({
    adminUserId: input.adminUserId,
    action: "user.deleted_permanently",
    targetUserId: input.targetUserId,
    metadata: { email: targetUser.email, role: targetUser.role },
  });

  await prisma.user.delete({ where: { id: input.targetUserId } });

  logger.info(
    { adminUserId: input.adminUserId, targetUserId: input.targetUserId, email: targetUser.email },
    "permanently deleted user",
  );

  return { userId: targetUser.id, email: targetUser.email };
}
