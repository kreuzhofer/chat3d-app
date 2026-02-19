import type { NextFunction, Request, Response } from "express";
import { findUserById, verifyAuthToken } from "../services/auth.service.js";
import { recordSecurityEvent } from "../services/security-audit.service.js";

function extractBearerToken(req: Request, allowQueryToken: boolean): string | null {
  const rawHeader = req.header("authorization");
  if (rawHeader) {
    const [scheme, token] = rawHeader.split(" ");
    if (scheme === "Bearer" && token) {
      return token;
    }
  }

  if (allowQueryToken) {
    const queryToken = req.query.token;
    if (typeof queryToken === "string" && queryToken.length > 0) {
      return queryToken;
    }
  }

  return null;
}

function buildAuthMiddleware(options: { allowQueryToken: boolean }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req, options.allowQueryToken);
    if (!token) {
      await recordSecurityEvent({
        eventType: "auth.missing_token",
        ipAddress: req.ip,
        path: req.path,
      });
      res.status(401).json({ error: "Missing authorization header" });
      return;
    }

    try {
      const claims = await verifyAuthToken(token);
      const user = await findUserById(claims.sub);

      if (!user) {
        await recordSecurityEvent({
          eventType: "auth.invalid_user",
          ipAddress: req.ip,
          path: req.path,
        });
        res.status(401).json({ error: "Invalid authentication token" });
        return;
      }

      if (user.status !== "active") {
        await recordSecurityEvent({
          eventType: "auth.inactive_user",
          userId: user.id,
          ipAddress: req.ip,
          path: req.path,
          metadata: {
            status: user.status,
          },
        });
        res.status(403).json({ error: "User account is not active" });
        return;
      }

      req.authUser = user;
      next();
    } catch (_error) {
      await recordSecurityEvent({
        eventType: "auth.invalid_token",
        ipAddress: req.ip,
        path: req.path,
      });
      res.status(401).json({ error: "Invalid authentication token" });
    }
  };
}

export const requireAuth = buildAuthMiddleware({ allowQueryToken: false });
export const requireAuthAllowQueryToken = buildAuthMiddleware({ allowQueryToken: true });
