import type { Prisma } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db/prisma.js";
import { generateOpaqueToken, hashToken } from "../utils/token.js";
import { normalizeEmail } from "./auth.service.js";
import { emailService } from "./email.service.js";

type WaitlistStatus =
  | "pending_email_confirmation"
  | "pending_admin_approval"
  | "approved"
  | "rejected";

export class WaitlistError extends Error {
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

export async function joinWaitlist(input: {
  email: string;
  marketingConsent: boolean;
}): Promise<{ entryId: string; status: WaitlistStatus }> {
  const normalizedEmail = normalizeEmail(input.email);

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (existingUser) {
    throw new WaitlistError("Email is already registered", 409);
  }

  // Upsert: reset entry to pending_email_confirmation state
  const entry = await prisma.waitlistEntry.upsert({
    where: { email: normalizedEmail },
    create: {
      email: normalizedEmail,
      marketingConsent: input.marketingConsent,
      status: "pending_email_confirmation",
    },
    update: {
      marketingConsent: input.marketingConsent,
      status: "pending_email_confirmation",
      emailConfirmedAt: null,
      approvedBy: null,
      approvedAt: null,
      updatedAt: new Date(),
    },
    select: { id: true, email: true, status: true },
  });

  const confirmationToken = generateOpaqueToken();
  const tokenHash = hashToken(confirmationToken);

  await prisma.waitlistEmailConfirmation.create({
    data: {
      waitlistEntryId: entry.id,
      tokenHash,
      expiresAt: new Date(Date.now() + config.waitlist.confirmationTokenTtlHours * 3600 * 1000),
    },
  });

  const confirmationUrl = appUrl(`/waitlist/confirm?token=${encodeURIComponent(confirmationToken)}`);

  await emailService.sendTransactionalEmail({
    to: entry.email,
    subject: "Confirm your waitlist request",
    text: `Please confirm your waitlist request by opening: ${confirmationUrl}`,
  });

  return {
    entryId: entry.id,
    status: entry.status as WaitlistStatus,
  };
}

export async function confirmWaitlistEmail(rawToken: string): Promise<{
  entryId: string;
  email: string;
  status: WaitlistStatus;
}> {
  const tokenHash = hashToken(rawToken);

  return prisma.$transaction(async (tx) => {
    // FOR UPDATE lock on the confirmation + entry
    const rows = await tx.$queryRaw<Array<{
      id: string;
      waitlist_entry_id: string;
      email: string;
      status: string;
      expires_at: Date;
      consumed_at: Date | null;
    }>>`
      SELECT c.id,
             c.waitlist_entry_id,
             c.expires_at,
             c.consumed_at,
             e.email,
             e.status
      FROM waitlist_email_confirmations c
      INNER JOIN waitlist_entries e ON e.id = c.waitlist_entry_id
      WHERE c.token_hash = ${tokenHash}
      FOR UPDATE
    `;

    const confirmation = rows[0];
    if (!confirmation) {
      throw new WaitlistError("Invalid waitlist confirmation token", 400);
    }

    if (confirmation.consumed_at) {
      throw new WaitlistError("Waitlist confirmation token has already been used", 400);
    }

    if (confirmation.expires_at.getTime() < Date.now()) {
      throw new WaitlistError("Waitlist confirmation token has expired", 400);
    }

    await tx.waitlistEmailConfirmation.update({
      where: { id: confirmation.id },
      data: { consumedAt: new Date() },
    });

    if (confirmation.status === "rejected") {
      throw new WaitlistError("Waitlist entry has been rejected", 409);
    }

    const entry = await tx.waitlistEntry.update({
      where: { id: confirmation.waitlist_entry_id },
      data: {
        status: "pending_admin_approval",
        emailConfirmedAt: new Date(),
        updatedAt: new Date(),
      },
      select: { id: true, email: true, status: true },
    });

    return {
      entryId: entry.id,
      email: entry.email,
      status: entry.status as WaitlistStatus,
    };
  });
}

export async function getWaitlistStatus(input: {
  email?: string;
  confirmationToken?: string;
}): Promise<{
  entryId: string;
  email: string;
  status: WaitlistStatus;
  marketingConsent: boolean;
  emailConfirmedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
}> {
  if (!input.email && !input.confirmationToken) {
    throw new WaitlistError("Either email or token is required", 400);
  }

  let row: {
    id: string;
    email: string;
    status: string;
    marketingConsent: boolean;
    emailConfirmedAt: Date | null;
    approvedAt: Date | null;
    createdAt: Date;
  } | null = null;

  if (input.confirmationToken) {
    const tokenHash = hashToken(input.confirmationToken);
    const confirmation = await prisma.waitlistEmailConfirmation.findUnique({
      where: { tokenHash },
      select: {
        waitlistEntry: {
          select: {
            id: true,
            email: true,
            status: true,
            marketingConsent: true,
            emailConfirmedAt: true,
            approvedAt: true,
            createdAt: true,
          },
        },
      },
    });
    row = confirmation?.waitlistEntry ?? null;
  } else if (input.email) {
    row = await prisma.waitlistEntry.findUnique({
      where: { email: normalizeEmail(input.email) },
      select: {
        id: true,
        email: true,
        status: true,
        marketingConsent: true,
        emailConfirmedAt: true,
        approvedAt: true,
        createdAt: true,
      },
    });
  }

  if (!row) {
    throw new WaitlistError("Waitlist entry not found", 404);
  }

  return {
    entryId: row.id,
    email: row.email,
    status: row.status as WaitlistStatus,
    marketingConsent: row.marketingConsent,
    emailConfirmedAt: row.emailConfirmedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function approveWaitlistEntry(input: {
  waitlistEntryId: string;
  approvedByUserId: string;
}): Promise<{ entryId: string; email: string; status: WaitlistStatus }> {
  const result = await prisma.$transaction(async (tx) => {
    // FOR UPDATE lock on the waitlist entry
    const rows = await tx.$queryRaw<Array<{
      id: string;
      email: string;
      status: string;
    }>>`
      SELECT id, email, status
      FROM waitlist_entries
      WHERE id = ${input.waitlistEntryId}::uuid
      FOR UPDATE
    `;

    const entry = rows[0];
    if (!entry) {
      throw new WaitlistError("Waitlist entry not found", 404);
    }

    if (entry.status !== "pending_admin_approval") {
      throw new WaitlistError("Waitlist entry is not pending admin approval", 409);
    }

    const registrationToken = generateOpaqueToken();
    const registrationTokenHash = hashToken(registrationToken);

    await tx.registrationToken.create({
      data: {
        tokenHash: registrationTokenHash,
        email: entry.email,
        source: "waitlist",
        maxUses: 1,
        usedCount: 0,
        expiresAt: new Date(Date.now() + config.waitlist.registrationTokenTtlHours * 3600 * 1000),
      },
    });

    const approvedEntry = await tx.waitlistEntry.update({
      where: { id: input.waitlistEntryId },
      data: {
        status: "approved",
        approvedBy: input.approvedByUserId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      },
      select: { id: true, email: true, status: true },
    });

    return { approvedEntry, registrationToken };
  });

  const registrationUrl = appUrl(`/register?token=${encodeURIComponent(result.registrationToken)}`);
  await emailService.sendTransactionalEmail({
    to: result.approvedEntry.email,
    subject: "Registration link for Chat3D",
    text: `Your waitlist entry was approved. Register here: ${registrationUrl}`,
  });

  return {
    entryId: result.approvedEntry.id,
    email: result.approvedEntry.email,
    status: result.approvedEntry.status as WaitlistStatus,
  };
}

export async function rejectWaitlistEntry(input: {
  waitlistEntryId: string;
  approvedByUserId: string;
}): Promise<{ entryId: string; email: string; status: WaitlistStatus }> {
  // updateMany returns count; we need the actual entry. Use findFirst + update.
  const existing = await prisma.waitlistEntry.findFirst({
    where: {
      id: input.waitlistEntryId,
      status: { in: ["pending_email_confirmation", "pending_admin_approval"] },
    },
    select: { id: true },
  });

  if (!existing) {
    throw new WaitlistError("Waitlist entry not found or cannot be rejected", 404);
  }

  const entry = await prisma.waitlistEntry.update({
    where: { id: existing.id },
    data: {
      status: "rejected",
      approvedBy: input.approvedByUserId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    },
    select: { id: true, email: true, status: true },
  });

  return {
    entryId: entry.id,
    email: entry.email,
    status: entry.status as WaitlistStatus,
  };
}

export async function listWaitlistEntries(limit = 100): Promise<
  Array<{
    id: string;
    email: string;
    status: WaitlistStatus;
    marketingConsent: boolean;
    emailConfirmedAt: string | null;
    approvedAt: string | null;
    createdAt: string;
  }>
> {
  const rows = await prisma.waitlistEntry.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      email: true,
      status: true,
      marketingConsent: true,
      emailConfirmedAt: true,
      approvedAt: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    status: row.status as WaitlistStatus,
    marketingConsent: row.marketingConsent,
    emailConfirmedAt: row.emailConfirmedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function consumeRegistrationToken(input: {
  rawToken: string;
  email: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const tokenHash = hashToken(input.rawToken);
  const normalizedEmail = normalizeEmail(input.email);

  // FOR UPDATE lock on the token
  const rows = await input.tx.$queryRaw<Array<{
    id: string;
    email: string;
    used_count: number;
    max_uses: number;
    consumed_at: Date | null;
    expires_at: Date | null;
  }>>`
    SELECT id, email, used_count, max_uses, consumed_at, expires_at
    FROM registration_tokens
    WHERE token_hash = ${tokenHash}
    FOR UPDATE
  `;

  const token = rows[0];
  if (!token) {
    throw new WaitlistError("Invalid registration token", 403);
  }

  if (normalizeEmail(token.email) !== normalizedEmail) {
    throw new WaitlistError("Invalid registration token for this email", 403);
  }

  if (token.consumed_at) {
    throw new WaitlistError("Registration token has already been consumed", 403);
  }

  if (token.expires_at && token.expires_at.getTime() < Date.now()) {
    throw new WaitlistError("Registration token has expired", 403);
  }

  if (token.used_count >= token.max_uses) {
    throw new WaitlistError("Registration token has already been consumed", 403);
  }

  const nextUsedCount = token.used_count + 1;
  await input.tx.registrationToken.update({
    where: { id: token.id },
    data: {
      usedCount: nextUsedCount,
      consumedAt: nextUsedCount >= token.max_uses ? new Date() : undefined,
    },
  });
}
