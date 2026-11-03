import { Router } from "express";
import type { RequestHandler } from "express";
import { registerPatient } from "../controllers/auth.controller.js";
import { loginUser, logoutUser } from "../controllers/login.controller.js";
import { getCurrentUser } from "../controllers/current-user.controller.js";
import {
  requireAuthenticatedUser,
  requireCsrfToken,
  requireTrustedOrigin,
  type AuthenticationDatabase,
} from "../middlewares/session.middleware.js";
import { env } from "../config/env.js";

export interface AuthRouterDependencies {
  registerHandler?: RequestHandler;
  loginHandler?: RequestHandler;
  currentUserHandler?: RequestHandler;
  logoutHandler?: RequestHandler;
  authenticationDatabase?: AuthenticationDatabase;
  allowedOrigins?: readonly string[];
}

export function createAuthRouter(dependencies: AuthRouterDependencies = {}) {
  const router = Router();
  const trustedOrigin = requireTrustedOrigin(dependencies.allowedOrigins ?? env.CLIENT_URL);
  const authenticatedUser = requireAuthenticatedUser(dependencies.authenticationDatabase);

  router.post("/register", dependencies.registerHandler ?? registerPatient);
  router.post("/login", trustedOrigin, dependencies.loginHandler ?? loginUser);
  router.get(
    "/me",
    trustedOrigin,
    authenticatedUser,
    dependencies.currentUserHandler ?? getCurrentUser,
  );
  router.post(
    "/logout",
    trustedOrigin,
    authenticatedUser,
    requireCsrfToken(),
    dependencies.logoutHandler ?? logoutUser,
  );
  return router;
}

export default createAuthRouter();