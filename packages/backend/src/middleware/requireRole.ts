import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../services/auth.service.js";

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (!roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}
