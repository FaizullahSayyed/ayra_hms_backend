import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import {
  createLoginHandler,
  createLogoutHandler,
} from "../src/controllers/login.controller.js";
import { createCurrentUserHandler } from "../src/controllers/current-user.controller.js";
import {
  CSRF_HEADER_NAME,
  AUTH_COOKIE_NAME,
} from "../src/middlewares/session.middleware.js";
import { AUTH_COOKIE_MAX_AGE_MS, AUTH_COOKIE_PATH } from "../src/utils/auth-cookie.js";
import { createAuthRouter } from "../src/routes/auth.route.js";
import { generateAccessToken, verifyAccessToken } from "../src/utils/jwt.js";
import type { UserRole } from "../src/types/auth.js";

const allowedOrigin = "https://ayra-hms-frontend.vercel.app";
const loginRequest = {
  email: "  AANYA@EXAMPLE.TEST ",
  password: "a secure password",
};

interface LoginResponse {
  success: boolean;
  message: string;
  user?: { name: string; email: string; role: string };
  errors?: Record<string, string[]>;
}

interface LoginUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  password_hash: string;
  is_active: boolean;
}

interface LoginDatabase {
  query(sql: string, values: string[]): Promise<{ rows: LoginUser[] }>;
}

interface LoginDependencies {
  database: LoginDatabase;
  verifyPassword: (password: string, hash: string) => Promise<boolean>;
  dummyPasswordHash: Promise<string>;
  generateToken: typeof generateAccessToken;
  recordSession: (userId: string, token: string, csrfToken: string, expiresAt: Date) => Promise<void>;
  cookieSettings: {
    secure: boolean;
    sameSite: "lax" | "strict" | "none";
  };
}

interface AuthenticationUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

interface AuthenticationDatabase {
  query(sql: string, values: string[]): Promise<{ rows: AuthenticationUser[] }>;
}

function createLoginUser(overrides: Partial<LoginUser> = {}): LoginUser {
  return {
    id: "user-123",
    name: "Aanya Patel",
    email: "aanya@example.test",
    role: "doctor",
    password_hash: "stored-bcrypt-hash",
    is_active: true,
    ...overrides,
  };
}

function createLoginHandlerWith(
  overrides: Partial<LoginDependencies> = {},
): RequestHandler {
  const dependencies: LoginDependencies = {
    database: {
      query: async () => ({ rows: [createLoginUser()] }),
    },
    verifyPassword: async (password, hash) =>
      password === loginRequest.password && hash === "stored-bcrypt-hash",
    dummyPasswordHash: Promise.resolve("dummy-bcrypt-hash"),
    generateToken: generateAccessToken,
    recordSession: async () => {},
    cookieSettings: { secure: true, sameSite: "none" },
    ...overrides,
  };

  return createLoginHandler(dependencies);
}

async function withAuthServer<T>(
  dependencies: Parameters<typeof createAuthRouter>[0],
  run: (url: string) => Promise<T>,
): Promise<T> {
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use("/api/v1/auth", createAuthRouter({
    ...dependencies,
    allowedOrigins: [allowedOrigin],
  }));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  try {
    return await run(`http://127.0.0.1:${address.port}/api/v1/auth`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  body: LoginResponse;
  setCookies: string[];
  csrfToken: string | null;
}> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: allowedOrigin,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as LoginResponse,
    setCookies: response.headers.getSetCookie(),
    csrfToken: response.headers.get(CSRF_HEADER_NAME),
  };
}

