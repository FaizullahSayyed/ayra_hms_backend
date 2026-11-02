import type { RequestHandler } from "express";
import { CSRF_HEADER_NAME } from "../middlewares/session.middleware.js";
import {
  sessionService,
  type SessionService,
} from "../services/session.service.js";

export function createCurrentUserHandler(
  sessions: SessionService = sessionService,
): RequestHandler {
  return async (_request, response): Promise<void> => {
    const session = response.locals.authenticatedSession as
      | {
        id: string;
        name: string;
        email: string;
        role: string;
        sessionId: string;
      }
      | undefined;

    if (!session) {
      response.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    try {
      const csrfToken = await sessions.refreshCsrf(session.sessionId);
      if (!csrfToken) {
        response.status(401).json({ success: false, message: "Authentication required." });
        return;
      }

      response.setHeader("Cache-Control", "no-store");
      response.setHeader(CSRF_HEADER_NAME, csrfToken);
      response.status(200).json({
        success: true,
        user: {
          name: session.name,
          email: session.email,
          role: session.role,
        },
      });
    } catch {
      console.error("Current-user session refresh failed.");
      response.status(503).json({
        success: false,
        message: "Authentication service is temporarily unavailable.",
      });
    }
  };
}

export const getCurrentUser = createCurrentUserHandler();
