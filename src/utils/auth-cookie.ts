import type { CookieOptions } from "express";

export const AUTH_COOKIE_NAME = "ayra_token";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const AUTH_COOKIE_PATH = "/api/v1";
export const AUTH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthCookieSettings {
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
}

export function getAuthCookieOptions(
  settings: AuthCookieSettings,
  clear = false,
): CookieOptions {
  return {
    httpOnly: true,
    secure: settings.secure,
    sameSite: settings.sameSite,
    path: AUTH_COOKIE_PATH,
    ...(clear ? {} : { maxAge: AUTH_COOKIE_MAX_AGE_MS }),
  };
}

export function readAuthCookie(
  cookieHeader: string | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;

  const matchingEntries = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${AUTH_COOKIE_NAME}=`));

  if (matchingEntries.length !== 1) return undefined;

  const encodedValue = matchingEntries[0].slice(AUTH_COOKIE_NAME.length + 1);
  if (!encodedValue) return undefined;

  try {
    return decodeURIComponent(encodedValue);
  } catch {
    return undefined;
  }
}
