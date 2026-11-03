import { z } from "zod";
import { USER_ROLES } from "../types/auth.js";

const optionalPhoneSchema = z
  .string()
  .trim()
  .max(32, "Phone number cannot exceed 32 characters")
  .regex(/^[+0-9().\-\s]*$/, "Phone number contains invalid characters")
  .optional()
  .transform((value) => value || undefined);

export const userAccountSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must contain at least 3 characters")
    .max(254, "Username cannot exceed 254 characters")
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._@+-]*$/, "Username contains invalid characters")
    .transform((value) => value.toLowerCase()),
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .max(254, "Email cannot exceed 254 characters")
    .transform((value) => value.toLowerCase()),
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required")
    .max(80, "First name cannot exceed 80 characters")
    .transform((value) => value.replace(/\s+/g, " ")),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .max(80, "Last name cannot exceed 80 characters")
    .transform((value) => value.replace(/\s+/g, " ")),
  password: z
    .string()
    .min(8, "Password must contain at least 8 characters")
    .max(72, "Password is too long"),
  phone: optionalPhoneSchema,
  gender: z.enum(["female", "male", "non-binary", "prefer-not-to-say"]),
  role: z.enum(USER_ROLES).default("patient"),
}).strict();

export const registerSchema = userAccountSchema;
export const adminCreateUserSchema = userAccountSchema;

export type RegisterInput = z.infer<typeof registerSchema>;
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .max(255)
    .transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(1, "Password is required")
    .max(72, "Password is too long"),
}).strict();

export type LoginInput = z.infer<typeof loginSchema>;