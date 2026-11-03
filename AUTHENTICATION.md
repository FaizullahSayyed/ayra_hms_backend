# Authentication API

## Login

`POST /api/v1/auth/login` accepts a JSON body containing an email and password. Email addresses are trimmed and lowercased; passwords are not trimmed. On success it returns only the user's name, email, and database-stored role. Invalid credentials and disabled accounts use the same `401` response.

The server signs a JWT with HS256 using `JWT_SECRET`. It expires after 30 days and is stored in the HttpOnly, host-only `ayra_token` cookie (Secure in production). The JWT is not returned in the response body. The cookie is sent to `/api/v1` endpoints and is automatically included in browser requests that use `credentials: "include"`.

## Cookies and CSRF

Send browser requests with credentials enabled (for example, `fetch(..., { credentials: "include" })`). Login returns a random CSRF token in the `X-CSRF-Token` response header; the signed JWT binds that token to the authenticated session. `GET /api/v1/auth/me` verifies the JWT cookie, checks that the user is still active in PostgreSQL, and returns only the user's name, email, and current database-stored role. It also returns the CSRF token in the exposed response header so the frontend can restore role-aware UI state after a page refresh. Keep the CSRF token in application memory; it is never placed in the response body.

For authenticated state-changing requests, send the JWT cookie automatically with `credentials: "include"` and send the CSRF value in the `X-CSRF-Token` request header. The server verifies that it matches the signed JWT claim. Do not send the JWT from JavaScript or store it outside the HttpOnly cookie.

`POST /api/v1/auth/logout` requires an allowed `Origin`, a valid JWT cookie, and the matching CSRF header. It clears the cookie. Because JWTs are stateless, clearing the browser cookie does not revoke a copied token; it remains usable until its 30-day expiration unless the user is disabled. The cookie path is `/api/v1` so it is sent to both authentication and authorized admin endpoints. The same origin allowlist is used by credentialed CORS; `CLIENT_URL` must be a comma-separated list of exact frontend origins, including `http://localhost:5173` and `https://ayra-hms-frontend.vercel.app` as appropriate.

`SESSION_COOKIE_SAME_SITE` defaults to `lax` in development and `none` in production to support separately deployed frontend and backend sites. `SameSite=none` is accepted only with `NODE_ENV=production`, where Secure cookies are enabled.

## Setup

Set `DATABASE_URL`, `DATABASE_CA_CERT`, `CLIENT_URL`, `JWT_SECRET`, and `NODE_ENV` using deployment secrets/environment settings. `JWT_SECRET` must contain at least 32 characters and must be kept private. Do not commit `.env` or private CA files.

Apply the pending database migrations with:

```powershell
npm run db:up
```

`npm run db:up` applies the additive user-profile migration required by the account forms. It adds nullable `username`, `first_name`, `last_name`, `phone`, and `gender` columns, a unique username index, and a gender-value constraint. Existing users and password hashes are preserved; their new profile columns remain null until updated. New account creation requires the profile fields. Rolling back the user-profile migration drops these added profile columns (and any values entered in them), but does not drop the users table or password hashes. An older session-table migration may still be applied as part of the migration history, but JWT authentication does not depend on that table.

## Account creation

`POST /api/v1/auth/register` accepts `username`, `email`, `firstName`, `lastName`, `password`, optional `phone`, `gender`, and an optional `role` (defaults to `patient`). It creates patient accounts only. Requests asking for any staff role receive `403 STAFF_REGISTRATION_UNAVAILABLE`; staff accounts must be provisioned by an administrator.

`POST /api/v1/admin/users` accepts the same account fields and requires an active admin JWT, an allowed `Origin`, and the matching `X-CSRF-Token` header. The role is validated against the server's role enum and can be assigned only through this authenticated admin workflow. Both endpoints hash passwords with the existing bcrypt implementation and return only the created user's ID, name, email, and role. Usernames are normalized to lowercase and, like email, must be unique. Duplicate username/email values return `409`; validation errors return `400`.

No temporary password is emailed or otherwise distributed by the backend. The operator must convey a generated temporary password through an appropriate secure workflow outside this API.

## Authorization boundary

The frontend's role routes redirect and render a role-themed dashboard only after `GET /api/v1/auth/me` verifies the JWT, active user, and role from PostgreSQL. These client routes control presentation, not access to protected data. The dashboard content remains sample data; there are no live dashboard APIs. Any future backend data endpoints must independently verify the JWT and enforce role authorization server-side. Do not treat frontend route guards as a data authorization boundary.
