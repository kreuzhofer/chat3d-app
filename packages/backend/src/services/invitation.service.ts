import { config } from "../config.js";
import { pool, query } from "../db/connection.js";
import { normalizeEmail } from "./auth.service.js";
import { emailService, type EmailMessage } from "./email.service.js";
import { getInvitationPolicyWithClient } from "./app-settings.service.js";
import { generateOpaqueToken, hashToken } from "../utils/token.js";
import { notificationService } from "./notification.service.js";

type InvitationStatus =
  | "pending"
  | "waitlisted"
  | "registration_sent"
  | "accepted"
  | "expired"
  | "revoked";

interface InvitationRow {
  id: string;
  inviter_user_id: string;
  invitee_email: string;
  status: InvitationStatus;
  registration_token_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ActiveInvitationCountRow {
  invitation_count: string;
}

interface UserEmailRow {
  email: string;
}

interface RegistrationTokenInsertRow {
  id: string;
}

export class InvitationError extends Error {
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

function isValidEmail(email: string): boolean {
  return /.+@.+\..+/.test(email);
}

function mapInvitation(row: InvitationRow) {
  return {
    id: row.id,
    inviterUserId: row.inviter_user_id,
    inviteeEmail: row.invitee_email,
    status: row.status,
    registrationTokenId: row.registration_token_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listInvitationsForUser(inviterUserId: string): Promise<ReturnType<typeof mapInvitation>[]> {
  const result = await query<InvitationRow>(
    `
    SELECT id, inviter_user_id, invitee_email, status, registration_token_id, created_at::text, updated_at::text
    FROM invitations
    WHERE inviter_user_id = $1
    ORDER BY created_at DESC;
    `,
    [inviterUserId],
  );

  return result.rows.map(mapInvitation);
}

export async function createInvitationsForUser(input: {
  inviterUserId: string;
  emails: string[];
}): Promise<ReturnType<typeof mapInvitation>[]> {
  const normalizedEmails = [...new Set(input.emails.map((email) => normalizeEmail(email)))];
  if (normalizedEmails.length === 0) {
    throw new InvitationError("At least one invitee email is required", 400);
  }

  for (const email of normalizedEmails) {
    if (!isValidEmail(email)) {
      throw new InvitationError(`Invalid invitee email: ${email}`, 400);
    }
  }

  const client = await pool.connect();
  const outgoingEmails: EmailMessage[] = [];
  const createdInvitations: ReturnType<typeof mapInvitation>[] = [];

  try {
    await client.query("BEGIN");

    const inviterResult = await client.query<UserEmailRow>(
      `
      SELECT email
      FROM users
      WHERE id = $1
      FOR UPDATE;
      `,
      [input.inviterUserId],
    );

    const inviter = inviterResult.rows[0];
    if (!inviter) {
      throw new InvitationError("Inviter not found", 404);
    }

    const policy = await getInvitationPolicyWithClient(client);
    if (!policy.invitationsEnabled) {
      throw new InvitationError("Invitations are currently disabled", 403);
    }

    const countResult = await client.query<ActiveInvitationCountRow>(
      `
      SELECT COUNT(*)::text AS invitation_count
      FROM invitations
      WHERE inviter_user_id = $1
        AND status NOT IN ('revoked', 'expired');
      `,
      [input.inviterUserId],
    );

    const currentCount = Number(countResult.rows[0]?.invitation_count ?? "0");
    if (currentCount + normalizedEmails.length > policy.invitationQuotaPerUser) {
      throw new InvitationError("Invitation quota exceeded for this user", 403);
    }

    const inviterEmail = normalizeEmail(inviter.email);

    for (const inviteeEmail of normalizedEmails) {
      if (inviteeEmail === inviterEmail) {
        throw new InvitationError("You cannot invite your own email address", 400);
      }

      const existingUserResult = await client.query<{ id: string }>(
        `
        SELECT id
        FROM users
        WHERE email = $1
        LIMIT 1;
        `,
        [inviteeEmail],
      );

      if (existingUserResult.rows[0]) {
        throw new InvitationError(`Email is already registered: ${inviteeEmail}`, 409);
      }

      const existingInvitationResult = await client.query<InvitationRow>(
        `
        SELECT id, inviter_user_id, invitee_email, status, registration_token_id, created_at::text, updated_at::text
        FROM invitations
        WHERE inviter_user_id = $1
          AND invitee_email = $2
        FOR UPDATE;
        `,
        [input.inviterUserId, inviteeEmail],
      );

      const existingInvitation = existingInvitationResult.rows[0];
      if (existingInvitation && !["revoked", "expired"].includes(existingInvitation.status)) {
        throw new InvitationError(`Invite already exists for ${inviteeEmail}`, 409);
      }

      let status: InvitationStatus;
      let registrationTokenId: string | null = null;
      let registrationToken: string | null = null;

      if (policy.invitationWaitlistRequired) {
        status = "waitlisted";

        await client.query(
          `
          INSERT INTO waitlist_entries (email, marketing_consent, email_confirmed_at, status, approved_by, approved_at, updated_at)
          VALUES ($1, FALSE, NOW(), 'pending_admin_approval', NULL, NULL, NOW())
          ON CONFLICT (email)
          DO UPDATE SET
            status = 'pending_admin_approval',
            updated_at = NOW();
          `,
          [inviteeEmail],
        );

        outgoingEmails.push({
          to: inviteeEmail,
          subject: "You were invited to Chat3D (waitlist)",
          text: "You were invited to Chat3D and added to the waitlist. We will email you once approved.",
        });
      } else {
        status = "registration_sent";
        registrationToken = generateOpaqueToken();
        const registrationTokenHash = hashToken(registrationToken);

        const tokenResult = await client.query<RegistrationTokenInsertRow>(
          `
          INSERT INTO registration_tokens (token_hash, email, source, invited_by_user_id, max_uses, used_count, expires_at)
          VALUES ($1, $2, 'user_invite', $3, 1, 0, NOW() + make_interval(hours => $4))
          RETURNING id;
          `,
          [
            registrationTokenHash,
            inviteeEmail,
            input.inviterUserId,
            config.invitations.registrationTokenTtlHours,
          ],
        );

        registrationTokenId = tokenResult.rows[0].id;

        const registerUrl = appUrl(`/register?token=${encodeURIComponent(registrationToken)}`);
        outgoingEmails.push({
          to: inviteeEmail,
          subject: "You are invited to Chat3D",
          text: `You were invited to Chat3D. Complete registration here: ${registerUrl}`,
        });
      }

      let invitationRow: InvitationRow;

      if (existingInvitation) {
        const updatedResult = await client.query<InvitationRow>(
          `
          UPDATE invitations
          SET status = $3,
              registration_token_id = $4,
              updated_at = NOW()
          WHERE id = $1
            AND inviter_user_id = $2
          RETURNING id, inviter_user_id, invitee_email, status, registration_token_id, created_at::text, updated_at::text;
          `,
          [existingInvitation.id, input.inviterUserId, status, registrationTokenId],
        );

        invitationRow = updatedResult.rows[0];
      } else {
        const insertedResult = await client.query<InvitationRow>(
          `
          INSERT INTO invitations (inviter_user_id, invitee_email, status, registration_token_id)
          VALUES ($1, $2, $3, $4)
          RETURNING id, inviter_user_id, invitee_email, status, registration_token_id, created_at::text, updated_at::text;
          `,
          [input.inviterUserId, inviteeEmail, status, registrationTokenId],
        );

        invitationRow = insertedResult.rows[0];
      }

      createdInvitations.push(mapInvitation(invitationRow));
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  for (const emailMessage of outgoingEmails) {
    await emailService.sendTransactionalEmail(emailMessage);
  }

  for (const invitation of createdInvitations) {
    await notificationService.publishToUser(input.inviterUserId, "notification.created", {
      domain: "invitation",
      action: "created",
      invitationId: invitation.id,
      inviteeEmail: invitation.inviteeEmail,
      status: invitation.status,
    });
  }

  return createdInvitations;
}

export async function revokeInvitationForUser(input: {
  inviterUserId: string;
  invitationId: string;
}): Promise<ReturnType<typeof mapInvitation>> {
  const result = await query<InvitationRow>(
    `
    UPDATE invitations
    SET status = 'revoked',
        updated_at = NOW()
    WHERE id = $1
      AND inviter_user_id = $2
      AND status <> 'revoked'
    RETURNING id, inviter_user_id, invitee_email, status, registration_token_id, created_at::text, updated_at::text;
    `,
    [input.invitationId, input.inviterUserId],
  );

  const invitation = result.rows[0];
  if (!invitation) {
    throw new InvitationError("Invitation not found", 404);
  }

  const mapped = mapInvitation(invitation);

  await notificationService.publishToUser(input.inviterUserId, "notification.created", {
    domain: "invitation",
    action: "revoked",
    invitationId: mapped.id,
    inviteeEmail: mapped.inviteeEmail,
    status: mapped.status,
  });

  return mapped;
}
