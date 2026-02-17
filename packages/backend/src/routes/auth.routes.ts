import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  assertValidPassword,
  createUser,
  findUserByEmail,
  issueAuthToken,
  normalizeEmail,
  verifyPassword,
} from "../services/auth.service.js";

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName : undefined;

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  if (!assertValidPassword(password)) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      res.status(409).json({ error: "Email is already registered" });
      return;
    }

    const user = await createUser({
      email: normalizedEmail,
      password,
      displayName,
    });

    const token = await issueAuthToken(user);
    res.status(201).json({ token, user });
  } catch (error) {
    res.status(500).json({ error: "Failed to register user", detail: String(error) });
  }
});

authRouter.post("/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const userWithPassword = await findUserByEmail(email);
  if (!userWithPassword) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (userWithPassword.status !== "active") {
    res.status(403).json({ error: "User account is not active" });
    return;
  }

  const validPassword = await verifyPassword(password, userWithPassword.passwordHash);
  if (!validPassword) {
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
