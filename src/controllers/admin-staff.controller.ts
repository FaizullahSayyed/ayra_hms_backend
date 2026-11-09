import type { RequestHandler } from "express";
import { z } from "zod";
import {
  FinalAdministratorError,
  listStaffUsers,
  StaffAccountNotFoundError,
  staffDatabase,
  updateStaffUser,
  type AdminStaffDatabase,
  type StaffDatabaseQuery,
} from "../services/admin-staff.service.js";
import { getPostgresErrorCode } from "../services/user.service.js";
import { hashPassword } from "../utils/password.js";
import {
  adminUpdateUserSchema,
} from "../validators/auth.validator.js";

export function createAdminStaffListHandler(
  database?: StaffDatabaseQuery,
): RequestHandler {
  return async (_request, response): Promise<void> => {
    try {
      const users = await listStaffUsers(database);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ success: true, users });
    } catch (error) {
      console.error("Admin staff list failed.", {
        ...(getPostgresErrorCode(error)
          ? { databaseErrorCode: getPostgresErrorCode(error) }
          : {}),
      });
      response.status(503).json({
        success: false,
        message: "Unable to load staff accounts right now.",
      });
    }
  };
}

export function createAdminStaffUpdateHandler(
  database: AdminStaffDatabase = staffDatabase,
  passwordHasher: typeof hashPassword = hashPassword,
): RequestHandler {
  return async (request, response): Promise<void> => {
    const idValidation = z.uuid().safeParse(request.params.id);
    if (!idValidation.success) {
      response.status(400).json({
        success: false,
        message: "Validation failed",
        errors: { id: ["Staff account ID must be a UUID."] },
      });
      return;
    }

    const validation = adminUpdateUserSchema.safeParse(request.body);
    if (!validation.success) {
      response.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const actor = response.locals.authenticatedUser as { id: string } | undefined;
    if (!actor) {
      response.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    try {
      await updateStaffUser(idValidation.data, actor.id, validation.data, database, passwordHasher);
      response.status(200).json({
        success: true,
        message: "Staff account updated.",
      });
    } catch (error) {
      if (error instanceof StaffAccountNotFoundError) {
        response.status(404).json({ success: false, message: error.message });
        return;
      }
      if (error instanceof FinalAdministratorError) {
        response.status(409).json({ success: false, message: error.message });
        return;
      }

      const databaseErrorCode = getPostgresErrorCode(error);
      if (databaseErrorCode === "23505") {
        response.status(409).json({
          success: false,
          message: "Username or email is already in use.",
        });
        return;
      }
      if (databaseErrorCode === "42703" || databaseErrorCode === "42P01") {
        console.error("Admin staff update failed because the database schema is outdated.", {
          databaseErrorCode,
        });
        response.status(503).json({
          success: false,
          message: "Staff management database migrations are pending. Apply them with `npm run db:up`.",
        });
        return;
      }

      console.error("Admin staff update failed.", {
        ...(databaseErrorCode ? { databaseErrorCode } : {}),
      });
      response.status(500).json({
        success: false,
        message: "Unable to update staff account.",
      });
    }
  };
}

export const getAdminStaff = createAdminStaffListHandler();
export const updateAdminStaff = createAdminStaffUpdateHandler();
