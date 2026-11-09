import type { QueryResultRow } from "pg";
import { pool } from "../config/database.js";
import type { UserRole } from "../types/auth.js";
import { hashPassword } from "../utils/password.js";
import type { AdminUpdateUserInput } from "../validators/auth.validator.js";

type StaffQueryValue = string | number | boolean | null;

export interface StaffDatabaseQuery {
  query<T extends QueryResultRow>(
    sql: string,
    values?: StaffQueryValue[],
  ): Promise<{ rows: T[] }>;
}

export interface AdminStaffDatabase extends StaffDatabaseQuery {
  transaction<T>(operation: (database: StaffDatabaseQuery) => Promise<T>): Promise<T>;
}

export interface StaffRecord extends QueryResultRow {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  role: UserRole;
  phone: string | null;
  gender: string | null;
}

const staffDatabase: AdminStaffDatabase = {
  query: (sql, values) => pool.query(sql, values),
  transaction: async <T>(operation: (database: StaffDatabaseQuery) => Promise<T>) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation({
        query: (sql, values) => client.query(sql, values),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};

export class StaffAccountNotFoundError extends Error {}
export class FinalAdministratorError extends Error {}

export interface ListedStaffUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  phone: string;
  gender: string;
  createdAt: string;
  isSignedIn: boolean;
}

export async function listStaffUsers(
  database: StaffDatabaseQuery = staffDatabase,
): Promise<ListedStaffUser[]> {
  const result = await database.query<StaffRecord & {
    created_at: Date | string;
    is_signed_in: boolean;
  }>(
    `SELECT users.id, users.username, users.first_name, users.last_name,
            users.email, users.role, users.phone, users.gender, users.created_at,
            EXISTS (
              SELECT 1
              FROM user_sessions
              WHERE user_sessions.user_id = users.id
                AND users.is_active = TRUE
                AND user_sessions.revoked_at IS NULL
                AND user_sessions.expires_at > NOW()
            ) AS is_signed_in
     FROM users
     WHERE users.role IN ('admin', 'doctor', 'nurse', 'biller', 'receptionist')
     ORDER BY users.created_at DESC`,
  );

  return result.rows.map((user) => ({
    id: user.id,
    username: user.username ?? "",
    firstName: user.first_name ?? "",
    lastName: user.last_name ?? "",
    email: user.email,
    role: user.role,
    phone: user.phone ?? "",
    gender: user.gender ?? "prefer-not-to-say",
    createdAt: user.created_at instanceof Date
      ? user.created_at.toISOString()
      : new Date(user.created_at).toISOString(),
    isSignedIn: user.is_signed_in,
  }));
}

export async function updateStaffUser(
  id: string,
  actorId: string,
  input: AdminUpdateUserInput,
  database: AdminStaffDatabase = staffDatabase,
  passwordHasher: typeof hashPassword = hashPassword,
): Promise<void> {
  const passwordHash = input.password ? await passwordHasher(input.password) : null;
  const phoneWasProvided = input.phone !== undefined;
  const genderWasProvided = input.gender !== undefined;
  const phone = phoneWasProvided ? input.phone || null : null;
  const gender = genderWasProvided ? input.gender || null : null;

  await database.transaction(async (transaction) => {
    if (input.role !== "admin") {
      await transaction.query(
        "SELECT pg_advisory_xact_lock(684321907)",
      );
    }

    const currentResult = await transaction.query<StaffRecord>(
      `SELECT id, username, first_name, last_name, email, role, phone, gender
       FROM users
       WHERE id = $1
         AND role IN ('admin', 'doctor', 'nurse', 'biller', 'receptionist')
       FOR UPDATE`,
      [id],
    );
    const current = currentResult.rows[0];
    if (!current) throw new StaffAccountNotFoundError("Staff account not found.");

    if (current.role === "admin" && input.role !== "admin") {
      const adminCountResult = await transaction.query<{ admin_count: string | number }>(
        "SELECT COUNT(*) AS admin_count FROM users WHERE role = 'admin'",
      );
      if (Number(adminCountResult.rows[0]?.admin_count ?? 0) <= 1) {
        throw new FinalAdministratorError("The final administrator cannot be demoted.");
      }
    }

    const changedFields: string[] = [];
    if (current.username !== input.username) changedFields.push("username");
    if (current.first_name !== input.firstName) changedFields.push("firstName");
    if (current.last_name !== input.lastName) changedFields.push("lastName");
    if (current.email !== input.email) changedFields.push("email");
    if (current.role !== input.role) changedFields.push("role");
    if (phoneWasProvided && current.phone !== phone) changedFields.push("phone");
    if (genderWasProvided && current.gender !== gender) changedFields.push("gender");
    const passwordChanged = passwordHash !== null;

    const updateResult = await transaction.query<{ id: string }>(
      `UPDATE users
       SET username = $1,
           first_name = $2,
           last_name = $3,
           name = $4,
           email = $5,
           role = $6,
           phone = CASE WHEN $7 THEN $8 ELSE phone END,
           gender = CASE WHEN $9 THEN $10 ELSE gender END,
           password_hash = COALESCE($11, password_hash),
           updated_at = NOW()
       WHERE id = $12
         AND role IN ('admin', 'doctor', 'nurse', 'biller', 'receptionist')
       RETURNING id`,
      [
        input.username,
        input.firstName,
        input.lastName,
        `${input.firstName} ${input.lastName}`,
        input.email,
        input.role,
        phoneWasProvided,
        phone,
        genderWasProvided,
        gender,
        passwordHash,
        id,
      ],
    );
    if (updateResult.rows.length === 0) {
      throw new StaffAccountNotFoundError("Staff account not found.");
    }

    if (passwordChanged || current.role !== input.role) {
      await transaction.query(
        `UPDATE user_sessions
         SET revoked_at = NOW()
         WHERE user_id = $1
           AND revoked_at IS NULL`,
        [id],
      );
    }

    if (changedFields.length > 0 || passwordChanged) {
      if (passwordChanged) changedFields.push("password");
      await transaction.query(
        `INSERT INTO admin_audit_events (
           actor_user_id, target_user_id, event_type, changed_fields, password_changed
         )
         VALUES ($1, $2, 'staff_updated', $3::jsonb, $4)`,
        [actorId, id, JSON.stringify(changedFields), passwordChanged],
      );
    }
  });
}

export { staffDatabase };
