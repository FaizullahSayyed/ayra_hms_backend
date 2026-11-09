import { z } from "zod";
import { USER_ROLES } from "../types/auth.js";

const optionalPhoneSchema = z
  .string()
  .trim()
  .max(32, "Phone number cannot exceed 32 characters")
  .regex(/^[+0-9().\-\s]*$/, "Phone number contains invalid characters")
  .optional()
  .transform((value) => value || undefined);

const accountFields = {
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
  phone: optionalPhoneSchema,
  gender: z.enum(["female", "male", "non-binary", "prefer-not-to-say"]),
  role: z.enum(USER_ROLES),
};

export const adminCreateUserSchema = z.object({
  ...accountFields,
  password: z
    .string()
    .min(12, "Password must contain at least 12 characters")
    .max(72, "Password is too long"),
}).strict().refine(
  ({ firstName, lastName }) => `${firstName} ${lastName}`.length <= 150,
  { message: "Combined name cannot exceed 150 characters", path: ["lastName"] },
);

export const adminUpdateUserSchema = z.object({
  ...accountFields,
  phone: z
    .string()
    .trim()
    .max(32, "Phone number cannot exceed 32 characters")
    .regex(/^[+0-9().\-\s]*$/, "Phone number contains invalid characters")
    .optional(),
  gender: z.enum(["female", "male", "non-binary", "prefer-not-to-say", ""]).optional(),
  password: z
    .string()
    .min(12, "Password must contain at least 12 characters")
    .max(72, "Password is too long")
    .optional(),
}).strict().refine(
  ({ firstName, lastName }) => `${firstName} ${lastName}`.length <= 150,
  { message: "Combined name cannot exceed 150 characters", path: ["lastName"] },
);

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

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