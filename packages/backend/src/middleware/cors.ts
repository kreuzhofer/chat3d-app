import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

function isAllowedOrigin(origin: string): boolean {
  return config.security.corsAllowedOrigins.includes(origin);
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.header("origin");

  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  }

  if (req.method === "OPTIONS") {
    res.status(204).send();
    return;
  }

  next();
}
