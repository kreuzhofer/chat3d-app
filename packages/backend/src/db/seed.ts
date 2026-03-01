import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { prisma } from "./prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("seed");

async function seed() {
  const passwordHash = await bcrypt.hash(config.auth.seedAdminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: config.auth.seedAdminEmail },
    update: {
      passwordHash,
      displayName: config.auth.seedAdminDisplayName,
      role: "admin",
      status: "active",
      updatedAt: new Date(),
    },
    create: {
      email: config.auth.seedAdminEmail,
      passwordHash,
      displayName: config.auth.seedAdminDisplayName,
      role: "admin",
      status: "active",
    },
    select: { id: true },
  });

  await prisma.appSettings.upsert({
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

  logger.info("Admin user seeded: %s", config.auth.seedAdminEmail);
  logger.info("Default app settings seeded");
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    logger.error({ err: error }, "Seed failed");
    await prisma.$disconnect();
    process.exit(1);
  });
