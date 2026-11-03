import type { RequestHandler } from "express";
import { CSRF_HEADER_NAME } from "../middlewares/session.middleware.js";
import type { AuthenticatedUser } from "../types/auth.js";

export function createCurrentUserHandler(): RequestHandler {
  return (_request, response): void => {
    const user = response.locals.authenticatedUser as AuthenticatedUser | undefined;

    if (!user) {
      response.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    response.setHeader("Cache-Control", "no-store");
    response.setHeader(CSRF_HEADER_NAME, user.csrfToken);
    response.status(200).json({
      success: true,
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  };
}

export const getCurrentUser = createCurrentUserHandler();
