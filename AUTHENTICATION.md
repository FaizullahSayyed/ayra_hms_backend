# Authentication API

## Login

`POST /api/v1/auth/login` accepts a JSON body containing an email and password. Email addresses are trimmed and lowercased; passwords are not trimmed. On success it returns only the user's name, email, and database-stored role. Invalid credentials and disabled accounts use the same `401` response.

The server signs a JWT with HS256 using `JWT_SECRET`. It expires after 30 days and is stored in the HttpOnly, host-only `ayra_token` cookie (Secure in production). The JWT is not returned in the response body. The cookie is sent to `/api/v1` endpoints and is automatically included in browser requests that use `credentials: "include"`.

## Cookies and CSRF

Send browser requests with credentials enabled (for example, `fetch(..., { credentials: "include" })`). Login returns a random CSRF token in the `X-CSRF-Token` response header; the signed JWT binds that token to the authenticated session. The database stores only hashes of the JWT and CSRF token, along with the session's expiration and revocation state. `GET /api/v1/auth/me` verifies the JWT cookie and its active database session, checks that the user is still active in PostgreSQL, and returns only the user's name, email, and current database-stored role. It also returns the CSRF token in the exposed response header so the frontend can restore role-aware UI state after a page refresh. Keep the CSRF token in application memory; it is never placed in the response body.

For authenticated state-changing requests, send the JWT cookie automatically with `credentials: "include"` and send the CSRF value in the `X-CSRF-Token` request header. The server verifies that it matches the signed JWT claim. Do not send the JWT from JavaScript or store it outside the HttpOnly cookie.

`POST /api/v1/auth/logout` requires an allowed `Origin`, a valid JWT cookie, and the matching CSRF header. It revokes the active database session and clears the cookie, so copied tokens are rejected as well. The cookie path is `/api/v1` so it is sent to both authentication and authorized admin endpoints. The same origin allowlist is used by credentialed CORS; `CLIENT_URL` must be a comma-separated list of exact frontend origins, including `http://localhost:5173` and `https://ayra-hms-frontend.vercel.app` as appropriate.

`SESSION_COOKIE_SAME_SITE` defaults to `lax` in development and `none` in production to support separately deployed frontend and backend sites. `SameSite=none` is accepted only with `NODE_ENV=production`, where Secure cookies are enabled.

## Setup

Set `DATABASE_URL`, `DATABASE_CA_CERT`, `CLIENT_URL`, `JWT_SECRET`, and `NODE_ENV` using deployment secrets/environment settings. `JWT_SECRET` must contain at least 32 characters and must be kept private. Do not commit `.env` or private CA files.

Apply the pending database migrations with:

```powershell
npm run db:up
```

`npm run db:up` applies the pending account, patient, and staff-audit migrations. The patient migration creates a separate `patients` table containing patient profile data (`first_name`, `last_name`, optional `phone` and `gender`, and timestamps), copies legacy `role = 'patient'` profiles into it, and removes those patient login accounts and sessions from `users`. Existing patient names are split into first and last name during migration; a last name remains nullable for legacy records that contain only one name. Patient records do not contain usernames, email addresses, passwords, or roles. The `users` role constraint is restricted to `admin`, `doctor`, `nurse`, `biller`, and `receptionist`. Staff sign-in status and authorization use rows in `user_sessions`; login creates a hashed session record with the JWT's exact expiration, logout revokes it, and account updates revoke sessions after password or role changes. `admin_audit_events` records staff creation and updates, changed field names, and whether a password was replaced; it never stores password values or hashes. Rolling back the initial patient migration is blocked while patient records exist to prevent data loss or recreating patient login accounts.

After deploying session-backed authentication, users whose JWTs were issued before session records were created must sign in again.

## Account creation

`POST /api/v1/auth/register` is not available while patient registration is deferred. It returns `501 PATIENT_REGISTRATION_DEFERRED` and does not create an account.

`POST /api/v1/admin/users` accepts `username`, `email`, `firstName`, `lastName`, `password`, optional `phone`, `gender`, and a required staff `role` (`admin`, `doctor`, `nurse`, `biller`, or `receptionist`). It requires an active admin JWT, an allowed `Origin`, and the matching `X-CSRF-Token` header. The endpoint hashes passwords with the existing bcrypt implementation and returns the created user's ID, name, email, and role. Usernames and email addresses are normalized to lowercase and must be unique. Duplicate username/email values return `409`; validation errors return `400`.

`GET /api/v1/admin/patients` requires an active admin JWT and an allowed `Origin`. It returns the 50 most recently created records from `patients`, including ID, name, phone, gender, and creation time. It does not read user accounts or expose login credentials.

`GET /api/v1/admin/users` lists staff users only, including profile fields and `isSignedIn`, derived from non-revoked, unexpired `user_sessions`. `PATCH /api/v1/admin/users/:id` requires an authenticated admin, allowed `Origin`, and matching CSRF token. It accepts staff profile fields, role, and an optional replacement password. Password and role changes revoke the affected user's sessions; updates and staff creation are written to `admin_audit_events`. The final administrator cannot be demoted.

No temporary password is emailed or otherwise distributed by the backend. The operator must convey a generated temporary password through an appropriate secure workflow outside this API.

## Authorization boundary

The frontend's role routes redirect and render a role-themed dashboard only after `GET /api/v1/auth/me` verifies the JWT, active user, and role from PostgreSQL. These client routes control presentation, not access to protected data. The dashboard content remains sample data; there are no live dashboard APIs. Any future backend data endpoints must independently verify the JWT and enforce role authorization server-side. Do not treat frontend route guards as a data authorization boundary.
