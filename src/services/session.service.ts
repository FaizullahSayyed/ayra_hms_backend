import { createHash, randomBytes } from "node:crypto";
import type { QueryResultRow } from "pg";
import { pool } from "../config/database.js";
import type { UserRole } from "../types/auth.js";

export interface AuthenticatedSession {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  sessionId: string;
}

export interface SessionCredentials {
  sessionId: string;
  csrfToken: string;
}

interface SessionQueryResult<T> {
  rows: T[];
}

export interface SessionDatabase {
  query<T extends QueryResultRow>(
    sql: string,
    values?: (string | number)[],
  ): Promise<SessionQueryResult<T>>;
}

export interface SessionService {
  create(userId: string): Promise<SessionCredentials>;
  authenticate(sessionId: string): Promise<AuthenticatedSession | null>;
  refreshCsrf(sessionId: string): Promise<string | null>;
  validateCsrf(sessionId: string, csrfToken: string): Promise<boolean>;
  revoke(sessionId: string): Promise<void>;
}

const sessionDatabase: SessionDatabase = {
  query: <T extends QueryResultRow>(sql: string, values?: (string | number)[]) =>
    pool.query<T>(sql, values),
};

export function hashOpaqueValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class PostgresSessionService implements SessionService {
  constructor(
    private readonly database: SessionDatabase = sessionDatabase,
    private readonly ttlDays = 30,
  ) {}

  async create(userId: string): Promise<SessionCredentials> {
    const sessionId = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");

    await this.database.query(
      `INSERT INTO user_sessions (session_hash, csrf_token_hash, user_id, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 day'))`,
      [hashOpaqueValue(sessionId), hashOpaqueValue(csrfToken), userId, this.ttlDays],
    );

    return { sessionId, csrfToken };
  }

  async authenticate(sessionId: string): Promise<AuthenticatedSession | null> {
    const result = await this.database.query<Omit<AuthenticatedSession, "sessionId">>(
      `SELECT users.id, users.name, users.email, users.role
       FROM user_sessions
       JOIN users ON users.id = user_sessions.user_id
       WHERE user_sessions.session_hash = $1
         AND user_sessions.revoked_at IS NULL
         AND user_sessions.expires_at > NOW()
         AND users.is_active = TRUE`,
      [hashOpaqueValue(sessionId)],
    );
    const user = result.rows[0];
    return user ? { ...user, sessionId } : null;
  }

  async refreshCsrf(sessionId: string): Promise<string | null> {
    const csrfToken = randomBytes(32).toString("base64url");
    const result = await this.database.query<{ session_hash: string }>(
      `UPDATE user_sessions
       SET csrf_token_hash = $2
       WHERE session_hash = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()
       RETURNING session_hash`,
      [hashOpaqueValue(sessionId), hashOpaqueValue(csrfToken)],
    );
    return result.rows.length === 1 ? csrfToken : null;
  }

  async validateCsrf(sessionId: string, csrfToken: string): Promise<boolean> {
    const result = await this.database.query<{ valid: boolean }>(
      `SELECT TRUE AS valid
       FROM user_sessions
       WHERE session_hash = $1
         AND csrf_token_hash = $2
         AND revoked_at IS NULL
         AND expires_at > NOW()`,
      [hashOpaqueValue(sessionId), hashOpaqueValue(csrfToken)],
    );
    return result.rows.length === 1;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.database.query(
      `UPDATE user_sessions
       SET revoked_at = NOW()
       WHERE session_hash = $1
         AND revoked_at IS NULL`,
      [hashOpaqueValue(sessionId)],
    );
  }
}

export const sessionService = new PostgresSessionService(sessionDatabase);
