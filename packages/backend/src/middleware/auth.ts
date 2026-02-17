import type { NextFunction, Request, Response } from "express";
import { findUserById, verifyAuthToken } from "../services/auth.service.js";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const rawHeader = req.header("authorization");
  if (!rawHeader) {
    res.status(401).json({ error: "Missing authorization header" });
    return;
  }

  const [scheme, token] = rawHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: "Invalid authorization header format" });
    return;
  }

  try {
    const claims = await verifyAuthToken(token);
    const user = await findUserById(claims.sub);

    if (!user) {
      res.status(401).json({ error: "Invalid authentication token" });
      return;
    }

    if (user.status !== "active") {
      res.status(403).json({ error: "User account is not active" });
      return;
    }

    req.authUser = user;
    next();
  } catch (_error) {
    res.status(401).json({ error: "Invalid authentication token" });
  }
}
