import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { pool, query } from "../db/connection.js";

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

async function upsertUser(email: string): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await query<{ id: string }>(
    `
    INSERT INTO users (email, password_hash, display_name, role, status)
    VALUES ($1, $2, 'Milestone 9 User', 'user', 'active')
    ON CONFLICT (email)
    DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      role = 'user',
      status = 'active',
      updated_at = NOW()
    RETURNING id;
    `,
    [email, passwordHash],
  );
  return result.rows[0].id;
}

describe("Milestone 9 query pipeline", () => {
  const app = createApp();
  let userId = "";
  let token = "";
  let contextId = "";

  beforeAll(async () => {
    await query(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email = $1);`, [userEmail]);
    await query(`DELETE FROM chat_items WHERE owner_id IN (SELECT id FROM users WHERE email = $1);`, [userEmail]);
    await query(`DELETE FROM chat_contexts WHERE owner_id IN (SELECT id FROM users WHERE email = $1);`, [userEmail]);
    await query(`DELETE FROM users WHERE email = $1;`, [userEmail]);

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
    await query(`DELETE FROM notifications WHERE user_id = $1;`, [userId]);
    await query(`DELETE FROM chat_items WHERE owner_id = $1;`, [userId]);
    await query(`DELETE FROM chat_contexts WHERE owner_id = $1;`, [userId]);
    await query(`DELETE FROM users WHERE id = $1;`, [userId]);
    await pool.end();
  });

  it("exposes llm model registry", async () => {
    const response = await request(app).get("/api/llm/models").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.models)).toBe(true);
    expect(response.body.models.length).toBeGreaterThan(0);
  });

  it("submits query, emits state transitions, and stores rendered files", async () => {
    const uploadPath = `uploads/${suffix}-reference.png`;
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

    expect(queryResponse.status).toBe(202);
    expect(queryResponse.body.contextId).toBe(contextId);
    expect(queryResponse.body.assistantItem?.id).toBeTruthy();
    expect(queryResponse.body.userItemId).toBeTruthy();
    expect(Array.isArray(queryResponse.body.generatedFiles)).toBe(true);
    expect(queryResponse.body.generatedFiles.length).toBeGreaterThan(0);
    expect(Array.isArray(queryResponse.body.assistantItem?.messages)).toBe(true);
    expect(queryResponse.body.artifact?.previewStatus).toMatch(/ready|downgraded/);
    expect(queryResponse.body.usage?.totalTokens).toBeGreaterThan(0);
    expect(queryResponse.body.usage?.estimatedCostUsd).toBeGreaterThanOrEqual(0);

    const assistantMessages = queryResponse.body.assistantItem?.messages as Array<{
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

    const generatedPath = queryResponse.body.generatedFiles[0]?.path;
    expect(typeof generatedPath).toBe("string");

    const itemsResponse = await request(app)
      .get(`/api/chat/contexts/${encodeURIComponent(contextId)}/items`)
      .set("Authorization", `Bearer ${token}`);
    expect(itemsResponse.status).toBe(200);
    const submittedUserItem = (itemsResponse.body.items as Array<{ id: string; messages: unknown[] }>).find(
      (item) => item.id === queryResponse.body.userItemId,
    );
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

    const stateRows = await query<{ payload: { state?: string } }>(
      `
      SELECT payload
      FROM notifications
      WHERE user_id = $1
        AND event_type = 'chat.query.state'
      ORDER BY id ASC;
      `,
      [userId],
    );

    const states = stateRows.rows.map((row) => row.payload?.state).filter(Boolean);
    expect(states).toEqual(
      expect.arrayContaining(["queued", "conversation", "codegen", "rendering", "completed"]),
    );

    const itemUpdateRows = await query<{ event_type: string }>(
      `
      SELECT event_type
      FROM notifications
      WHERE user_id = $1
        AND event_type = 'chat.item.updated';
      `,
      [userId],
    );

    expect(itemUpdateRows.rows.length).toBeGreaterThan(0);

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
    expect(Array.isArray(regenerateResponse.body.generatedFiles)).toBe(true);
    expect(regenerateResponse.body.generatedFiles.length).toBeGreaterThan(0);
  });
});
