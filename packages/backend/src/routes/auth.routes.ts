import { Router } from "express";
import { prisma } from "../db/prisma.js";
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

authRouter.post("/register", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName : undefined;
  const registrationToken =
    typeof req.body?.registrationToken === "string" ? req.body.registrationToken : "";

  if (!email || !password) {
    res.status(400).json({ error: req.t("errors:auth.emailAndPasswordRequired") });
    return;
  }

  if (!assertValidPassword(password)) {
    res.status(400).json({ error: req.t("errors:auth.passwordMinLength") });
    return;
  }

  const normalizedEmail = normalizeEmail(email);
  const waitlistEnabled = await isWaitlistEnabled();

  if (waitlistEnabled && !registrationToken) {
    res.status(403).json({ error: req.t("errors:auth.registrationTokenRequired") });
    return;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // FOR UPDATE lock to prevent duplicate registrations
      const existingRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM users WHERE email = ${normalizedEmail} FOR UPDATE
      `;

      if (existingRows[0]) {
        throw Object.assign(new Error(req.t("errors:auth.emailAlreadyRegistered")), { statusCode: 409 });
      }

      if (waitlistEnabled) {
        await consumeRegistrationToken({
          rawToken: registrationToken,
          email: normalizedEmail,
          tx,
        });
      }

      const passwordHash = await hashPassword(password);
      const normalizedDisplayName = displayName?.trim() || null;

      const inserted = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          displayName: normalizedDisplayName,
          role: "user",
          status: "active",
        },
        select: { id: true, email: true, displayName: true, role: true, status: true },
      });

      return {
        id: inserted.id,
        email: inserted.email,
        displayName: inserted.displayName,
        role: inserted.role,
        status: inserted.status,
      };
    });

    const token = await issueAuthToken(result);
    res.status(201).json({ token, user: result });
  } catch (error) {
    if (error instanceof WaitlistError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 409) {
      res.status(409).json({ error: (error as Error).message });
      return;
    }

    res.status(500).json({ error: req.t("errors:auth.registrationFailed"), detail: String(error) });
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
    res.status(400).json({ error: req.t("errors:auth.emailAndPasswordRequired") });
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
    res.status(401).json({ error: req.t("errors:auth.invalidCredentials") });
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
    res.status(403).json({ error: req.t("errors:auth.accountNotActive") });
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
    res.status(401).json({ error: req.t("errors:auth.invalidCredentials") });
    return;
  }

  const { passwordHash: _passwordHash, ...user } = userWithPassword;
  const token = await issueAuthToken(user);

  res.status(200).json({ token, user });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json({ error: req.t("errors:auth.authenticationRequired") });
    return;
  }

  // Include language from DB
  const dbUser = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { language: true },
  });

  res.status(200).json({ ...authUser, language: dbUser?.language ?? "en" });
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  await recordSecurityEvent({
    eventType: "auth.logout",
    userId: req.authUser?.id,
    ipAddress: req.ip,
    path: req.path,
  });

  res.status(204).send();
});
