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
const registeredEmail = `m2-register-${suffix}@example.test`;
const userEmail = `m2-user-${suffix}@example.test`;
const adminEmail = `m2-admin-${suffix}@example.test`;
const deactivatedEmail = `m2-deactivated-${suffix}@example.test`;
const password = "S3curePass!123";

async function insertUser(
  email: string,
  role: "admin" | "user",
  status: "active" | "deactivated" | "pending_registration",
) {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await query<{ id: string }>(
    `
    INSERT INTO users (email, password_hash, display_name, role, status)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id;
    `,
    [email, passwordHash, `${role} test`, role, status],
  );
  return result.rows[0].id;
}

describe("Milestone 2 auth integration", () => {
  const app = createApp();

  beforeAll(async () => {
    await query(
      `
      DELETE FROM users
      WHERE email = ANY($1::text[]);
      `,
      [[registeredEmail, userEmail, adminEmail, deactivatedEmail]],
    );

    await insertUser(userEmail, "user", "active");
    await insertUser(adminEmail, "admin", "active");
    await insertUser(deactivatedEmail, "user", "deactivated");
  });

  afterAll(async () => {
    await query(
      `
      DELETE FROM users
      WHERE email = ANY($1::text[]);
      `,
      [[registeredEmail, userEmail, adminEmail, deactivatedEmail]],
    );
    await pool.end();
  });

  it("registers a user with hashed password and issues a token", async () => {
    const registerResponse = await request(app).post("/api/auth/register").send({
      email: registeredEmail,
      password,
      displayName: "Registered User",
    });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.token).toBeTypeOf("string");
    expect(registerResponse.body.user.email).toBe(registeredEmail);
    expect(registerResponse.body.user.role).toBe("user");
    expect(registerResponse.body.user.status).toBe("active");

    const storedUser = await query<{ password_hash: string }>(
      `
      SELECT password_hash
      FROM users
      WHERE email = $1;
      `,
      [registeredEmail],
    );

    const hash = storedUser.rows[0]?.password_hash;
    expect(hash).toBeTruthy();
    expect(hash).not.toBe(password);
    expect(await bcrypt.compare(password, hash!)).toBe(true);
  });

  it("logs in and returns the authenticated profile on /api/auth/me", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      email: userEmail,
      password,
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.email).toBe(userEmail);

    const token = (loginResponse.body as LoginResponse).token;
    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.email).toBe(userEmail);
    expect(meResponse.body.role).toBe("user");
    expect(meResponse.body.status).toBe("active");
  });

  it("blocks non-admin access to admin routes and allows admin users", async () => {
    const userLogin = await request(app).post("/api/auth/login").send({
      email: userEmail,
      password,
    });
    const userToken = (userLogin.body as LoginResponse).token;

    const userAdminResponse = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${userToken}`);

    expect(userAdminResponse.status).toBe(403);

    const adminLogin = await request(app).post("/api/auth/login").send({
      email: adminEmail,
      password,
    });
    const adminToken = (adminLogin.body as LoginResponse).token;

    const adminUsersResponse = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(adminUsersResponse.status).toBe(200);
    expect(Array.isArray(adminUsersResponse.body.users)).toBe(true);
    expect(adminUsersResponse.body.users.length).toBeGreaterThan(0);
  });

  it("denies login and authenticated access for deactivated users", async () => {
    const deactivatedLogin = await request(app).post("/api/auth/login").send({
      email: deactivatedEmail,
      password,
    });

    expect(deactivatedLogin.status).toBe(403);

    const activeLogin = await request(app).post("/api/auth/login").send({
      email: userEmail,
      password,
    });
    const token = (activeLogin.body as LoginResponse).token;

    await query(`UPDATE users SET status = 'deactivated' WHERE email = $1;`, [userEmail]);

    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(meResponse.status).toBe(403);

    await query(`UPDATE users SET status = 'active' WHERE email = $1;`, [userEmail]);
  });
});
