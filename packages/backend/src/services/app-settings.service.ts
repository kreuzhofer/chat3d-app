import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";

export async function isWaitlistEnabled(): Promise<boolean> {
  const row = await prisma.appSettings.findUnique({ where: { id: true }, select: { waitlistEnabled: true } });
  return row ? row.waitlistEnabled : false;
}

export async function isEmailConfirmationEnabled(): Promise<boolean> {
  const row = await prisma.appSettings.findUnique({ where: { id: true }, select: { emailConfirmationEnabled: true } });
  return row ? row.emailConfirmationEnabled : true;
}

export interface InvitationPolicy {
  invitationsEnabled: boolean;
  invitationWaitlistRequired: boolean;
  invitationQuotaPerUser: number;
}

const INVITATION_POLICY_DEFAULTS: InvitationPolicy = {
  invitationsEnabled: true,
  invitationWaitlistRequired: false,
  invitationQuotaPerUser: 3,
};

async function readInvitationPolicy(
  tx?: Prisma.TransactionClient,
): Promise<InvitationPolicy> {
  const client = tx ?? prisma;
  const row = await client.appSettings.findUnique({
    where: { id: true },
    select: {
      invitationsEnabled: true,
      invitationWaitlistRequired: true,
      invitationQuotaPerUser: true,
    },
  });

  if (!row) return INVITATION_POLICY_DEFAULTS;

  return {
    invitationsEnabled: row.invitationsEnabled,
    invitationWaitlistRequired: row.invitationWaitlistRequired,
    invitationQuotaPerUser: row.invitationQuotaPerUser,
  };
}

export async function getInvitationPolicy(): Promise<InvitationPolicy> {
  return readInvitationPolicy();
}

export async function getInvitationPolicyTx(
  tx: Prisma.TransactionClient,
): Promise<InvitationPolicy> {
  return readInvitationPolicy(tx);
}
