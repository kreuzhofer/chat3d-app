import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { prisma } from "../db/prisma.js";

interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: "admin" | "user";
    status: "active" | "deactivated" | "pending_registration";
    displayName: string | null;
  };
}

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ownerEmail = `m8-owner-${suffix}@example.test`;
const strangerEmail = `m8-stranger-${suffix}@example.test`;
const password = "S3curePass!123";

async function upsertUser(email: string): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      displayName: "Milestone 8 User",
      role: "user",
      status: "active",
    },
    update: {
      passwordHash,
      role: "user",
      status: "active",
      updatedAt: new Date(),
    },
    select: { id: true },
  });
  return user.id;
}

describe("Milestone 8 chat/files migration", () => {
  const app = createApp();
  let ownerId = "";
  let strangerId = "";
  let ownerToken = "";
  let strangerToken = "";
  let contextId = "";
  let itemId = "";

  beforeAll(async () => {
    const allEmails = [ownerEmail, strangerEmail];

    // Find user IDs for cleanup
    const existingUsers = await prisma.user.findMany({
      where: { email: { in: allEmails } },
      select: { id: true },
    });
    const existingUserIds = existingUsers.map((u) => u.id);

    if (existingUserIds.length > 0) {
      await prisma.notification.deleteMany({ where: { userId: { in: existingUserIds } } });
      await prisma.chatItem.deleteMany({ where: { ownerId: { in: existingUserIds } } });
      await prisma.chatContext.deleteMany({ where: { ownerId: { in: existingUserIds } } });
    }
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });

    ownerId = await upsertUser(ownerEmail);
    strangerId = await upsertUser(strangerEmail);

    const ownerLogin = await request(app).post("/api/auth/login").send({ email: ownerEmail, password });
    ownerToken = (ownerLogin.body as LoginResponse).token;

    const strangerLogin = await request(app).post("/api/auth/login").send({ email: strangerEmail, password });
    strangerToken = (strangerLogin.body as LoginResponse).token;
  });

  afterAll(async () => {
    const userIds = [ownerId, strangerId].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.chatItem.deleteMany({ where: { ownerId: { in: userIds } } });
      await prisma.chatContext.deleteMany({ where: { ownerId: { in: userIds } } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("creates, lists, updates and deletes chat contexts and items with ownership checks", async () => {
    const createContext = await request(app)
      .post("/api/chat/contexts")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "M8 Context" });

    expect(createContext.status).toBe(201);
    contextId = createContext.body.id;

    const listContexts = await request(app)
      .get("/api/chat/contexts")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(listContexts.status).toBe(200);
    expect(listContexts.body.contexts.some((ctx: { id: string }) => ctx.id === contextId)).toBe(true);

    const strangerListItems = await request(app)
      .get(`/api/chat/contexts/${contextId}/items`)
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(strangerListItems.status).toBe(404);

    const createItem = await request(app)
      .post(`/api/chat/contexts/${contextId}/items`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        role: "user",
        messages: [{ itemType: "message", text: "hello model", state: "completed", stateMessage: "" }],
      });

    expect(createItem.status).toBe(201);
    itemId = createItem.body.id;

    const listItems = await request(app)
      .get(`/api/chat/contexts/${contextId}/items`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(listItems.status).toBe(200);
    expect(listItems.body.items.some((item: { id: string }) => item.id === itemId)).toBe(true);

    const updateItem = await request(app)
      .patch(`/api/chat/contexts/${contextId}/items/${itemId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ rating: 1 });
    expect(updateItem.status).toBe(200);
    expect(updateItem.body.rating).toBe(1);

    const chatEvents = await prisma.notification.findMany({
      where: { userId: ownerId },
      orderBy: { id: "desc" },
      select: { eventType: true, payload: true },
    });

    expect(
      chatEvents.some(
        (row) =>
          row.eventType === "chat.item.updated" &&
          (row.payload as { itemId?: string; action?: string })?.itemId === itemId &&
          ["created", "updated"].includes((row.payload as { action?: string })?.action ?? ""),
      ),
    ).toBe(true);

    const deleteItem = await request(app)
      .delete(`/api/chat/contexts/${contextId}/items/${itemId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(deleteItem.status).toBe(204);

    const deleteContext = await request(app)
      .delete(`/api/chat/contexts/${contextId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(deleteContext.status).toBe(204);
  });

  it("uploads, downloads and deletes files via local storage endpoints", async () => {
    const fileContent = Buffer.from("milestone-8-file-content", "utf8");
    const base64Content = fileContent.toString("base64");
    const filePath = `tmp/${ownerId}/m8-note.txt`;

    const uploadResponse = await request(app)
      .post("/api/files/upload")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        path: filePath,
        contentBase64: base64Content,
        contentType: "text/plain",
      });

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.path).toBe(filePath);

    const downloadResponse = await request(app)
      .get("/api/files/download")
      .set("Authorization", `Bearer ${ownerToken}`)
      .query({ path: filePath });

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.text).toBe("milestone-8-file-content");
    expect(downloadResponse.headers["content-disposition"]).toContain('filename="m8-note.txt"');

    const deleteResponse = await request(app)
      .delete("/api/files/delete")
      .set("Authorization", `Bearer ${ownerToken}`)
      .query({ path: filePath });

    expect(deleteResponse.status).toBe(204);

    const missingDownload = await request(app)
      .get("/api/files/download")
      .set("Authorization", `Bearer ${ownerToken}`)
      .query({ path: filePath });

    expect(missingDownload.status).toBe(404);
  });

  it("serves binary file downloads with metadata headers", async () => {
    const binaryContent = Buffer.from([1, 2, 3, 4, 5, 6]);
    const filePath = `tmp/${ownerId}/m8-model.stl`;

    const uploadResponse = await request(app)
      .post("/api/files/upload")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        path: filePath,
        contentBase64: binaryContent.toString("base64"),
      });

    expect(uploadResponse.status).toBe(201);

    const downloadResponse = await request(app)
      .get("/api/files/download")
      .set("Authorization", `Bearer ${ownerToken}`)
      .query({ path: filePath });

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers["content-type"]).toContain("application/vnd.ms-pki.stl");
    expect(downloadResponse.headers["content-disposition"]).toContain('filename="m8-model.stl"');
    const payloadLength =
      typeof downloadResponse.text === "string"
        ? downloadResponse.text.length
        : Buffer.isBuffer(downloadResponse.body)
          ? downloadResponse.body.length
          : 0;
    expect(payloadLength).toBeGreaterThan(0);

    const deleteResponse = await request(app)
      .delete("/api/files/delete")
      .set("Authorization", `Bearer ${ownerToken}`)
      .query({ path: filePath });

    expect(deleteResponse.status).toBe(204);
  });
});
