import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { prisma } from "../db/prisma.js";

describe("public config routes", () => {
  const app = createApp();

  beforeAll(async () => {
    await prisma.appSettings.upsert({
      where: { id: true },
      create: {
        id: true,
        waitlistEnabled: false,
        invitationsEnabled: true,
        invitationWaitlistRequired: false,
        invitationQuotaPerUser: 3,
      },
      update: {
        waitlistEnabled: false,
        invitationsEnabled: true,
        invitationWaitlistRequired: false,
        invitationQuotaPerUser: 3,
        updatedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns waitlist mode from app settings", async () => {
    await prisma.appSettings.update({
      where: { id: true },
      data: { waitlistEnabled: false, updatedAt: new Date() },
    });
    const disabledResponse = await request(app).get("/api/public/config");
    expect(disabledResponse.status).toBe(200);
    expect(disabledResponse.body.waitlistEnabled).toBe(false);

    await prisma.appSettings.update({
      where: { id: true },
      data: { waitlistEnabled: true, updatedAt: new Date() },
    });
    const enabledResponse = await request(app).get("/api/public/config");
    expect(enabledResponse.status).toBe(200);
    expect(enabledResponse.body.waitlistEnabled).toBe(true);
  });
});
