import type { RequestHandler } from "express";
import { createUserRecord, getPostgresErrorCode, type UserCreationDatabase } from "../services/user.service.js";
import { adminCreateUserSchema } from "../validators/auth.validator.js";

export function createAdminUserHandler(
  database?: UserCreationDatabase,
  passwordHasher?: Parameters<typeof createUserRecord>[2],
): RequestHandler {
  return async (request, response): Promise<void> => {
    const validation = adminCreateUserSchema.safeParse(request.body);
    if (!validation.success) {
      response.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const user = await createUserRecord(validation.data, database, passwordHasher);
      response.status(201).json({
        success: true,
        message: "User created.",
        user,
      });
    } catch (error) {
      const databaseErrorCode = getPostgresErrorCode(error);
      if (databaseErrorCode === "23505") {
        response.status(409).json({
          success: false,
          message: "Username or email is already in use.",
        });
        return;
      }

      console.error("Admin user creation failed.", {
        ...(databaseErrorCode ? { databaseErrorCode } : {}),
      });
      response.status(500).json({
        success: false,
        message: "Unable to create user.",
      });
    }
  };
}

export const createAdminUser = createAdminUserHandler();
