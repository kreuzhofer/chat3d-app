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
const ownerEmail = `m8-owner-${suffix}@example.test`;
const strangerEmail = `m8-stranger-${suffix}@example.test`;
const password = "S3curePass!123";

async function upsertUser(email: string): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await query<{ id: string }>(
    `
    INSERT INTO users (email, password_hash, display_name, role, status)
    VALUES ($1, $2, 'Milestone 8 User', 'user', 'active')
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

describe("Milestone 8 chat/files migration", () => {
  const app = createApp();
  let ownerId = "";
  let strangerId = "";
  let ownerToken = "";
  let strangerToken = "";
  let contextId = "";
  let itemId = "";

  beforeAll(async () => {
    await query(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]));`, [
      [ownerEmail, strangerEmail],
    ]);
    await query(`DELETE FROM chat_items WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1::text[]));`, [
      [ownerEmail, strangerEmail],
    ]);
    await query(`DELETE FROM chat_contexts WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1::text[]));`, [
      [ownerEmail, strangerEmail],
    ]);
    await query(`DELETE FROM users WHERE email = ANY($1::text[]);`, [[ownerEmail, strangerEmail]]);

    ownerId = await upsertUser(ownerEmail);
    strangerId = await upsertUser(strangerEmail);

    const ownerLogin = await request(app).post("/api/auth/login").send({ email: ownerEmail, password });
    ownerToken = (ownerLogin.body as LoginResponse).token;

    const strangerLogin = await request(app).post("/api/auth/login").send({ email: strangerEmail, password });
    strangerToken = (strangerLogin.body as LoginResponse).token;
  });

  afterAll(async () => {
    await query(`DELETE FROM notifications WHERE user_id IN ($1, $2);`, [ownerId, strangerId]);
    await query(`DELETE FROM chat_items WHERE owner_id IN ($1, $2);`, [ownerId, strangerId]);
    await query(`DELETE FROM chat_contexts WHERE owner_id IN ($1, $2);`, [ownerId, strangerId]);
    await query(`DELETE FROM users WHERE id IN ($1, $2);`, [ownerId, strangerId]);
    await pool.end();
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

    const chatEvents = await query<{ event_type: string; payload: { action?: string; itemId?: string } }>(
      `
      SELECT event_type, payload
      FROM notifications
      WHERE user_id = $1
      ORDER BY id DESC;
      `,
      [ownerId],
    );

    expect(
      chatEvents.rows.some(
        (row) =>
          row.event_type === "chat.item.updated" &&
          row.payload?.itemId === itemId &&
          ["created", "updated"].includes(row.payload?.action ?? ""),
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

    const uploadResponse = await request(app)
      .post("/api/files/upload")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        path: "upload/m8-note.txt",
        contentBase64: base64Content,
        contentType: "text/plain",
      });

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.path).toBe("upload/m8-note.txt");

    const downloadResponse = await request(app)
      .get("/api/files/download")
      .set("Authorization", `Bearer ${ownerToken}`)
      .query({ path: "upload/m8-note.txt" });

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.text).toBe("milestone-8-file-content");

    const deleteResponse = await request(app)
      .delete("/api/files/delete")
      .set("Authorization", `Bearer ${ownerToken}`)
      .query({ path: "upload/m8-note.txt" });

    expect(deleteResponse.status).toBe(204);

    const missingDownload = await request(app)
      .get("/api/files/download")
      .set("Authorization", `Bearer ${ownerToken}`)
      .query({ path: "upload/m8-note.txt" });

    expect(missingDownload.status).toBe(404);
  });
});
