import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { pool } from "../config/database.js";
import { CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from "../middlewares/session.middleware.js";
import { USER_ROLES, type UserRole } from "../types/auth.js";
import { comparePassword, hashPassword } from "../utils/password.js";
import { loginSchema } from "../validators/auth.validator.js";
import {
  sessionService,
  type SessionService,
} from "../services/session.service.js";

interface LoginUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  password_hash: string;
  is_active: boolean;
}

interface LoginDatabase {
  query(
    sql: string,
    values: string[],
  ): Promise<{ rows: LoginUser[] }>;
}

interface SessionCookieSettings {
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  ttlDays: number;
}

interface LoginHandlerDependencies {
  database: LoginDatabase;
  sessions: SessionService;
  verifyPassword: typeof comparePassword;
  dummyPasswordHash: Promise<string>;
  cookieSettings: SessionCookieSettings;
}

type LoginOperation = "user lookup" | "session creation";

const loginDatabase: LoginDatabase = {
  query: (sql, values) => pool.query<LoginUser>(sql, values),
};

const dummyPasswordHash = hashPassword(randomBytes(32).toString("base64url"));

const defaultDependencies: LoginHandlerDependencies = {
  database: loginDatabase,
  sessions: sessionService,
  verifyPassword: comparePassword,
  dummyPasswordHash,
  cookieSettings: {
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: env.SESSION_COOKIE_SAME_SITE,
    ttlDays: env.SESSION_TTL_DAYS,
  },
};

function getDatabaseErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
    && /^[0-9A-Z]{5}$/.test(error.code)
  ) {
    return error.code;
  }
  return undefined;
}

export function createLoginHandler(
  dependencies: LoginHandlerDependencies = defaultDependencies,
): RequestHandler {
  return async (request, response): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");

    const validation = loginSchema.safeParse(request.body);
    if (!validation.success) {
      response.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
      return;
    }

    let operation: LoginOperation = "user lookup";
    try {
      const { email, password } = validation.data;
      const result = await dependencies.database.query(
        `SELECT id, name, email, role, password_hash, is_active
         FROM users
         WHERE email = $1
         LIMIT 1`,
        [email],
      );
      const user = result.rows[0];
      const passwordHash = user?.password_hash ?? await dependencies.dummyPasswordHash;
      const passwordMatches = await dependencies.verifyPassword(password, passwordHash);

      if (!user || !user.is_active || !passwordMatches) {
        response.status(401).json({
          success: false,
          message: "Invalid email or password.",
        });
        return;
      }

      if (!USER_ROLES.includes(user.role)) {
        throw new Error("User record contains an unsupported role.");
      }

      operation = "session creation";
      const credentials = await dependencies.sessions.create(user.id);
      const cookieAttributes = {
        secure: dependencies.cookieSettings.secure,
        sameSite: dependencies.cookieSettings.sameSite,
        path: "/api/v1/auth",
        maxAge: dependencies.cookieSettings.ttlDays * 24 * 60 * 60 * 1000,
      } as const;

      response.cookie(SESSION_COOKIE_NAME, credentials.sessionId, {
        ...cookieAttributes,
        httpOnly: true,
      });
      response.setHeader(CSRF_HEADER_NAME, credentials.csrfToken);

      response.status(200).json({
        success: true,
        message: "Signed in successfully.",
        user: {
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      const databaseErrorCode = getDatabaseErrorCode(error);
      console.error("Login dependency failure.", {
        operation,
        ...(databaseErrorCode ? { databaseErrorCode } : {}),
      });

      if (databaseErrorCode === "42P01") {
        response.status(503).json({
          success: false,
          message: "Authentication database tables are not initialized. Apply the database migrations with `npm run db:up`.",
        });
        return;
      }

      response.status(503).json({
        success: false,
        message: "Unable to sign in right now. Please try again.",
      });
    }
  };
}

export function createLogoutHandler(
  sessions: SessionService = sessionService,
  cookieSettings: Pick<SessionCookieSettings, "secure" | "sameSite"> = {
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: env.SESSION_COOKIE_SAME_SITE,
  },
): RequestHandler {
  return async (_request, response): Promise<void> => {
    const session = response.locals.authenticatedSession as
      | { sessionId: string }
      | undefined;
    if (!session) {
      response.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    try {
      await sessions.revoke(session.sessionId);
      const cookieAttributes = {
        secure: cookieSettings.secure,
        sameSite: cookieSettings.sameSite,
        path: "/api/v1/auth",
      } as const;
      response.clearCookie(SESSION_COOKIE_NAME, {
        ...cookieAttributes,
        httpOnly: true,
      });
      response.status(200).json({ success: true, message: "Signed out successfully." });
    } catch {
      console.error("Logout failed because the session service is unavailable.");
      response.status(503).json({
        success: false,
        message: "Unable to sign out right now. Please try again.",
      });
    }
  };
}

export const loginUser = createLoginHandler();
export const logoutUser = createLogoutHandler();
