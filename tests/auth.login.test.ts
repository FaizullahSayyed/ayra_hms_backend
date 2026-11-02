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
  SESSION_COOKIE_NAME,
} from "../src/middlewares/session.middleware.js";
import { createAuthRouter } from "../src/routes/auth.route.js";
import {
  hashOpaqueValue,
  PostgresSessionService,
  type SessionCredentials,
  type SessionDatabase,
  type SessionService,
} from "../src/services/session.service.js";

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
  role: "patient" | "biller" | "receptionist" | "nurse" | "doctor" | "admin";
  password_hash: string;
  is_active: boolean;
}

interface LoginDatabase {
  query(sql: string, values: string[]): Promise<{ rows: LoginUser[] }>;
}

interface LoginDependencies {
  database: LoginDatabase;
  sessions: SessionService;
  verifyPassword: (password: string, hash: string) => Promise<boolean>;
  dummyPasswordHash: Promise<string>;
  cookieSettings: {
    secure: boolean;
    sameSite: "lax" | "strict" | "none";
    ttlDays: number;
  };
}

function createLoginUser(overrides: Partial<LoginUser> = {}): LoginUser {
  return {
    id: "user-123",
    name: "Aanya Patel",
    email: "aanya@example.test",
    role: "patient",
    password_hash: "stored-bcrypt-hash",
    is_active: true,
    ...overrides,
  };
}

