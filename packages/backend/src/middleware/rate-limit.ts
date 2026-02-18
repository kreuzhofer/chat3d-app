import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { recordSecurityEvent } from "../services/security-audit.service.js";

interface Counter {
  count: number;
  expiresAtMs: number;
}

const counters = new Map<string, Counter>();

function getClientIp(req: Request): string {
  const forwardedFor = req.header("x-forwarded-for");
  if (forwardedFor) {
    const [first] = forwardedFor.split(",");
    if (first?.trim()) {
      return first.trim();
    }
  }
  return req.ip || "unknown";
}

function getSensitiveIdentifier(req: Request): string {
  if (req.path === "/api/profile/reactivate/request" && typeof req.body?.email === "string") {
    return req.body.email.trim().toLowerCase();
  }
  if (req.path === "/api/auth/login" && typeof req.body?.email === "string") {
    return req.body.email.trim().toLowerCase();
  }
  return "none";
}

function determineMaxRequests(req: Request): number {
  const path = req.path;
  if (path === "/api/profile/reactivate/request") {
    return config.security.rateLimitReactivateMax;
  }
  if (path === "/api/auth/login") {
    return config.security.rateLimitLoginMax;
  }
  if (path === "/api/query/submit") {
    return config.security.rateLimitQueryMax;
  }
  return config.security.rateLimitGeneralMax;
}

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/health" || req.path === "/ready") {
    next();
    return;
  }

  const maxRequests = determineMaxRequests(req);
  const now = Date.now();
  const key = `${getClientIp(req)}:${req.path}:${req.method}:${getSensitiveIdentifier(req)}`;
  const current = counters.get(key);
  const expiresAtMs = now + config.security.rateLimitWindowMs;

  let nextCounter: Counter;
  if (!current || current.expiresAtMs <= now) {
    nextCounter = {
      count: 1,
      expiresAtMs,
    };
  } else {
    nextCounter = {
      count: current.count + 1,
      expiresAtMs: current.expiresAtMs,
    };
  }

  counters.set(key, nextCounter);
  const retryAfterSeconds = Math.max(1, Math.ceil((nextCounter.expiresAtMs - now) / 1000));
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.setHeader("X-RateLimit-Limit", String(maxRequests));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, maxRequests - nextCounter.count)));

  if (nextCounter.count > maxRequests) {
    await recordSecurityEvent({
      eventType: "rate_limit.exceeded",
      userId: req.authUser?.id ?? null,
      ipAddress: getClientIp(req),
      path: req.path,
      metadata: {
        method: req.method,
        maxRequests,
        count: nextCounter.count,
      },
    });

    res.status(429).json({ error: "Too many requests" });
    return;
  }

  next();
}
