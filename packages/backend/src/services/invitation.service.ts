import { config } from "../config.js";
import { prisma } from "../db/prisma.js";
import { normalizeEmail } from "./auth.service.js";
import { emailService, type EmailMessage } from "./email.service.js";
import { getInvitationPolicy } from "./app-settings.service.js";
import { generateOpaqueToken, hashToken } from "../utils/token.js";
import { notificationService } from "./notification.service.js";

type InvitationStatus =
  | "pending"
  | "waitlisted"
  | "registration_sent"
  | "accepted"
  | "expired"
  | "revoked";

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

function mapInvitation(row: {
  id: string;
  inviterUserId: string;
  inviteeEmail: string;
  status: string;
  registrationTokenId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    inviterUserId: row.inviterUserId,
    inviteeEmail: row.inviteeEmail,
    status: row.status as InvitationStatus,
    registrationTokenId: row.registrationTokenId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listInvitationsForUser(inviterUserId: string): Promise<ReturnType<typeof mapInvitation>[]> {
  const rows = await prisma.invitation.findMany({
    where: { inviterUserId },
    orderBy: { createdAt: "desc" },
  });

  return rows.map(mapInvitation);
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

  const outgoingEmails: EmailMessage[] = [];
  const createdInvitations: ReturnType<typeof mapInvitation>[] = [];

  await prisma.$transaction(async (tx) => {
    // FOR UPDATE lock on the inviter user row
    const inviterRows = await tx.$queryRaw<Array<{ email: string }>>`
      SELECT email FROM users WHERE id = ${input.inviterUserId}::uuid FOR UPDATE
    `;

    const inviter = inviterRows[0];
    if (!inviter) {
      throw new InvitationError("Inviter not found", 404);
    }

    const policy = await getInvitationPolicy();
    if (!policy.invitationsEnabled) {
      throw new InvitationError("Invitations are currently disabled", 403);
    }

    const currentCount = await tx.invitation.count({
      where: {
        inviterUserId: input.inviterUserId,
        status: { notIn: ["revoked", "expired"] },
      },
    });

    if (currentCount + normalizedEmails.length > policy.invitationQuotaPerUser) {
      throw new InvitationError("Invitation quota exceeded for this user", 403);
    }

    const inviterEmail = normalizeEmail(inviter.email);

    for (const inviteeEmail of normalizedEmails) {
      if (inviteeEmail === inviterEmail) {
        throw new InvitationError("You cannot invite your own email address", 400);
      }

      const existingUser = await tx.user.findUnique({
        where: { email: inviteeEmail },
        select: { id: true },
      });

      if (existingUser) {
        throw new InvitationError(`Email is already registered: ${inviteeEmail}`, 409);
      }

      // FOR UPDATE lock on existing invitation
      const existingRows = await tx.$queryRaw<Array<{
        id: string;
        inviter_user_id: string;
        invitee_email: string;
        status: string;
        registration_token_id: string | null;
        created_at: Date;
        updated_at: Date;
      }>>`
        SELECT id, inviter_user_id, invitee_email, status, registration_token_id, created_at, updated_at
        FROM invitations
        WHERE inviter_user_id = ${input.inviterUserId}::uuid
          AND invitee_email = ${inviteeEmail}
        FOR UPDATE
      `;

      const existingInvitation = existingRows[0];
      if (existingInvitation && !["revoked", "expired"].includes(existingInvitation.status)) {
        throw new InvitationError(`Invite already exists for ${inviteeEmail}`, 409);
      }

      let status: InvitationStatus;
      let registrationTokenId: string | null = null;
      let registrationToken: string | null = null;

      if (policy.invitationWaitlistRequired) {
        status = "waitlisted";

        await tx.waitlistEntry.upsert({
          where: { email: inviteeEmail },
          create: {
            email: inviteeEmail,
            marketingConsent: false,
            emailConfirmedAt: new Date(),
            status: "pending_admin_approval",
          },
          update: {
            status: "pending_admin_approval",
            updatedAt: new Date(),
          },
        });

        outgoingEmails.push({
          to: inviteeEmail,
          subject: "You were invited to Chat3D (waitlist)",
          text: "You were invited to Chat3D and added to the waitlist. We will email you once approved.",
        });
      } else {
        status = "registration_sent";
        registrationToken = generateOpaqueToken();
        const registrationTokenHash = hashToken(registrationToken);

        const tokenRow = await tx.registrationToken.create({
          data: {
            tokenHash: registrationTokenHash,
            email: inviteeEmail,
            source: "user_invite",
            invitedByUserId: input.inviterUserId,
            maxUses: 1,
            usedCount: 0,
            expiresAt: new Date(Date.now() + config.invitations.registrationTokenTtlHours * 3600 * 1000),
          },
          select: { id: true },
        });

        registrationTokenId = tokenRow.id;

        const registerUrl = appUrl(`/register?token=${encodeURIComponent(registrationToken)}`);
        outgoingEmails.push({
          to: inviteeEmail,
          subject: "You are invited to Chat3D",
          text: `You were invited to Chat3D. Complete registration here: ${registerUrl}`,
        });
      }

      let invitationRow;

      if (existingInvitation) {
        invitationRow = await tx.invitation.update({
          where: { id: existingInvitation.id },
          data: {
            status,
            registrationTokenId,
            updatedAt: new Date(),
          },
        });
      } else {
        invitationRow = await tx.invitation.create({
          data: {
            inviterUserId: input.inviterUserId,
            inviteeEmail: inviteeEmail,
            status,
            registrationTokenId,
          },
        });
      }

      createdInvitations.push(mapInvitation(invitationRow));
    }
  });

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
  const existing = await prisma.invitation.findFirst({
    where: {
      id: input.invitationId,
      inviterUserId: input.inviterUserId,
      status: { not: "revoked" },
    },
    select: { id: true },
  });

  if (!existing) {
    throw new InvitationError("Invitation not found", 404);
  }

  const row = await prisma.invitation.update({
    where: { id: existing.id },
    data: { status: "revoked", updatedAt: new Date() },
  });

  const mapped = mapInvitation(row);

  await notificationService.publishToUser(input.inviterUserId, "notification.created", {
    domain: "invitation",
    action: "revoked",
    invitationId: mapped.id,
    inviteeEmail: mapped.inviteeEmail,
    status: mapped.status,
  });

  return mapped;
}
