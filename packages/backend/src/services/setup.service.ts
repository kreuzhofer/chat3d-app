import { prisma } from "../db/prisma.js";
import {
  assertValidPassword,
  hashPassword,
  issueAuthToken,
  normalizeEmail,
  type AuthenticatedUser,
} from "./auth.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("setup");

export async function isSetupRequired(): Promise<boolean> {
  const count = await prisma.user.count();
  return count === 0;
}

interface InitialSetupInput {
  email: string;
  password: string;
  displayName?: string;
}

interface InitialSetupResult {
  token: string;
  user: AuthenticatedUser;
}

export async function completeInitialSetup(input: InitialSetupInput): Promise<InitialSetupResult> {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName?.trim() || null;

  if (!email || !input.password) {
    throw Object.assign(new Error("Email and password are required"), { statusCode: 400 });
  }

  if (!assertValidPassword(input.password)) {
    throw Object.assign(new Error("Password must be at least 8 characters"), { statusCode: 400 });
  }

  const passwordHash = await hashPassword(input.password);

  const result = await prisma.$transaction(async (tx) => {
    const existingCount = await tx.user.count();
    if (existingCount > 0) {
      throw Object.assign(new Error("Setup has already been completed"), { statusCode: 409 });
    }

    const admin = await tx.user.create({
      data: {
        email,
        passwordHash,
        displayName,
        role: "admin",
        status: "active",
      },
      select: { id: true, email: true, displayName: true, role: true, status: true },
    });

    await tx.appSettings.upsert({
      where: { id: true },
      update: {
        updatedBy: admin.id,
        updatedAt: new Date(),
      },
      create: {
        id: true,
        waitlistEnabled: false,
        invitationsEnabled: true,
        invitationWaitlistRequired: false,
        invitationQuotaPerUser: 3,
        updatedBy: admin.id,
      },
    });

    return {
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      role: admin.role as "admin",
      status: admin.status as "active",
    };
  });

  const token = await issueAuthToken(result);

  logger.info({ email: result.email }, "initial setup completed — admin account created");

  return { token, user: result };
}