test("login returns safe user data and secure server-managed cookies", async () => {
  let queriedEmail = "";
  let recordedSession: { userId: string; token: string; csrfToken: string; expiresAt: Date } | undefined;
  const handler = createLoginHandlerWith({
    database: {
      query: async (_sql, values) => {
        queriedEmail = values[0];
        return {
          rows: [createLoginUser({ role: "doctor" })],
        };
      },
    },
    verifyPassword: async (_password, hash) => hash === "stored-bcrypt-hash",
    recordSession: async (userId, token, csrfToken, expiresAt) => {
      recordedSession = { userId, token, csrfToken, expiresAt };
    },
  });

  await withAuthServer({ loginHandler: handler }, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/login`, loginRequest);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      success: true,
      message: "Signed in successfully.",
      user: {
        name: "Aanya Patel",
        email: "aanya@example.test",
        role: "doctor",
      },
    });
    assert.equal(queriedEmail, "aanya@example.test");
    assert.equal(JSON.stringify(response.body).includes("token"), false);
    assert.equal(JSON.stringify(response.body).includes("password"), false);

    const tokenCookie = response.setCookies.find((cookie) =>
      cookie.startsWith(`${AUTH_COOKIE_NAME}=`)
    );
    assert.ok(tokenCookie);
    assert.ok(tokenCookie.includes("HttpOnly"));
    assert.ok(tokenCookie.includes("Secure"));
    assert.ok(tokenCookie.includes("SameSite=None"));
    assert.ok(tokenCookie.includes(`Path=${AUTH_COOKIE_PATH}`));
    assert.ok(tokenCookie.includes(`Max-Age=${AUTH_COOKIE_MAX_AGE_MS / 1000}`));
    const token = decodeURIComponent(tokenCookie.split(";")[0].split("=")[1]);
    const payload = verifyAccessToken(token);
    assert.equal(payload.userId, "user-123");
    assert.equal(payload.role, "doctor");
    assert.match(payload.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(response.setCookies.length, 1);
    assert.equal(response.csrfToken, payload.csrfToken);
    const tokenParts = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    assert.deepEqual(recordedSession, {
      userId: "user-123",
      token,
      csrfToken: payload.csrfToken,
      expiresAt: new Date(tokenParts.exp * 1000),
    });
    assert.equal(JSON.stringify(response.body).includes(payload.csrfToken), false);
    assert.equal(tokenParts.exp - tokenParts.iat, 30 * 24 * 60 * 60);
  });
});

test("invalid and disabled credentials return the same generic 401", async () => {
  const cases: Array<{
    rows: LoginUser[];
    verifyPassword: (password: string, hash: string) => Promise<boolean>;
    expectedHash: string;
  }> = [
    {
      rows: [],
      verifyPassword: async (_password, hash) => hash === "dummy-bcrypt-hash",
      expectedHash: "dummy-bcrypt-hash",
    },
    {
      rows: [createLoginUser()],
      verifyPassword: async () => false,
      expectedHash: "stored-bcrypt-hash",
    },
    {
      rows: [createLoginUser({ is_active: false })],
      verifyPassword: async (_password, hash) => hash === "stored-bcrypt-hash",
      expectedHash: "stored-bcrypt-hash",
    },
  ];

  for (const testCase of cases) {
    let verifiedHash = "";
    const handler = createLoginHandlerWith({
      database: { query: async () => ({ rows: testCase.rows }) },
      verifyPassword: async (password, hash) => {
        verifiedHash = hash;
        return testCase.verifyPassword(password, hash);
      },
    });

    await withAuthServer({ loginHandler: handler }, async (baseUrl) => {
      const response = await postJson(`${baseUrl}/login`, loginRequest);
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, {
        success: false,
        message: "Invalid email or password.",
      });
      assert.deepEqual(response.setCookies, []);
      assert.equal(verifiedHash, testCase.expectedHash);
    });
  }
});

test("login validates and normalizes untrusted fields", async () => {
  let queryCalled = false;
  const handler = createLoginHandlerWith({
    database: {
      query: async () => {
        queryCalled = true;
        return { rows: [] };
      },
    },
  });

  await withAuthServer({ loginHandler: handler }, async (baseUrl) => {
    for (const invalidBody of [
      { email: "bad-email", password: "password" },
      { email: "user@example.test", password: "" },
      { email: "user@example.test", password: "password", role: "admin" },
    ]) {
      const response = await postJson(`${baseUrl}/login`, invalidBody);
      assert.equal(response.status, 400);
      assert.equal(response.body.message, "Validation failed");
    }
    assert.equal(queryCalled, false);
  });
});

test("login rejects untrusted or missing origins", async () => {
  const handler = createLoginHandlerWith();
  await withAuthServer({ loginHandler: handler }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify(loginRequest),
    });
    assert.equal(response.status, 403);
  });
});

test("database and token failures never create a successful login response", async () => {
  const failureCases: LoginDependencies[] = [
    {
      database: {
        query: async () => {
          throw new Error("database failure");
        },
      },
      generateToken: generateAccessToken,
      verifyPassword: async () => true,
      dummyPasswordHash: Promise.resolve("dummy-bcrypt-hash"),
      cookieSettings: { secure: true, sameSite: "none" },
    },
    {
      database: { query: async () => ({ rows: [createLoginUser()] }) },
      generateToken: () => { throw new Error("token signing failure"); },
      verifyPassword: async () => true,
      dummyPasswordHash: Promise.resolve("dummy-bcrypt-hash"),
      cookieSettings: { secure: true, sameSite: "none" },
    },
  ];

  for (const dependencies of failureCases) {
    await withAuthServer(
      { loginHandler: createLoginHandler(dependencies) },
      async (baseUrl) => {
        const response = await postJson(`${baseUrl}/login`, loginRequest);
        assert.equal(response.status, 503);
        assert.equal(response.body.success, false);
        assert.equal(response.body.user, undefined);
        assert.deepEqual(response.setCookies, []);
      },
    );
  }
});

test("missing authentication tables return a migration setup hint", async () => {
  const missingTableError = Object.assign(new Error("details must not be logged"), {
    code: "42P01",
  });
  const handler = createLoginHandlerWith({
    database: { query: async () => { throw missingTableError; } },
    verifyPassword: async () => true,
  });

  await withAuthServer({ loginHandler: handler }, async (baseUrl) => {
    const response = await postJson(`${baseUrl}/login`, loginRequest);
    assert.equal(response.status, 503);
    assert.equal(
      response.body.message,
      "Authentication database tables are not initialized. Apply the database migrations with `npm run db:up`.",
    );
    assert.equal(response.body.user, undefined);
    assert.deepEqual(response.setCookies, []);
  });
});

test("current-user endpoint verifies the JWT cookie and returns its CSRF token", async () => {
  const csrfToken = "T".repeat(43);
  let authenticationSql = "";
  const authenticationDatabase: AuthenticationDatabase = {
    query: async (_sql, values) => {
      authenticationSql = _sql;
      assert.equal(values[0], "user-123");
      assert.match(values[1], /^[a-f0-9]{64}$/);
      return {
        rows: [{
          id: "user-123",
          name: "Aanya Patel",
          email: "aanya@example.test",
          role: "doctor",
        }],
      };
    },
  };

  await withAuthServer({
    authenticationDatabase,
    currentUserHandler: createCurrentUserHandler(),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/me`, {
      headers: {
        Origin: allowedOrigin,
        Cookie: `${AUTH_COOKIE_NAME}=${generateAccessToken({
          userId: "user-123",
          role: "doctor",
          csrfToken,
        })}`,
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      user: {
        name: "Aanya Patel",
        email: "aanya@example.test",
        role: "doctor",
      },
    });
    assert.equal(response.headers.get(CSRF_HEADER_NAME), csrfToken);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.match(authenticationSql, /JOIN user_sessions/i);
    assert.match(authenticationSql, /revoked_at IS NULL/i);
    assert.match(authenticationSql, /expires_at > NOW\(\)/i);
  });
});

