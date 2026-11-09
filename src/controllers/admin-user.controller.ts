import type { RequestHandler } from "express";
import type { AuthenticatedUser } from "../types/auth.js";
import { createUserRecord, getPostgresErrorCode, type UserCreationDatabase } from "../services/user.service.js";
import { adminCreateUserSchema } from "../validators/auth.validator.js";

export function createAdminUserHandler(
  database?: UserCreationDatabase,
  passwordHasher?: Parameters<typeof createUserRecord>[3],
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
      const actor = response.locals.authenticatedUser as AuthenticatedUser | undefined;
      if (!actor) {
        response.status(401).json({ success: false, message: "Authentication required." });
        return;
      }
      const user = await createUserRecord(validation.data, actor.id, database, passwordHasher);
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

      if (databaseErrorCode === "42703") {
        console.error("Admin user creation failed because the database schema is outdated.", {
          databaseErrorCode,
        });
        response.status(503).json({
          success: false,
          message: "The user database schema is outdated. Apply pending migrations with `npm run db:up`.",
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
