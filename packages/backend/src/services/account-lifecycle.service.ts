import type { Prisma } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db/prisma.js";
import { generateOpaqueToken, hashToken } from "../utils/token.js";
import { assertValidPassword, hashPassword, normalizeEmail } from "./auth.service.js";
import { emailService } from "./email.service.js";
import { notificationService } from "./notification.service.js";

type AccountActionType =
  | "password_reset"
  | "email_change"
  | "data_export"
  | "account_delete"
  | "account_reactivate";

export class AccountLifecycleError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

function appUrl(path: string): string {
  const base = config.app.baseUrl.replace(/\/$/, "");
  return `${base}${path}`;
}

function isValidEmail(value: string): boolean {
  return /.+@.+\..+/.test(value);
}

async function cancelPendingAction(tx: Prisma.TransactionClient, userId: string, actionType: AccountActionType) {
  await tx.accountAction.updateMany({
    where: {
      userId,
      actionType,
      status: "pending",
    },
    data: {
      status: "cancelled",
    },
  });
}

async function createAccountAction(input: {
  tx: Prisma.TransactionClient;
  userId: string;
  actionType: AccountActionType;
  payload: Record<string, unknown>;
  expiresInHours?: number;
}): Promise<{ actionId: string; token: string }> {
  await cancelPendingAction(input.tx, input.userId, input.actionType);

  const token = generateOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresInHours = input.expiresInHours ?? 24;

  const action = await input.tx.accountAction.create({
    data: {
      userId: input.userId,
      actionType: input.actionType,
      tokenHash,
      payload: input.payload,
      status: "pending",
      expiresAt: new Date(Date.now() + expiresInHours * 3600 * 1000),
    },
    select: { id: true },
  });

  return {
    actionId: action.id,
    token,
  };
}

