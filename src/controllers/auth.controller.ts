import type { RequestHandler } from "express";
import { registerSchema } from "../validators/auth.validator.js";
import { createUserRecord, getPostgresErrorCode, type UserCreationDatabase } from "../services/user.service.js";

export function createRegisterHandler(
  database?: UserCreationDatabase,
  passwordHasher?: Parameters<typeof createUserRecord>[2],
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

      const { role } = validation.data;
      if (role !== "patient") {
        res.status(403).json({
          success: false,
          code: "STAFF_REGISTRATION_UNAVAILABLE",
          message: "Staff accounts cannot self-register. An authorized administrator must provision staff accounts.",
        });
        return;
      }

      const user = await createUserRecord(validation.data, database, passwordHasher);

      res.status(201).json({
        success: true,
        message: "Registration successful.",
        user,
      });
    } catch (error) {
      const databaseErrorCode = getPostgresErrorCode(error);
      if (databaseErrorCode === "23505") {
        res.status(409).json({
          success: false,
          message: "Username or email is already in use.",
        });
        return;
      }

      console.error("Public user registration failed.", {
        ...(databaseErrorCode ? { databaseErrorCode } : {}),
      });
      res.status(500).json({
        success: false,
        message: "Unable to register account.",
      });
    }
  };
}

export const registerPatient = createRegisterHandler();