import type { PoolClient } from "pg";
import { config } from "../config.js";
import { pool, query } from "../db/connection.js";
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

interface AccountActionRow {
  id: string;
  user_id: string;
  action_type: AccountActionType;
  token_hash: string;
  payload: Record<string, unknown>;
  status: "pending" | "completed" | "expired" | "cancelled";
  expires_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: "admin" | "user";
  status: "active" | "deactivated" | "pending_registration";
  deactivated_until: string | null;
  created_at: string;
  updated_at: string;
}

interface ChatContextRow {
  id: string;
  name: string;
  created_at: string;
}

interface ChatItemRow {
  id: string;
  chat_context_id: string;
  role: "user" | "assistant";
  created_at: string;
}

interface ConfirmActionRow extends AccountActionRow {
  email: string;
  user_status: "active" | "deactivated" | "pending_registration";
  user_deactivated_until: string | null;
}

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

async function cancelPendingAction(client: PoolClient, userId: string, actionType: AccountActionType) {
  await client.query(
    `
    UPDATE account_actions
    SET status = 'cancelled'
    WHERE user_id = $1
      AND action_type = $2
      AND status = 'pending';
    `,
    [userId, actionType],
  );
}

async function createAccountAction(input: {
  client: PoolClient;
  userId: string;
  actionType: AccountActionType;
  payload: Record<string, unknown>;
  expiresInHours?: number;
}): Promise<{ actionId: string; token: string }> {
  await cancelPendingAction(input.client, input.userId, input.actionType);

  const token = generateOpaqueToken();
  const tokenHash = hashToken(token);

  const result = await input.client.query<{ id: string }>(
    `
    INSERT INTO account_actions (user_id, action_type, token_hash, payload, status, expires_at)
    VALUES (
      $1,
      $2,
      $3,
      $4::jsonb,
      'pending',
      NOW() + make_interval(hours => $5)
    )
    RETURNING id;
    `,
    [input.userId, input.actionType, tokenHash, JSON.stringify(input.payload), input.expiresInHours ?? 24],
  );

  return {
    actionId: result.rows[0].id,
    token,
  };
}

async function findUserByEmail(client: PoolClient, email: string): Promise<UserRow | null> {
  const result = await client.query<UserRow>(
    `
    SELECT id,
           email,
           display_name,
           role,
           status,
           deactivated_until::text,
           created_at::text,
           updated_at::text
    FROM users
    WHERE email = $1
    FOR UPDATE;
    `,
    [normalizeEmail(email)],
  );

  return result.rows[0] ?? null;
}

