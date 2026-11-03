import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { USER_ROLES, type UserRole } from "../types/auth.js";

export interface AccessTokenPayload {
  userId: string;
  role: UserRole;
  csrfToken: string;
}

export const generateAccessToken = (
  payload: AccessTokenPayload
): string => {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "30d",
  });
};

export const verifyAccessToken = (
  token: string
): AccessTokenPayload => {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"],
  });

  if (
    typeof decoded === "string" ||
    typeof decoded.userId !== "string" ||
    !USER_ROLES.includes(decoded.role as UserRole) ||
    typeof decoded.csrfToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(decoded.csrfToken)
  ) {
    throw new Error("Invalid access token payload");
  }

  return {
    userId: decoded.userId,
    role: decoded.role as UserRole,
    csrfToken: decoded.csrfToken,
  };
};