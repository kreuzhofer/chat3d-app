import type { NextFunction, Request, Response } from "express";

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none';");
  res.setHeader("Cache-Control", req.path.startsWith("/api/events/stream") ? "no-cache" : "no-store");
  next();
}
