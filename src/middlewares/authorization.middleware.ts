import type { RequestHandler } from "express";
import type { AuthenticatedUser, UserRole } from "../types/auth.js";

export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  return (_request, response, next) => {
    const user = response.locals.authenticatedUser as AuthenticatedUser | undefined;
    if (!user || !user.role) {
      response.status(401).json({ success: false, message: "Authentication required." });
      return;
    }
    if (!allowedRoles.includes(user.role)) {
      response.status(403).json({
        success: false,
        message: "You are not authorized to perform this action.",
      });
      return;
    }
    next();
  };
}
