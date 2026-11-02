import type { RequestHandler } from "express";
import { pool } from "../config/database.js";
import { hashPassword } from "../utils/password.js";
import { registerSchema } from "../validators/auth.validator.js";
import type { UserRole } from "../types/auth.js";

interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string | Date;
}

type RegistrationValues = [name: string, email: string, passwordHash: string, role: UserRole];

export interface RegistrationDatabase {
  query: (
    sql: string,
    values: RegistrationValues,
  ) => Promise<{ rows: RegisteredUser[] }>;
}

const registrationDatabase: RegistrationDatabase = {
  query: (sql, values) => pool.query<RegisteredUser>(sql, values),
};

function hasDatabaseErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}

export function createRegisterHandler(
  database: RegistrationDatabase = registrationDatabase,
  passwordHasher: typeof hashPassword = hashPassword,
): RequestHandler {
  return async (req, res): Promise<void> => {
    try {
      const validation = registerSchema.safeParse(req.body);

      if (!validation.success) {
        res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: validation.error.flatten().fieldErrors,
        });
        return;
      }

      const { name, email, password, role } = validation.data;
      if (role !== "patient") {
        res.status(403).json({
          success: false,
          code: "STAFF_REGISTRATION_UNAVAILABLE",
          message: "Staff accounts cannot self-register. An authorized administrator must provision staff accounts.",
        });
        return;
      }

      const passwordHash = await passwordHasher(password);
      const result = await database.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, role, created_at`,
        [name, email, passwordHash, "patient"],
      );
      const user = result.rows[0];
      if (!user) {
        throw new Error("User insert returned no row.");
      }

      res.status(201).json({
        success: true,
        message: "Patient registered successfully",
        user,
      });
    } catch (error) {
      if (hasDatabaseErrorCode(error, "23505")) {
        res.status(409).json({
          success: false,
          message: "Email is already registered",
        });
        return;
      }

      console.error("Patient registration failed:", error);
      res.status(500).json({
        success: false,
        message: "Unable to register patient",
      });
    }
  };
}

export const registerPatient = createRegisterHandler();