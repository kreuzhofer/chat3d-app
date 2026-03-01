import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../db/prisma.js";
import { runAccountDeletionSweep } from "../workers/account-deletion.worker.js";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const expiredEmail = `m7-expired-${suffix}@example.test`;
const futureEmail = `m7-future-${suffix}@example.test`;
const password = "S3curePass!123";

async function insertDeactivatedUser(email: string, deactivatedUntil: Date): Promise<string> {
  const hash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: hash,
      displayName: "Deletion Worker User",
      role: "user",
      status: "deactivated",
      deactivatedUntil,
    },
    select: { id: true },
  });
  return user.id;
}

describe("account deletion worker", () => {
  let expiredUserId = "";
  let futureUserId = "";

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [expiredEmail, futureEmail] } },
    });

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tenDaysFromNow = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

    expiredUserId = await insertDeactivatedUser(expiredEmail, oneDayAgo);
    futureUserId = await insertDeactivatedUser(futureEmail, tenDaysFromNow);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [expiredUserId, futureUserId].filter(Boolean) } },
    });
    await prisma.$disconnect();
  });

  it("deletes users whose deactivation window has expired", async () => {
    const result = await runAccountDeletionSweep(10);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedUsers.some((item) => item.id === expiredUserId)).toBe(true);

    const expiredCheck = await prisma.user.findFirst({
      where: { id: expiredUserId },
      select: { id: true },
    });
    expect(expiredCheck).toBeNull();

    const futureCheck = await prisma.user.findFirst({
      where: { id: futureUserId },
      select: { id: true },
    });
    expect(futureCheck).not.toBeNull();
  });
});
