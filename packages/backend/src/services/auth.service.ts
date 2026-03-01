import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { config } from "../config.js";
import { prisma } from "../db/prisma.js";

export type UserRole = "admin" | "user";
export type UserStatus = "active" | "deactivated" | "pending_registration";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  displayName: string | null;
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

export async function findUserByEmail(email: string): Promise<(AuthenticatedUser & { passwordHash: string }) | null> {
  const row = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, email: true, passwordHash: true, displayName: true, role: true, status: true },
  });

  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
  };
}

export async function findUserById(id: string): Promise<AuthenticatedUser | null> {
  const row = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, displayName: true, role: true, status: true },
  });

  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    displayName: row.displayName,
  };
}

export async function createUser(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthenticatedUser> {
  const passwordHash = await hashPassword(input.password);
  const email = normalizeEmail(input.email);
  const displayName = input.displayName?.trim() || null;

  const row = await prisma.user.create({
    data: { email, passwordHash, displayName, role: "user", status: "active" },
    select: { id: true, email: true, displayName: true, role: true, status: true },
  });

  return {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    displayName: row.displayName,
  };
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
