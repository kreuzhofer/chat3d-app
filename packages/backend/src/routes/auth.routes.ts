import { Router } from "express";
import type { QueryResultRow } from "pg";
import { pool } from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";
import {
  assertValidPassword,
  findUserByEmail,
  hashPassword,
  issueAuthToken,
  normalizeEmail,
  verifyPassword,
} from "../services/auth.service.js";
import { isWaitlistEnabled } from "../services/app-settings.service.js";
import { recordSecurityEvent } from "../services/security-audit.service.js";
import { consumeRegistrationToken, WaitlistError } from "../services/waitlist.service.js";

export const authRouter = Router();

interface RegisterUserRow extends QueryResultRow {
  id: string;
  email: string;
  display_name: string | null;
  role: "admin" | "user";
  status: "active" | "deactivated" | "pending_registration";
}

authRouter.post("/register", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName : undefined;
  const registrationToken =
    typeof req.body?.registrationToken === "string" ? req.body.registrationToken : "";

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  if (!assertValidPassword(password)) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const normalizedEmail = normalizeEmail(email);
  const waitlistEnabled = await isWaitlistEnabled();

  if (waitlistEnabled && !registrationToken) {
    res.status(403).json({ error: "A valid registration token is required while waitlist is enabled" });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query<{ id: string }>(
      `
      SELECT id
      FROM users
      WHERE email = $1
      FOR UPDATE;
      `,
      [normalizedEmail],
    );

    if (existingResult.rows[0]) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Email is already registered" });
      return;
    }

    if (waitlistEnabled) {
      await consumeRegistrationToken({
        rawToken: registrationToken,
        email: normalizedEmail,
        client,
      });
    }

    const passwordHash = await hashPassword(password);
    const normalizedDisplayName = displayName?.trim() || null;

    const insertResult = await client.query<RegisterUserRow>(
      `
      INSERT INTO users (email, password_hash, display_name, role, status)
      VALUES ($1, $2, $3, 'user', 'active')
      RETURNING id, email, display_name, role, status;
      `,
      [normalizedEmail, passwordHash, normalizedDisplayName],
    );

    await client.query("COMMIT");

    const inserted = insertResult.rows[0];
    const user = {
      id: inserted.id,
      email: inserted.email,
      displayName: inserted.display_name,
      role: inserted.role,
      status: inserted.status,
    };

    const token = await issueAuthToken(user);
    res.status(201).json({ token, user });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof WaitlistError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Failed to register user", detail: String(error) });
  } finally {
    client.release();
  }
});

authRouter.post("/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    await recordSecurityEvent({
      eventType: "auth.login.bad_request",
      ipAddress: req.ip,
      path: req.path,
    });
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const userWithPassword = await findUserByEmail(email);
  if (!userWithPassword) {
    await recordSecurityEvent({
      eventType: "auth.login.invalid_credentials",
      ipAddress: req.ip,
      path: req.path,
      metadata: {
        email,
      },
    });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (userWithPassword.status !== "active") {
    await recordSecurityEvent({
      eventType: "auth.login.inactive_user",
      userId: userWithPassword.id,
      ipAddress: req.ip,
      path: req.path,
      metadata: {
        status: userWithPassword.status,
      },
    });
    res.status(403).json({ error: "User account is not active" });
    return;
  }

  const validPassword = await verifyPassword(password, userWithPassword.passwordHash);
  if (!validPassword) {
    await recordSecurityEvent({
      eventType: "auth.login.invalid_credentials",
      userId: userWithPassword.id,
      ipAddress: req.ip,
      path: req.path,
    });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const { passwordHash: _passwordHash, ...user } = userWithPassword;
  const token = await issueAuthToken(user);

  res.status(200).json({ token, user });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.status(200).json(req.authUser);
});