async function findUserByEmailForUpdate(tx: Prisma.TransactionClient, email: string) {
  const normalizedEmail = normalizeEmail(email);
  const rows = await tx.$queryRaw<Array<{
    id: string;
    email: string;
    status: string;
    deactivated_until: Date | null;
  }>>`
    SELECT id, email, status, deactivated_until
    FROM users
    WHERE email = ${normalizedEmail}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

async function buildDataExportPayload(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      deactivatedUntil: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const contexts = await prisma.chatContext.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, createdAt: true },
  });

  const items = await prisma.chatItem.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, chatContextId: true, role: true, createdAt: true },
  });

  return {
    exportedAt: new Date().toISOString(),
    user: user
      ? {
          id: user.id,
          email: user.email,
          display_name: user.displayName,
          role: user.role,
          status: user.status,
          deactivated_until: user.deactivatedUntil?.toISOString() ?? null,
          created_at: user.createdAt.toISOString(),
          updated_at: user.updatedAt.toISOString(),
        }
      : null,
    chatContexts: contexts.map((c) => ({
      id: c.id,
      name: c.name,
      created_at: c.createdAt.toISOString(),
    })),
    chatItems: items.map((i) => ({
      id: i.id,
      chat_context_id: i.chatContextId,
      role: i.role,
      created_at: i.createdAt.toISOString(),
    })),
    totals: {
      chatContexts: contexts.length,
      chatItems: items.length,
    },
  };
}

export async function requestPasswordReset(input: {
  userId: string;
  email: string;
  newPassword: string;
}) {
  if (!assertValidPassword(input.newPassword)) {
    throw new AccountLifecycleError("Password must be at least 8 characters", 400);
  }

  const passwordHash = await hashPassword(input.newPassword);

  const action = await prisma.$transaction(async (tx) => {
    return createAccountAction({
      tx,
      userId: input.userId,
      actionType: "password_reset",
      payload: { passwordHash },
    });
  });

  const confirmationUrl = appUrl(`/profile/actions/confirm?token=${encodeURIComponent(action.token)}`);
  await emailService.sendTransactionalEmail({
    to: input.email,
    subject: "Confirm your password reset",
    text: `Confirm your password reset request: ${confirmationUrl}`,
  });
}

export async function requestEmailChange(input: {
  userId: string;
  currentEmail: string;
  newEmail: string;
}) {
  const normalizedNewEmail = normalizeEmail(input.newEmail);
  if (!isValidEmail(normalizedNewEmail)) {
    throw new AccountLifecycleError("Invalid new email address", 400);
  }

  if (normalizedNewEmail === normalizeEmail(input.currentEmail)) {
    throw new AccountLifecycleError("New email must be different from current email", 400);
  }

  const action = await prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findFirst({
      where: {
        email: normalizedNewEmail,
        id: { not: input.userId },
      },
      select: { id: true },
    });

    if (existingUser) {
      throw new AccountLifecycleError("Email is already in use", 409);
    }

    return createAccountAction({
      tx,
      userId: input.userId,
      actionType: "email_change",
      payload: { newEmail: normalizedNewEmail },
    });
  });

  const confirmationUrl = appUrl(`/profile/actions/confirm?token=${encodeURIComponent(action.token)}`);
  await emailService.sendTransactionalEmail({
    to: normalizedNewEmail,
    subject: "Confirm your email change",
    text: `Confirm your new email address by opening: ${confirmationUrl}`,
  });
}

export async function requestDataExport(input: { userId: string; email: string }) {
  const action = await prisma.$transaction(async (tx) => {
    return createAccountAction({
      tx,
      userId: input.userId,
      actionType: "data_export",
      payload: {},
    });
  });

  const confirmationUrl = appUrl(`/profile/actions/confirm?token=${encodeURIComponent(action.token)}`);
  await emailService.sendTransactionalEmail({
    to: input.email,
    subject: "Confirm your data export",
    text: `Confirm your data export request: ${confirmationUrl}`,
  });
}

export async function requestAccountDelete(input: { userId: string; email: string }) {
  const action = await prisma.$transaction(async (tx) => {
    return createAccountAction({
      tx,
      userId: input.userId,
      actionType: "account_delete",
      payload: {},
    });
  });

  const confirmationUrl = appUrl(`/profile/actions/confirm?token=${encodeURIComponent(action.token)}`);
  await emailService.sendTransactionalEmail({
    to: input.email,
    subject: "Confirm your account deletion",
    text: `Confirm account deletion. Your account will be deactivated for 30 days: ${confirmationUrl}`,
  });
}

export async function requestAccountReactivation(input: { email: string }) {
  const normalizedEmail = normalizeEmail(input.email);
  if (!isValidEmail(normalizedEmail)) {
    return;
  }

  const action = await prisma.$transaction(async (tx) => {
    const user = await findUserByEmailForUpdate(tx, normalizedEmail);
    if (!user) return null;

    if (user.status !== "deactivated") return null;

    if (user.deactivated_until && user.deactivated_until.getTime() < Date.now()) {
      return null;
    }

    return createAccountAction({
      tx,
      userId: user.id,
      actionType: "account_reactivate",
      payload: {},
    });
  });

  if (!action) return;

  const confirmationUrl = appUrl(`/profile/actions/confirm?token=${encodeURIComponent(action.token)}`);
  await emailService.sendTransactionalEmail({
    to: normalizedEmail,
    subject: "Confirm your account reactivation",
    text: `Confirm account reactivation: ${confirmationUrl}`,
  });
}

function parsePayloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value;
}

export async function confirmAccountAction(rawToken: string) {
  if (!rawToken || rawToken.trim() === "") {
    throw new AccountLifecycleError("Confirmation token is required", 400);
  }

  const tokenHash = hashToken(rawToken);

  const result = await prisma.$transaction(async (tx) => {
    // FOR UPDATE lock on the action + user join
    const rows = await tx.$queryRaw<Array<{
      id: string;
      user_id: string;
      action_type: string;
      payload: Record<string, unknown>;
      status: string;
      expires_at: Date | null;
      email: string;
      user_status: string;
      user_deactivated_until: Date | null;
    }>>`
      SELECT a.id,
             a.user_id,
             a.action_type,
             a.payload,
             a.status,
             a.expires_at,
             u.email,
             u.status AS user_status,
             u.deactivated_until AS user_deactivated_until
      FROM account_actions a
      INNER JOIN users u ON u.id = a.user_id
      WHERE a.token_hash = ${tokenHash}
      FOR UPDATE
    `;

    const action = rows[0];
    if (!action) {
      throw new AccountLifecycleError("Invalid confirmation token", 400);
    }

    if (action.status !== "pending") {
      throw new AccountLifecycleError("This token has already been used", 409);
    }

    if (action.expires_at && action.expires_at.getTime() < Date.now()) {
      await tx.accountAction.update({
        where: { id: action.id },
        data: { status: "expired" },
      });
      // Return sentinel — we want this status change committed, then throw after tx
      return { type: "expired" as const };
    }

    let emailOverride: string | null = null;

    switch (action.action_type) {
      case "password_reset": {
        const passwordHashFromPayload = parsePayloadString(action.payload, "passwordHash");
        if (!passwordHashFromPayload) {
          throw new AccountLifecycleError("Invalid password reset payload", 400);
        }

        await tx.user.update({
          where: { id: action.user_id },
          data: { passwordHash: passwordHashFromPayload, updatedAt: new Date() },
        });
        break;
      }

      case "email_change": {
        const nextEmail = parsePayloadString(action.payload, "newEmail");
        if (!nextEmail || !isValidEmail(nextEmail)) {
          throw new AccountLifecycleError("Invalid email change payload", 400);
        }

        const normalizedNextEmail = normalizeEmail(nextEmail);
        const existingUser = await tx.user.findFirst({
          where: {
            email: normalizedNextEmail,
            id: { not: action.user_id },
          },
          select: { id: true },
        });

        if (existingUser) {
          throw new AccountLifecycleError("Email is already in use", 409);
        }

        await tx.user.update({
          where: { id: action.user_id },
          data: { email: normalizedNextEmail, updatedAt: new Date() },
        });

        emailOverride = normalizedNextEmail;
        break;
      }

      case "data_export": {
        break;
      }

      case "account_delete": {
        await tx.user.update({
          where: { id: action.user_id },
          data: {
            status: "deactivated",
            deactivatedUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
          },
        });
        break;
      }

      case "account_reactivate": {
        if (action.user_status !== "deactivated") {
          throw new AccountLifecycleError("Account is not deactivated", 409);
        }

        if (action.user_deactivated_until && action.user_deactivated_until.getTime() < Date.now()) {
          throw new AccountLifecycleError("Reactivation window has expired", 409);
        }

        await tx.user.update({
          where: { id: action.user_id },
          data: {
            status: "active",
            deactivatedUntil: null,
            updatedAt: new Date(),
          },
        });
        break;
      }
    }

    await tx.accountAction.update({
      where: { id: action.id },
      data: { status: "completed", completedAt: new Date() },
    });

    return {
      type: "completed" as const,
      actionType: action.action_type as AccountActionType,
      userId: action.user_id,
      email: emailOverride ?? action.email,
      shouldSendDataExport: action.action_type === "data_export",
    };
  });

  if (result.type === "expired") {
    throw new AccountLifecycleError("This confirmation token has expired", 400);
  }

  if (result.actionType === "account_delete") {
    await notificationService.publishToUser(result.userId, "account.status.changed", {
      action: "deactivated",
      changedBy: "self",
    });
  }

  if (result.actionType === "account_reactivate") {
    await notificationService.publishToUser(result.userId, "account.status.changed", {
      action: "activated",
      changedBy: "self",
    });
  }

  if (result.shouldSendDataExport) {
    const exportPayload = await buildDataExportPayload(result.userId);
    await emailService.sendTransactionalEmail({
      to: result.email,
      subject: "Your data export",
      text: JSON.stringify(exportPayload, null, 2),
    });
  }

  return {
    status: "completed" as const,
    actionType: result.actionType,
  };
}
