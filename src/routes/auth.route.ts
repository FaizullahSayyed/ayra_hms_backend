import { Router } from "express";
import type { RequestHandler } from "express";
import { registerPatient } from "../controllers/auth.controller.js";
import { loginUser, logoutUser } from "../controllers/login.controller.js";
import { getCurrentUser } from "../controllers/current-user.controller.js";
import {
  requireAuthenticatedSession,
  requireCsrfToken,
  requireTrustedOrigin,
} from "../middlewares/session.middleware.js";
import { env } from "../config/env.js";
import {
  sessionService,
  type SessionService,
} from "../services/session.service.js";

export interface AuthRouterDependencies {
  registerHandler?: RequestHandler;
  loginHandler?: RequestHandler;
  currentUserHandler?: RequestHandler;
  logoutHandler?: RequestHandler;
  sessions?: SessionService;
  allowedOrigins?: readonly string[];
}

export function createAuthRouter(dependencies: AuthRouterDependencies = {}) {
  const router = Router();
  const sessions = dependencies.sessions ?? sessionService;
  const trustedOrigin = requireTrustedOrigin(dependencies.allowedOrigins ?? env.CLIENT_URL);

  router.post("/register", dependencies.registerHandler ?? registerPatient);
  router.post("/login", trustedOrigin, dependencies.loginHandler ?? loginUser);
  router.get(
    "/me",
    trustedOrigin,
    requireAuthenticatedSession(sessions),
    dependencies.currentUserHandler ?? getCurrentUser,
  );
  router.post(
    "/logout",
    trustedOrigin,
    requireAuthenticatedSession(sessions),
    requireCsrfToken(sessions),
    dependencies.logoutHandler ?? logoutUser,
  );
  return router;
}

export default createAuthRouter();