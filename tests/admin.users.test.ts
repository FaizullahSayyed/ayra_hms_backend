import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createAdminUserHandler } from "../src/controllers/admin-user.controller.js";
import { createAdminRouter } from "../src/routes/admin.route.js";
import type { UserCreationDatabase } from "../src/services/user.service.js";
import type { UserRole } from "../src/types/auth.js";
import { AUTH_COOKIE_NAME, CSRF_HEADER_NAME } from "../src/middlewares/session.middleware.js";
import { generateAccessToken } from "../src/utils/jwt.js";

const allowedOrigin = "https://frontend.example.test";
const csrfToken = "C".repeat(43);
const accountRequest = {
  username: "  Mira.Shah ",
  email: " Mira@Example.Test ",
  firstName: " Mira ",
  lastName: " Shah ",
  password: "temporary-random-password",
  phone: " +1 555 0100 ",
  gender: "female",
  role: "doctor",
};

interface ApiResponse {
  success: boolean;
  message: string;
  errors?: Record<string, string[]>;
  user?: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    password_hash?: string;
  };
}

async function withAdminEndpoint<T>(
  role: UserRole | null,
  handler: RequestHandler,
  run: (url: string) => Promise<T>,
): Promise<T> {
  const authenticationDatabase = {
    query: async () => ({
      rows: role
        ? [{
        id: "actor-123",
        name: "Hospital Admin",
        email: "admin@example.test",
        role,
        }]
        : [],
    }),
  };
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use("/api/v1/admin", createAdminRouter({
    authenticationDatabase,
    allowedOrigins: [allowedOrigin],
    createUserHandler: handler,
  }));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");

  try {
    return await run(`http://127.0.0.1:${address.port}/api/v1/admin/users`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function postUser(
  url: string,
  body: unknown,
  options: { authenticated?: boolean; origin?: string; csrf?: string } = {},
): Promise<{ status: number; body: ApiResponse }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: options.origin ?? allowedOrigin,
  };
  if (options.authenticated !== false) {
    headers.Cookie = `${AUTH_COOKIE_NAME}=${generateAccessToken({
      userId: "actor-123",
      role: "patient",
      csrfToken,
    })}`;
    headers[CSRF_HEADER_NAME] = options.csrf ?? csrfToken;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as ApiResponse };
}

function createDatabase(
  onInsert: (sql: string, values: (string | null)[]) => void,
): UserCreationDatabase {
  return {
    query: async <T>(sql: string, values: (string | null)[] = []) => {
      onInsert(sql, values);
      return {
        rows: [{
          id: "generated-user-id",
          name: String(values[1]),
          email: String(values[4]),
          role: values[6] as UserRole,
        } as T],
      };
    },
  };
}

test("admin can create a user with normalized safe response and a persisted password hash", async () => {
  let insertedSql = "";
  let insertedValues: (string | null)[] = [];
  let passwordToHash = "";
  const database = createDatabase((sql, values) => {
    insertedSql = sql;
    insertedValues = values;
  });
  const handler = createAdminUserHandler(database, async (password) => {
    passwordToHash = password;
    return "bcrypt-hash-value";
  });

  await withAdminEndpoint("admin", handler, async (url) => {
    const response = await postUser(url, accountRequest);
    assert.equal(response.status, 201);
    assert.deepEqual(response.body, {
      success: true,
      message: "User created.",
      user: {
        id: "generated-user-id",
        name: "Mira Shah",
        email: "mira@example.test",
        role: "doctor",
      },
    });
    assert.equal(passwordToHash, accountRequest.password);
    assert.match(insertedSql, /INSERT INTO users/);
    assert.equal(insertedValues[0], "mira.shah");
    assert.equal(insertedValues[1], "Mira Shah");
    assert.equal(insertedValues[2], "Mira");
    assert.equal(insertedValues[3], "Shah");
    assert.equal(insertedValues[4], "mira@example.test");
    assert.equal(insertedValues[5], "bcrypt-hash-value");
    assert.equal(insertedValues[6], "doctor");
    assert.equal(insertedValues[7], "+1 555 0100");
    assert.equal(insertedValues[8], "female");
    assert.equal(insertedValues.includes(accountRequest.password), false);
    assert.equal(JSON.stringify(response.body).includes(accountRequest.password), false);
    assert.equal(JSON.stringify(response.body).includes("password_hash"), false);
  });
});

test("admin endpoint rejects unauthenticated and non-admin callers", async () => {
  let handlerCalled = false;
  const handler: RequestHandler = (_request, response) => {
    handlerCalled = true;
    response.status(201).json({ success: true });
  };

  await withAdminEndpoint("admin", handler, async (url) => {
    const response = await postUser(url, accountRequest, { authenticated: false });
    assert.equal(response.status, 401);
    assert.equal(handlerCalled, false);
  });
  await withAdminEndpoint("doctor", handler, async (url) => {
    const response = await postUser(url, accountRequest);
    assert.equal(response.status, 403);
    assert.equal(response.body.success, false);
    assert.equal(handlerCalled, false);
  });
});

test("admin endpoint enforces trusted origin and CSRF before user creation", async () => {
  let handlerCalled = false;
  const handler: RequestHandler = (_request, response) => {
    handlerCalled = true;
    response.status(201).json({ success: true });
  };

  await withAdminEndpoint("admin", handler, async (url) => {
    const response = await postUser(url, accountRequest, { origin: "https://untrusted.example.test" });
    assert.equal(response.status, 403);
    assert.equal(handlerCalled, false);
  });
  await withAdminEndpoint("admin", handler, async (url) => {
    const response = await postUser(url, accountRequest, { csrf: "X".repeat(43) });
    assert.equal(response.status, 403);
    assert.equal(handlerCalled, false);
  });
});

test("admin user validation rejects malformed fields before persistence", async () => {
  let databaseCalled = false;
  const database = createDatabase(() => { databaseCalled = true; });
  const handler = createAdminUserHandler(database, async () => "unused-hash");

  await withAdminEndpoint("admin", handler, async (url) => {
    const response = await postUser(url, {
      ...accountRequest,
      email: "not-an-email",
      password: "short",
      gender: "unknown",
      role: "root",
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.message, "Validation failed");
    assert.ok(response.body.errors?.email);
    assert.ok(response.body.errors?.password);
    assert.ok(response.body.errors?.gender);
    assert.ok(response.body.errors?.role);
    assert.equal(databaseCalled, false);
  });
});

test("admin user creation handles uniqueness and database failures without success fallbacks", async () => {
  const duplicateDatabase: UserCreationDatabase = {
    query: async <T>() => {
      throw Object.assign(new Error("unique violation"), { code: "23505" });
    },
  };
  const failedDatabase: UserCreationDatabase = {
    query: async <T>() => {
      throw new Error("database unavailable");
    },
  };

  await withAdminEndpoint("admin", createAdminUserHandler(duplicateDatabase, async () => "hash"), async (url) => {
    const response = await postUser(url, accountRequest);
    assert.equal(response.status, 409);
    assert.equal(response.body.message, "Username or email is already in use.");
    assert.equal(response.body.user, undefined);
  });
  await withAdminEndpoint("admin", createAdminUserHandler(failedDatabase, async () => "hash"), async (url) => {
    const response = await postUser(url, accountRequest);
    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
    assert.equal(response.body.message, "Unable to create user.");
    assert.equal(response.body.user, undefined);
  });
});