async function buildDataExportPayload(userId: string) {
  const userResult = await query<UserRow>(
    `
    SELECT id,
           email,
           display_name,
           role,
           status,
           deactivated_until::text,
           created_at::text,
           updated_at::text
    FROM users
    WHERE id = $1;
    `,
    [userId],
  );

  const contextsResult = await query<ChatContextRow>(
    `
    SELECT id, name, created_at::text
    FROM chat_contexts
    WHERE owner_id = $1
    ORDER BY created_at ASC;
    `,
    [userId],
  );

  const itemsResult = await query<ChatItemRow>(
    `
    SELECT id, chat_context_id, role, created_at::text
    FROM chat_items
    WHERE owner_id = $1
    ORDER BY created_at ASC;
    `,
    [userId],
  );

  return {
    exportedAt: new Date().toISOString(),
    user: userResult.rows[0] ?? null,
    chatContexts: contextsResult.rows,
    chatItems: itemsResult.rows,
    totals: {
      chatContexts: contextsResult.rows.length,
      chatItems: itemsResult.rows.length,
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
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const action = await createAccountAction({
      client,
      userId: input.userId,
      actionType: "password_reset",
      payload: {
        passwordHash,
      },
    });
    await client.query("COMMIT");

    const confirmationUrl = appUrl(`/profile/actions/confirm?token=${encodeURIComponent(action.token)}`);
    await emailService.sendTransactionalEmail({
      to: input.email,
      subject: "Confirm your password reset",
      text: `Confirm your password reset request: ${confirmationUrl}`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const existingEmailResult = await client.query<{ id: string }>(
      `
      SELECT id
      FROM users
      WHERE email = $1
        AND id <> $2
      LIMIT 1;
      `,
      [normalizedNewEmail, input.userId],
    );

    if (existingEmailResult.rows[0]) {
      throw new AccountLifecycleError("Email is already in use", 409);
    }

    const action = await createAccountAction({
      client,
      userId: input.userId,
      actionType: "email_change",
      payload: {
        newEmail: normalizedNewEmail,
      },
    });

    await client.query("COMMIT");

    const confirmationUrl = appUrl(`/profile/actions/confirm?token=${encodeURIComponent(action.token)}`);
    await emailService.sendTransactionalEmail({
      to: normalizedNewEmail,
      subject: "Confirm your email change",
      text: `Confirm your new email address by opening: ${confirmationUrl}`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function requestDataExport(input: { userId: string; email: string }) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const action = await createAccountAction({
      client,
      userId: input.userId,
      actionType: "data_export",
      payload: {},
    });
    await client.query("COMMIT");

    const confirmationUrl = appUrl(`/profile/actions/confirm?token=${encodeURIComponent(action.token)}`);
    await emailService.sendTransactionalEmail({
      to: input.email,
      subject: "Confirm your data export",
      text: `Confirm your data export request: ${confirmationUrl}`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function requestAccountDelete(input: { userId: string; email: string }) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const action = await createAccountAction({
      client,
      userId: input.userId,
      actionType: "account_delete",
      payload: {},
    });
    await client.query("COMMIT");

    const confirmationUrl = appUrl(`/profile/actions/confirm?token=${encodeURIComponent(action.token)}`);
    await emailService.sendTransactionalEmail({
      to: input.email,
      subject: "Confirm your account deletion",
      text: `Confirm account deletion. Your account will be deactivated for 30 days: ${confirmationUrl}`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function requestAccountReactivation(input: { email: string }) {
  const normalizedEmail = normalizeEmail(input.email);
  if (!isValidEmail(normalizedEmail)) {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const user = await findUserByEmail(client, normalizedEmail);
    if (!user) {
      await client.query("COMMIT");
      return;
    }

    if (user.status !== "deactivated") {
      await client.query("COMMIT");
      return;
    }

    if (user.deactivated_until && Date.parse(user.deactivated_until) < Date.now()) {
      await client.query("COMMIT");
      return;
    }

    const action = await createAccountAction({
      client,
      userId: user.id,
      actionType: "account_reactivate",
      payload: {},
    });

    await client.query("COMMIT");

    const confirmationUrl = appUrl(`/profile/actions/confirm?token=${encodeURIComponent(action.token)}`);
    await emailService.sendTransactionalEmail({
      to: normalizedEmail,
      subject: "Confirm your account reactivation",
      text: `Confirm account reactivation: ${confirmationUrl}`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markActionCompleted(client: PoolClient, actionId: string) {
  await client.query(
    `
    UPDATE account_actions
    SET status = 'completed',
        completed_at = NOW()
    WHERE id = $1;
    `,
    [actionId],
  );
}

async function markActionExpired(client: PoolClient, actionId: string) {
  await client.query(
    `
    UPDATE account_actions
    SET status = 'expired'
    WHERE id = $1;
    `,
    [actionId],
  );
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
  const client = await pool.connect();

  let confirmedActionType: AccountActionType | null = null;
  let targetUserId: string | null = null;
  let targetEmail: string | null = null;
  let shouldSendDataExport = false;

  try {
    await client.query("BEGIN");

    const result = await client.query<ConfirmActionRow>(
      `
      SELECT a.id,
             a.user_id,
             a.action_type,
             a.token_hash,
             a.payload,
             a.status,
             a.expires_at::text,
             a.completed_at::text,
             a.created_at::text,
             u.email,
             u.status AS user_status,
             u.deactivated_until::text AS user_deactivated_until
      FROM account_actions a
      INNER JOIN users u ON u.id = a.user_id
      WHERE a.token_hash = $1
      FOR UPDATE;
      `,
      [tokenHash],
    );

    const action = result.rows[0];
    if (!action) {
      throw new AccountLifecycleError("Invalid confirmation token", 400);
    }

    if (action.status !== "pending") {
      throw new AccountLifecycleError("This token has already been used", 409);
    }

    if (action.expires_at && Date.parse(action.expires_at) < Date.now()) {
      await markActionExpired(client, action.id);
      await client.query("COMMIT");
      throw new AccountLifecycleError("This confirmation token has expired", 400);
    }

    switch (action.action_type) {
      case "password_reset": {
        const passwordHashFromPayload = parsePayloadString(action.payload, "passwordHash");
        if (!passwordHashFromPayload) {
          throw new AccountLifecycleError("Invalid password reset payload", 400);
        }

        await client.query(
          `
          UPDATE users
          SET password_hash = $2,
              updated_at = NOW()
          WHERE id = $1;
          `,
          [action.user_id, passwordHashFromPayload],
        );
        break;
      }

      case "email_change": {
        const nextEmail = parsePayloadString(action.payload, "newEmail");
        if (!nextEmail || !isValidEmail(nextEmail)) {
          throw new AccountLifecycleError("Invalid email change payload", 400);
        }

        const normalizedNextEmail = normalizeEmail(nextEmail);
        const existingEmailResult = await client.query<{ id: string }>(
          `
          SELECT id
          FROM users
          WHERE email = $1
            AND id <> $2
          LIMIT 1;
          `,
          [normalizedNextEmail, action.user_id],
        );

        if (existingEmailResult.rows[0]) {
          throw new AccountLifecycleError("Email is already in use", 409);
        }

        await client.query(
          `
          UPDATE users
          SET email = $2,
              updated_at = NOW()
          WHERE id = $1;
          `,
          [action.user_id, normalizedNextEmail],
        );

        targetEmail = normalizedNextEmail;
        break;
      }

      case "data_export": {
        shouldSendDataExport = true;
        break;
      }

      case "account_delete": {
        await client.query(
          `
          UPDATE users
          SET status = 'deactivated',
              deactivated_until = NOW() + INTERVAL '30 days',
              updated_at = NOW()
          WHERE id = $1;
          `,
          [action.user_id],
        );
        break;
      }

      case "account_reactivate": {
        if (action.user_status !== "deactivated") {
          throw new AccountLifecycleError("Account is not deactivated", 409);
        }

        if (action.user_deactivated_until && Date.parse(action.user_deactivated_until) < Date.now()) {
          throw new AccountLifecycleError("Reactivation window has expired", 409);
        }

        await client.query(
          `
          UPDATE users
          SET status = 'active',
              deactivated_until = NULL,
              updated_at = NOW()
          WHERE id = $1;
          `,
          [action.user_id],
        );
        break;
      }
    }

    await markActionCompleted(client, action.id);
    await client.query("COMMIT");

    confirmedActionType = action.action_type;
    targetUserId = action.user_id;
    targetEmail = targetEmail ?? action.email;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (confirmedActionType === "account_delete" && targetUserId) {
    await notificationService.publishToUser(targetUserId, "account.status.changed", {
      action: "deactivated",
      changedBy: "self",
    });
  }

  if (confirmedActionType === "account_reactivate" && targetUserId) {
    await notificationService.publishToUser(targetUserId, "account.status.changed", {
      action: "activated",
      changedBy: "self",
    });
  }

  if (shouldSendDataExport && targetUserId && targetEmail) {
    const exportPayload = await buildDataExportPayload(targetUserId);
    await emailService.sendTransactionalEmail({
      to: targetEmail,
      subject: "Your data export",
      text: JSON.stringify(exportPayload, null, 2),
    });
  }

  return {
    status: "completed" as const,
    actionType: confirmedActionType,
  };
}
