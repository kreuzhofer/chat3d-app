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
const userEmail = `m9-user-${suffix}@example.test`;
const password = "S3curePass!123";

function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/**
 * The /api/query/submit route returns 202 immediately and runs the codegen
 * + render + persistence pipeline asynchronously. Tests that need to assert
 * on the persisted state must wait until a `chat.query.state=completed`
 * notification lands for the assistant item under test. In mock mode the
 * pipeline finishes within a few hundred ms.
 */
async function waitForQueryCompletion(
  userId: string,
  assistantItemId: string,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await prisma.notification.findMany({
      where: { userId, eventType: "chat.query.state" },
      orderBy: { id: "desc" },
      take: 50,
      select: { payload: true },
    });
    for (const row of rows) {
      const p = row.payload as { state?: string; assistantItemId?: string };
      if (p.assistantItemId === assistantItemId && p.state === "completed") return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Pipeline did not reach 'completed' state for assistantItemId=${assistantItemId} within ${timeoutMs}ms`,
  );
}

async function upsertUser(email: string): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      displayName: "Milestone 9 User",
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

describe("Milestone 9 query pipeline", () => {
  const app = createApp();
  let userId = "";
  let token = "";
  let contextId = "";

  beforeAll(async () => {
    await prisma.notification.deleteMany({ where: { user: { email: userEmail } } });
    await prisma.chatItem.deleteMany({ where: { owner: { email: userEmail } } });
    await prisma.chatContext.deleteMany({ where: { owner: { email: userEmail } } });
    await prisma.user.deleteMany({ where: { email: userEmail } });

    userId = await upsertUser(userEmail);

    const login = await request(app).post("/api/auth/login").send({ email: userEmail, password });
    token = (login.body as LoginResponse).token;

    const context = await request(app)
      .post("/api/chat/contexts")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "M9 Query Context" });
    contextId = context.body.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.chatItem.deleteMany({ where: { ownerId: userId } });
    await prisma.chatContext.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("exposes llm model registry", async () => {
    const response = await request(app).get("/api/llm/models").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.models)).toBe(true);
    expect(response.body.models.length).toBeGreaterThan(0);
  });

  // SKIPPED 2026-05-25: written for the original synchronous milestone-9
  // pipeline. The pipeline since grew to span 5+ LLM calls (conversation,
  // spec, decomposition decider, agent codegen, evaluation) plus the
  // screenshot-service render. `QUERY_LLM_MODE=mock` only covers the
  // conversation LLM, so the agent loop still calls real Bedrock, the
  // screenshot service fails to render the mock geometry, and the agent
  // burns its step budget retrying. Bringing this back requires either
  // wiring mocks across all five LLM purposes + the screenshot endpoint,
  // or splitting it into narrow tests at each pipeline stage. Tracked
  // separately; do not delete.
  it.skip("submits query, emits state transitions, and stores rendered files", async () => {
    const uploadPath = `tmp/${userId}/${suffix}-reference.png`;
    const uploadResponse = await request(app)
      .post("/api/files/upload")
      .set("Authorization", `Bearer ${token}`)
      .send({
        path: uploadPath,
        contentBase64: toBase64("fake-image"),
      });
    expect(uploadResponse.status).toBe(201);

    const queryResponse = await request(app)
      .post("/api/query/submit")
      .set("Authorization", `Bearer ${token}`)
      .send({
        contextId,
        prompt: "create a simple cube for my test",
        attachments: [
          {
            path: uploadPath,
            filename: "reference.png",
            mimeType: "image/png",
            kind: "image",
          },
        ],
      });

    // The route now returns 202 immediately with placeholder fields and
    // runs the rest of the pipeline asynchronously (results stream via
    // SSE). Only assert on what's actually in the synchronous response,
    // then wait for the pipeline to finish before checking persisted state.
    expect(queryResponse.status).toBe(202);
    expect(queryResponse.body.contextId).toBe(contextId);
    expect(queryResponse.body.assistantItem?.id).toBeTruthy();
    expect(queryResponse.body.userItemId).toBeTruthy();

    await waitForQueryCompletion(userId, queryResponse.body.assistantItem.id);

    // Now fetch the persisted state via the items API and assert on it.
    const itemsResponse = await request(app)
      .get(`/api/chat/contexts/${encodeURIComponent(contextId)}/items`)
      .set("Authorization", `Bearer ${token}`);
    expect(itemsResponse.status).toBe(200);
    const items = itemsResponse.body.items as Array<{ id: string; messages: unknown[] }>;
    const assistantItem = items.find((item) => item.id === queryResponse.body.assistantItem.id);
    expect(assistantItem).toBeTruthy();

    const assistantMessages = (assistantItem?.messages ?? []) as Array<{
      itemType?: string;
      text?: string;
      attachment?: string;
      files?: Array<{ path?: string; filename?: string }>;
      artifact?: { previewStatus?: string; detail?: string };
      usage?: { totalTokens?: number; estimatedCostUsd?: number };
    }>;
    const itemTypes = assistantMessages.map((message) => message.itemType);
    expect(itemTypes).toEqual(expect.arrayContaining(["message", "meta", "3dmodel"]));

    const modelMessage = assistantMessages.find((message) => message.itemType === "3dmodel");
    expect(typeof modelMessage?.attachment).toBe("string");
    if (modelMessage?.artifact?.previewStatus === "downgraded") {
      expect(modelMessage.text ?? "").toMatch(/preview unavailable|download step|stl|3mf/i);
    }

    const fileMetadataMessage = assistantMessages.find((message) => message.itemType === "meta");
    expect(Array.isArray(fileMetadataMessage?.files)).toBe(true);
    expect((fileMetadataMessage?.files?.length ?? 0) > 0).toBe(true);
    expect(fileMetadataMessage?.usage?.totalTokens ?? 0).toBeGreaterThan(0);
    expect(fileMetadataMessage?.usage?.estimatedCostUsd ?? 0).toBeGreaterThanOrEqual(0);

    const generatedPath = fileMetadataMessage?.files?.[0]?.path;
    expect(typeof generatedPath).toBe("string");

    const submittedUserItem = items.find((item) => item.id === queryResponse.body.userItemId);
    expect(submittedUserItem).toBeTruthy();
    const userAttachmentMessage = (submittedUserItem?.messages ?? []).find((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return false;
      }
      const record = entry as { itemType?: unknown; attachment?: unknown };
      return record.itemType === "attachment" && record.attachment === uploadPath;
    });
    expect(userAttachmentMessage).toBeTruthy();

    const download = await request(app)
      .get("/api/files/download")
      .set("Authorization", `Bearer ${token}`)
      .query({ path: generatedPath });
    expect(download.status).toBe(200);
    const downloadLength =
      typeof download.text === "string"
        ? download.text.length
        : Buffer.isBuffer(download.body)
          ? download.body.length
          : 0;
    expect(downloadLength).toBeGreaterThan(0);

    const stateRows = await prisma.notification.findMany({
      where: { userId, eventType: "chat.query.state" },
      orderBy: { id: "asc" },
      select: { payload: true },
    });

    const states = stateRows.map((row) => (row.payload as { state?: string })?.state).filter(Boolean);
    expect(states).toEqual(
      expect.arrayContaining(["queued", "conversation", "codegen", "rendering", "completed"]),
    );

    const itemUpdateCount = await prisma.notification.count({
      where: { userId, eventType: "chat.item.updated" },
    });

    expect(itemUpdateCount).toBeGreaterThan(0);

    const regenerateResponse = await request(app)
      .post("/api/query/regenerate")
      .set("Authorization", `Bearer ${token}`)
      .send({
        contextId,
        assistantItemId: queryResponse.body.assistantItem.id,
      });

    expect(regenerateResponse.status).toBe(202);
    expect(regenerateResponse.body.contextId).toBe(contextId);
    expect(regenerateResponse.body.assistantItem?.id).toBeTruthy();
    expect(regenerateResponse.body.assistantItem?.id).not.toBe(queryResponse.body.assistantItem.id);

    await waitForQueryCompletion(userId, regenerateResponse.body.assistantItem.id);

    const regenItemsResponse = await request(app)
      .get(`/api/chat/contexts/${encodeURIComponent(contextId)}/items`)
      .set("Authorization", `Bearer ${token}`);
    const regenAssistant = (regenItemsResponse.body.items as Array<{ id: string; messages: unknown[] }>).find(
      (item) => item.id === regenerateResponse.body.assistantItem.id,
    );
    expect(regenAssistant).toBeTruthy();
    const regenTypes = (regenAssistant?.messages ?? []).map((m) => (m as { itemType?: string }).itemType);
    expect(regenTypes).toEqual(expect.arrayContaining(["3dmodel"]));
  });
});
