import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { pool } from "../config/database.js";
import { AUTH_COOKIE_NAME, CSRF_HEADER_NAME } from "../middlewares/session.middleware.js";
import { USER_ROLES, type UserRole } from "../types/auth.js";
import { comparePassword, hashPassword } from "../utils/password.js";
import { generateAccessToken, getAccessTokenExpiration } from "../utils/jwt.js";
import { loginSchema } from "../validators/auth.validator.js";
import { sessionService } from "../services/session.service.js";

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
}

interface LoginHandlerDependencies {
  database: LoginDatabase;
  verifyPassword: typeof comparePassword;
  dummyPasswordHash: Promise<string>;
  generateToken: typeof generateAccessToken;
  recordSession: (userId: string, token: string, csrfToken: string, expiresAt: Date) => Promise<void>;
  cookieSettings: SessionCookieSettings;
}

const AUTH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const loginDatabase: LoginDatabase = {
  query: (sql, values) => pool.query<LoginUser>(sql, values),
};

const dummyPasswordHash = hashPassword(randomBytes(32).toString("base64url"));

const defaultDependencies: LoginHandlerDependencies = {
  database: loginDatabase,
  verifyPassword: comparePassword,
  dummyPasswordHash,
  generateToken: generateAccessToken,
  recordSession: (userId, token, csrfToken, expiresAt) =>
    sessionService.recordAccessToken(userId, token, csrfToken, expiresAt),
  cookieSettings: {
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: env.SESSION_COOKIE_SAME_SITE,
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

    let operation = "user lookup";
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

      operation = "token creation";
      const csrfToken = randomBytes(32).toString("base64url");
      const token = dependencies.generateToken({
        userId: user.id,
        role: user.role,
        csrfToken,
      });
      operation = "session creation";
      await dependencies.recordSession(user.id, token, csrfToken, getAccessTokenExpiration(token));
      const cookieAttributes = {
        secure: dependencies.cookieSettings.secure,
        sameSite: dependencies.cookieSettings.sameSite,
        path: "/api/v1",
        maxAge: AUTH_TOKEN_TTL_MS,
      } as const;

      response.cookie(AUTH_COOKIE_NAME, token, {
        ...cookieAttributes,
        httpOnly: true,
      });
      response.setHeader(CSRF_HEADER_NAME, csrfToken);

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
  cookieSettings: Pick<SessionCookieSettings, "secure" | "sameSite"> = {
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: env.SESSION_COOKIE_SAME_SITE,
  },
  revokeSession: (sessionHash: string) => Promise<void> =
    (sessionHash) => sessionService.revokeHash(sessionHash),
): RequestHandler {
  return async (_request, response): Promise<void> => {
    const user = response.locals.authenticatedUser;
    if (!user) {
      response.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    try {
      await revokeSession(user.sessionHash);
    } catch (error) {
      console.error("Logout session revocation failed.", error);
      response.status(503).json({
        success: false,
        message: "Unable to sign out right now. Please try again.",
      });
      return;
    }

    const cookieAttributes = {
      secure: cookieSettings.secure,
      sameSite: cookieSettings.sameSite,
      path: "/api/v1",
    } as const;
    response.clearCookie(AUTH_COOKIE_NAME, {
      ...cookieAttributes,
      httpOnly: true,
    });
    response.status(200).json({ success: true, message: "Signed out successfully." });
  };
}

export const loginUser = createLoginHandler();
export const logoutUser = createLogoutHandler();
