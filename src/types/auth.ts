export const USER_ROLES = [
  "patient",
  "biller",
  "receptionist",
  "nurse",
  "doctor",
  "admin",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  csrfToken: string;
}