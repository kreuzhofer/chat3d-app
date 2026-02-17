import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { config } from "../config.js";
import { query } from "../db/connection.js";

export type UserRole = "admin" | "user";
export type UserStatus = "active" | "deactivated" | "pending_registration";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  displayName: string | null;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  role: UserRole;
  status: UserStatus;
}

interface JwtClaims {
  sub: string;
  email: string;
  role: UserRole;
}

const encoder = new TextEncoder();
const jwtSecret = encoder.encode(config.auth.jwtSecret);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertValidPassword(password: string): boolean {
  return password.length >= 8;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

function mapUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    displayName: row.display_name,
  };
}

export async function findUserByEmail(email: string): Promise<(AuthenticatedUser & { passwordHash: string }) | null> {
  const result = await query<UserRow>(
    `
    SELECT id, email, password_hash, display_name, role, status
    FROM users
    WHERE email = $1;
    `,
    [normalizeEmail(email)],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    ...mapUser(row),
    passwordHash: row.password_hash,
  };
}

export async function findUserById(id: string): Promise<AuthenticatedUser | null> {
  const result = await query<UserRow>(
    `
    SELECT id, email, password_hash, display_name, role, status
    FROM users
    WHERE id = $1;
    `,
    [id],
  );

  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

export async function createUser(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthenticatedUser> {
  const passwordHash = await hashPassword(input.password);
  const email = normalizeEmail(input.email);
  const displayName = input.displayName?.trim() || null;

  const result = await query<UserRow>(
    `
    INSERT INTO users (email, password_hash, display_name, role, status)
    VALUES ($1, $2, $3, 'user', 'active')
    RETURNING id, email, password_hash, display_name, role, status;
    `,
    [email, passwordHash, displayName],
  );

  return mapUser(result.rows[0]);
}

export async function issueAuthToken(user: AuthenticatedUser): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .setIssuer("chat3d-backend")
    .setAudience("chat3d-client")
    .sign(jwtSecret);
}

export async function verifyAuthToken(token: string): Promise<JwtClaims> {
  const verified = await jwtVerify(token, jwtSecret, {
    issuer: "chat3d-backend",
    audience: "chat3d-client",
  });

  const { sub } = verified.payload;
  const email = verified.payload.email;
  const role = verified.payload.role;

  if (!sub || typeof email !== "string" || (role !== "admin" && role !== "user")) {
    throw new Error("Invalid token payload");
  }

  return {
    sub,
    email,
    role,
  };
}
