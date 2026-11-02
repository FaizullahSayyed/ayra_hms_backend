# Authentication API

## Login

`POST /api/v1/auth/login` accepts a JSON body containing an email and password. Email addresses are trimmed and lowercased; passwords are not trimmed. On success it returns only the user's name, email, and database-stored role. Invalid credentials and disabled accounts use the same `401` response.

The server creates a cryptographically random opaque session ID and stores only its SHA-256 hash in PostgreSQL. Session records expire after `SESSION_TTL_DAYS` (7 days by default) and can be revoked by logout. The session cookie is HttpOnly, host-only, and Secure in production.

## Cookies and CSRF

Send browser requests with credentials enabled (for example, `fetch(..., { credentials: "include" })`). Login sets the HttpOnly `ayra_session` cookie and returns a random, session-bound CSRF token in the `X-CSRF-Token` response header. `GET /api/v1/auth/me` validates the cookie-backed session against PostgreSQL, rotates the CSRF token, and returns only the authenticated user's name, email, and database-stored role. This restores role-aware UI state after a page refresh. The API exposes the CSRF response header to the exact configured frontend origins. Keep the CSRF token in application memory; it is not an authentication/session token and is never placed in the response body.

For authenticated state-changing requests, send the session cookie automatically with `credentials: "include"` and send the CSRF value in the `X-CSRF-Token` request header. The server validates it against the hash stored with the active session. Do not send the session ID from JavaScript or store it outside the HttpOnly cookie.

`POST /api/v1/auth/logout` requires an allowed `Origin`, an active session cookie, and the matching CSRF header. It revokes the server-side session and clears the session cookie. The same origin allowlist is used by credentialed CORS; `CLIENT_URL` must be a comma-separated list of exact frontend origins, including `http://localhost:5173` and `https://ayra-hms-frontend.vercel.app` as appropriate.

`SESSION_COOKIE_SAME_SITE` defaults to `lax` in development and `none` in production to support separately deployed frontend and backend sites. `SameSite=none` is accepted only with `NODE_ENV=production`, where Secure cookies are enabled.

## Setup

Set `DATABASE_URL`, `DATABASE_CA_CERT`, `CLIENT_URL`, `JWT_SECRET`, and `NODE_ENV` using deployment secrets/environment settings. Keep `SESSION_TTL_DAYS` at its default unless a different session lifetime is required. Do not commit `.env` or private CA files.

Apply the additive session-table migration with:

```powershell
npm run db:up
```

The migration can be rolled back with `npm run db:down`; this drops the session table and logs users out. Existing user and role data is not changed.

## Authorization boundary

The frontend's role routes redirect and render a role-themed dashboard only after `GET /api/v1/auth/me` verifies the active session and the role from PostgreSQL. These client routes control presentation, not access to protected data. The dashboard content remains sample data; there are no live dashboard APIs. Any future backend data endpoints must independently require an authenticated session and enforce role authorization server-side. Do not treat frontend route guards as a data authorization boundary.
