import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";
import { USER_ROLES, type AuthenticatedUser, type UserRole } from "../types/auth.js";
import { hashOpaqueValue } from "../services/session.service.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { AUTH_COOKIE_NAME, CSRF_HEADER_NAME, readAuthCookie } from "../utils/auth-cookie.js";

export { AUTH_COOKIE_NAME, CSRF_HEADER_NAME } from "../utils/auth-cookie.js";

interface AuthenticationUserRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthenticationDatabase {
  query(
    sql: string,
    values: string[],
  ): Promise<{ rows: AuthenticationUserRecord[] }>;
}

const authenticationDatabase: AuthenticationDatabase = {
  query: (sql, values) => pool.query<AuthenticationUserRecord>(sql, values),
};

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

export function requireAuthenticatedUser(
  database: AuthenticationDatabase = authenticationDatabase,
): RequestHandler {
  return async (request, response, next): Promise<void> => {
    const token = readAuthCookie(request.headers.cookie);
    if (!token) {
      response.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      response.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    let user: AuthenticationUserRecord | undefined;
    try {
      const result = await database.query(
        `SELECT id, name, email, role
         FROM users
         JOIN user_sessions ON user_sessions.user_id = users.id
         WHERE id = $1 AND is_active = TRUE
           AND user_sessions.session_hash = $2
           AND user_sessions.revoked_at IS NULL
           AND user_sessions.expires_at > NOW()
         LIMIT 1`,
        [payload.userId, hashOpaqueValue(token)],
      );
      user = result.rows[0];
    } catch {
      console.error("Authentication user lookup failed.");
      response.status(503).json({
        success: false,
        message: "Authentication service is temporarily unavailable.",
      });
      return;
    }

    if (!user || !USER_ROLES.includes(user.role)) {
      response.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const authenticatedUser: AuthenticatedUser = {
      ...user,
      csrfToken: payload.csrfToken,
      sessionHash: hashOpaqueValue(token),
    };
    response.locals.authenticatedUser = authenticatedUser;
    next();
  };
}

export function requireCsrfToken(): RequestHandler {
  return (request, response, next) => {
    const user = response.locals.authenticatedUser as AuthenticatedUser | undefined;
    const headerToken = request.get(CSRF_HEADER_NAME);

    if (
      !user
      || !headerToken
      || !/^[A-Za-z0-9_-]{43}$/.test(headerToken)
      || !timingSafeEqual(Buffer.from(headerToken), Buffer.from(user.csrfToken))
    ) {
      response.status(403).json({ success: false, message: "CSRF token is invalid or missing." });
      return;
    }

    next();
  };
}