test("invalid JWT cookies are rejected before user lookup", async () => {
  let queries = 0;
  const authenticationDatabase: AuthenticationDatabase = {
    query: async () => {
      queries += 1;
      return { rows: [] };
    },
  };

  await withAuthServer({ authenticationDatabase }, async (baseUrl) => {
    for (const cookie of [undefined, `${AUTH_COOKIE_NAME}=not-a-jwt`]) {
      const response = await fetch(`${baseUrl}/me`, {
        headers: {
          Origin: allowedOrigin,
          ...(cookie ? { Cookie: cookie } : {}),
        },
      });
      assert.equal(response.status, 401);
    }
    assert.equal(queries, 0);
  });
});

test("JWTs for inactive or missing users are rejected", async () => {
  const authenticationDatabase: AuthenticationDatabase = {
    query: async () => ({ rows: [] }),
  };

  await withAuthServer({ authenticationDatabase }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/me`, {
      headers: {
        Origin: allowedOrigin,
        Cookie: `${AUTH_COOKIE_NAME}=${generateAccessToken({
          userId: "disabled-user",
          role: "doctor",
          csrfToken: "C".repeat(43),
        })}`,
      },
    });
    assert.equal(response.status, 401);
  });
});

test("logout requires a matching CSRF token and clears the JWT cookie", async () => {
  const csrfToken = "C".repeat(43);
  const authenticationDatabase: AuthenticationDatabase = {
    query: async () => ({
      rows: [{
        id: "user-123",
        name: "Aanya Patel",
        email: "aanya@example.test",
        role: "doctor",
      }],
    }),
  };
  let revokedSessionHash = "";
  const logoutHandler = createLogoutHandler(
    { secure: true, sameSite: "none" },
    async (sessionHash) => { revokedSessionHash = sessionHash; },
  );
  const wrongCsrfToken = "A".repeat(43);

  await withAuthServer({ authenticationDatabase, logoutHandler }, async (baseUrl) => {
    const tokenCookie = `${AUTH_COOKIE_NAME}=${generateAccessToken({
      userId: "user-123",
      role: "doctor",
      csrfToken,
    })}`;
    const denied = await postJson(`${baseUrl}/logout`, {}, {
      Cookie: tokenCookie,
      [CSRF_HEADER_NAME]: wrongCsrfToken,
    });
    assert.equal(denied.status, 403);

    const accepted = await postJson(`${baseUrl}/logout`, {}, {
      Cookie: tokenCookie,
      [CSRF_HEADER_NAME]: csrfToken,
    });
    assert.equal(accepted.status, 200);
    assert.match(revokedSessionHash, /^[a-f0-9]{64}$/);
    assert.ok(accepted.setCookies.some((cookie) =>
      cookie.startsWith(`${AUTH_COOKIE_NAME}=`) && cookie.includes("Expires=Thu, 01 Jan 1970")
    ));
  });
});
