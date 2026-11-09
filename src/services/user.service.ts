import type { QueryResultRow } from "pg";
import { pool } from "../config/database.js";
import type { UserRole } from "../types/auth.js";
import { hashPassword } from "../utils/password.js";
import type { AdminCreateUserInput } from "../validators/auth.validator.js";

export interface CreatedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface UserCreationDatabase {
  query<T extends QueryResultRow>(
    sql: string,
    values: (string | null)[],
  ): Promise<{ rows: T[] }>;
}

const userDatabase: UserCreationDatabase = {
  query: <T extends QueryResultRow>(sql: string, values: (string | null)[]) =>
    pool.query<T>(sql, values),
};

export async function createUserRecord(
  input: AdminCreateUserInput,
  actorUserId: string,
  database: UserCreationDatabase = userDatabase,
  passwordHasher: typeof hashPassword = hashPassword,
): Promise<CreatedUser> {
  const passwordHash = await passwordHasher(input.password);
  const name = `${input.firstName} ${input.lastName}`;
  const result = await database.query<CreatedUser>(
    `WITH created_user AS (
       INSERT INTO users (
         username, name, first_name, last_name, email, password_hash, role, phone, gender
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, email, role
     ), audit_event AS (
       INSERT INTO admin_audit_events (
         actor_user_id, target_user_id, event_type, changed_fields, password_changed
       )
       SELECT $10, id, 'staff_created', $11::jsonb, TRUE
       FROM created_user
     )
     SELECT id, name, email, role FROM created_user`,
    [
      input.username,
      name,
      input.firstName,
      input.lastName,
      input.email,
      passwordHash,
      input.role,
      input.phone ?? null,
      input.gender,
      actorUserId,
      JSON.stringify(["username", "firstName", "lastName", "email", "role", "phone", "gender", "password"]),
    ],
  );
  const user = result.rows[0];
  if (!user) throw new Error("User insert returned no row.");
  return user;
}

export function getPostgresErrorCode(error: unknown): string | undefined {
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
