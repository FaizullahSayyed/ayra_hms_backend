import { Router } from "express";
import type { RequestHandler } from "express";
import { createAdminUser } from "../controllers/admin-user.controller.js";
import { requireRole } from "../middlewares/authorization.middleware.js";
import {
  requireAuthenticatedUser,
  requireCsrfToken,
  requireTrustedOrigin,
  type AuthenticationDatabase,
} from "../middlewares/session.middleware.js";
import { env } from "../config/env.js";

export interface AdminRouterDependencies {
  createUserHandler?: RequestHandler;
  authenticationDatabase?: AuthenticationDatabase;
  allowedOrigins?: readonly string[];
}

export function createAdminRouter(dependencies: AdminRouterDependencies = {}) {
  const router = Router();
  const trustedOrigin = requireTrustedOrigin(dependencies.allowedOrigins ?? env.CLIENT_URL);
  const authenticatedUser = requireAuthenticatedUser(dependencies.authenticationDatabase);

  router.post(
    "/users",
    trustedOrigin,
    authenticatedUser,
    requireCsrfToken(),
    requireRole("admin"),
    dependencies.createUserHandler ?? createAdminUser,
  );
  return router;
}

export default createAdminRouter();