function createSessions(overrides: Partial<SessionService> = {}): SessionService {
  return {
    create: async () => ({
      sessionId: "S".repeat(43),
      csrfToken: "C".repeat(43),
    }),
    authenticate: async () => null,
    refreshCsrf: async () => "C".repeat(43),
    validateCsrf: async () => false,
    revoke: async () => undefined,
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
    sessions: createSessions(),
    verifyPassword: async (password, hash) =>
      password === loginRequest.password && hash === "stored-bcrypt-hash",
    dummyPasswordHash: Promise.resolve("dummy-bcrypt-hash"),
    cookieSettings: { secure: true, sameSite: "none", ttlDays: 7 },
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
  let createdUserId = "";
  const sessions = createSessions({
    create: async (userId) => {
      createdUserId = userId;
      return { sessionId: "S".repeat(43), csrfToken: "C".repeat(43) };
    },
  });
  const handler = createLoginHandlerWith({
    database: {
      query: async (_sql, values) => {
        queriedEmail = values[0];
        return {
          rows: [createLoginUser({ role: "doctor" })],
        };
      },
    },
    sessions,
    verifyPassword: async (_password, hash) => hash === "stored-bcrypt-hash",
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
    assert.equal(createdUserId, "user-123");
    assert.equal(JSON.stringify(response.body).includes("token"), false);
    assert.equal(JSON.stringify(response.body).includes("password"), false);

    const sessionCookie = response.setCookies.find((cookie) =>
      cookie.startsWith(`${SESSION_COOKIE_NAME}=`)
    );
    assert.ok(sessionCookie);
    assert.ok(sessionCookie.includes("HttpOnly"));
    assert.ok(sessionCookie.includes("Secure"));
    assert.ok(sessionCookie.includes("SameSite=None"));
    assert.ok(sessionCookie.includes("Path=/api/v1/auth"));
    assert.equal(sessionCookie.includes("S".repeat(43)), true);
    assert.equal(response.setCookies.length, 1);
    assert.equal(response.csrfToken, "C".repeat(43));
    assert.equal(JSON.stringify(response.body).includes("C".repeat(43)), false);
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

test("database and session failures never create a successful login response", async () => {
  const failureCases: LoginDependencies[] = [
    {
      database: {
        query: async () => {
          throw new Error("database failure");
        },
      },
      sessions: createSessions(),
      verifyPassword: async () => true,
      dummyPasswordHash: Promise.resolve("dummy-bcrypt-hash"),
      cookieSettings: { secure: true, sameSite: "none", ttlDays: 7 },
    },
    {
      database: { query: async () => ({ rows: [createLoginUser()] }) },
      sessions: createSessions({
        create: async () => {
          throw new Error("session storage failure");
        },
      }),
      verifyPassword: async () => true,
      dummyPasswordHash: Promise.resolve("dummy-bcrypt-hash"),
      cookieSettings: { secure: true, sameSite: "none", ttlDays: 7 },
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
    sessions: createSessions({
      create: async () => {
        throw missingTableError;
      },
    }),
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

test("current-user endpoint restores a database-verified role and a fresh CSRF token", async () => {
  const csrfToken = "T".repeat(43);
  const sessions = createSessions({
    authenticate: async (sessionId) => ({
      id: "user-123",
      name: "Aanya Patel",
      email: "aanya@example.test",
      role: "doctor",
      sessionId,
    }),
    refreshCsrf: async () => csrfToken,
  });

  await withAuthServer({
    sessions,
    currentUserHandler: createCurrentUserHandler(sessions),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/me`, {
      headers: {
        Origin: allowedOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=${"S".repeat(43)}`,
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
  });
});

test("logout requires a matching CSRF cookie/header and revokes the session", async () => {
  const credentials: SessionCredentials = {
    sessionId: "session-cookie-value",
    csrfToken: "C".repeat(43),
  };
  const calls: string[] = [];
  const sessions = createSessions({
    authenticate: async (sessionId) => {
      assert.equal(sessionId, credentials.sessionId);
      return {
        id: "user-123",
        name: "Aanya Patel",
        email: "aanya@example.test",
        role: "patient",
        sessionId,
      };
    },
    validateCsrf: async (sessionId, csrfToken) => {
      calls.push("csrf");
      return sessionId === credentials.sessionId && csrfToken === credentials.csrfToken;
    },
    revoke: async (sessionId) => {
      assert.equal(sessionId, credentials.sessionId);
      calls.push("revoke");
    },
  });
  const logoutHandler = createLogoutHandler(sessions, { secure: true, sameSite: "none" });
  const wrongCsrfToken = "A".repeat(43);

  await withAuthServer({ sessions, logoutHandler }, async (baseUrl) => {
    const denied = await postJson(`${baseUrl}/logout`, {}, {
      Cookie: `${SESSION_COOKIE_NAME}=${credentials.sessionId}`,
      [CSRF_HEADER_NAME]: wrongCsrfToken,
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(calls, ["csrf"]);

    const accepted = await postJson(`${baseUrl}/logout`, {}, {
      Cookie: `${SESSION_COOKIE_NAME}=${credentials.sessionId}`,
      [CSRF_HEADER_NAME]: credentials.csrfToken,
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(calls, ["csrf", "csrf", "revoke"]);
    assert.ok(accepted.setCookies.some((cookie) =>
      cookie.startsWith(`${SESSION_COOKIE_NAME}=`) && cookie.includes("Expires=Thu, 01 Jan 1970")
    ));
  });
});

test("session service stores only one-way hashes and revokes the hashed ID", async () => {
  const captured: Array<{ sql: string; values: unknown[] }> = [];
  const database: SessionDatabase = {
    query: async <T extends import("pg").QueryResultRow>(
      sql: string,
      values: (string | number)[] = [],
    ) => {
      captured.push({ sql, values });
      return { rows: [{ session_hash: "stored-hash" }] as T[] };
    },
  };
  const sessions = new PostgresSessionService(database, 3);

  const credentials = await sessions.create("user-123");
  assert.notEqual(credentials.sessionId, credentials.csrfToken);
  assert.ok(credentials.sessionId.length >= 40);
  assert.equal(captured[0].values[0], hashOpaqueValue(credentials.sessionId));
  assert.equal(captured[0].values[1], hashOpaqueValue(credentials.csrfToken));
  assert.equal(captured[0].values.includes(credentials.sessionId), false);
  assert.equal(captured[0].values.includes(credentials.csrfToken), false);

  await sessions.revoke(credentials.sessionId);
  assert.equal(captured[1].values[0], hashOpaqueValue(credentials.sessionId));
  assert.match(captured[1].sql, /revoked_at = NOW\(\)/);

  const freshCsrf = await sessions.refreshCsrf(credentials.sessionId);
  assert.ok(freshCsrf);
  assert.equal(captured[2].values[0], hashOpaqueValue(credentials.sessionId));
  assert.equal(captured[2].values[1], hashOpaqueValue(freshCsrf));
  assert.equal(captured[2].values.includes(freshCsrf), false);
});
