import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import {
  sessionService,
  type SessionService,
} from "../services/session.service.js";

export const SESSION_COOKIE_NAME = "ayra_session";
export const CSRF_HEADER_NAME = "x-csrf-token";

function readCookie(requestCookie: string | undefined, name: string): string | undefined {
  if (!requestCookie) return undefined;

  const entry = requestCookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!entry) return undefined;

  try {
    return decodeURIComponent(entry.slice(name.length + 1));
  } catch {
    return undefined;
  }
}

export function requireTrustedOrigin(
  allowedOrigins: readonly string[] = env.CLIENT_URL,
): RequestHandler {
  return (request, response, next) => {
    const origin = request.get("origin");
    if (!origin || !allowedOrigins.includes(origin)) {
      response.status(403).json({
        success: false,
        message: "Request origin is not allowed.",
      });
      return;
    }
    next();
  };
}

export function requireAuthenticatedSession(
  sessions: SessionService = sessionService,
): RequestHandler {
  return async (request, response, next) => {
    const sessionId = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    if (!sessionId) {
      response.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    try {
      const session = await sessions.authenticate(sessionId);
      if (!session) {
        response.status(401).json({ success: false, message: "Authentication required." });
        return;
      }

      response.locals.authenticatedSession = session;
      next();
    } catch {
      response.status(503).json({
        success: false,
        message: "Authentication service is temporarily unavailable.",
      });
    }
  };
}

export function requireCsrfToken(
  sessions: SessionService = sessionService,
): RequestHandler {
  return async (request, response, next) => {
    const session = response.locals.authenticatedSession as
      | { sessionId: string }
      | undefined;
    const headerToken = request.get(CSRF_HEADER_NAME);

    if (
      !session
      || !headerToken
      || !/^[A-Za-z0-9_-]{43}$/.test(headerToken)
    ) {
      response.status(403).json({ success: false, message: "CSRF token is invalid or missing." });
      return;
    }

    try {
      if (!await sessions.validateCsrf(session.sessionId, headerToken)) {
        response.status(403).json({ success: false, message: "CSRF token is invalid or missing." });
        return;
      }
      next();
    } catch {
      response.status(503).json({
        success: false,
        message: "Authentication service is temporarily unavailable.",
      });
    }
  };
}
