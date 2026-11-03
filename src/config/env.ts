import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),

  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  CLIENT_URL: z
    .string()
    .transform((value) => value.split(",").map((url) => url.trim()))
    .pipe(z.array(z.string().url()).min(1, "At least one client URL is required"))
    .transform((urls) => urls.map((url) => new URL(url).origin)),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),

  SESSION_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).optional(),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  console.error(result.error.flatten().fieldErrors);
  process.exit(1);
}

const sessionCookieSameSite = result.data.SESSION_COOKIE_SAME_SITE
  ?? (result.data.NODE_ENV === "production" ? "none" : "lax");

if (sessionCookieSameSite === "none" && result.data.NODE_ENV !== "production") {
  console.error("Invalid environment variables:");
  console.error({ SESSION_COOKIE_SAME_SITE: ["SameSite=None requires NODE_ENV=production."] });
  process.exit(1);
}

export const env = {
  ...result.data,
  SESSION_COOKIE_SAME_SITE: sessionCookieSameSite,
  SESSION_COOKIE_SECURE: result.data.NODE_ENV === "production" || sessionCookieSameSite === "none",
};