import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import {
  createAdminStaffListHandler,
  createAdminStaffUpdateHandler,
} from "../src/controllers/admin-staff.controller.js";
import { createAdminRouter } from "../src/routes/admin.route.js";
import type {
  AdminStaffDatabase,
  StaffRecord,
} from "../src/services/admin-staff.service.js";
import type { UserRole } from "../src/types/auth.js";
import {
  AUTH_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "../src/middlewares/session.middleware.js";
import { generateAccessToken } from "../src/utils/jwt.js";

const allowedOrigin = "https://frontend.example.test";
const csrfToken = "C".repeat(43);
const targetId = "e3f97772-f96f-40f4-9ed1-f53ca6071a90";

const updateRequest = {
  username: "mira.shah",
  firstName: "Mira",
  lastName: "Shah",
  email: "mira@example.test",
  role: "doctor",
};

function currentStaff(overrides: Partial<StaffRecord> = {}): StaffRecord {
  return {
    id: targetId,
    username: "mira.shah",
    first_name: "Mira",
    last_name: "Shah",
    email: "mira@example.test",
    role: "nurse",
    phone: null,
    gender: "female",
    ...overrides,
  };
}

function createDatabase(options: {
  staff?: StaffRecord | null;
  admins?: number;
  signedIn?: boolean;
  gender?: string | null;
  onQuery?: (sql: string, values: (string | number | boolean | null)[]) => void;
} = {}): AdminStaffDatabase {
  const staff = options.staff === undefined ? currentStaff() : options.staff;
  const query = async <T>(sql: string, values: (string | number | boolean | null)[] = []) => {
    options.onQuery?.(sql, values);
    if (/SELECT id, username, first_name, last_name, email, role, phone, gender\s+FROM users/i.test(sql)) {
      const isStaff = staff
        && ["admin", "doctor", "nurse", "biller", "receptionist"].includes(staff.role);
      return { rows: (isStaff ? [staff] : []) as T[] };
    }
    if (/SELECT COUNT\(\*\) AS admin_count/i.test(sql)) {
      return { rows: [{ admin_count: options.admins ?? 2 } as T] };
    }
    if (/UPDATE users/i.test(sql)) {
      return { rows: [{ id: targetId, role: String(values[5]) } as T] };
    }
    if (/FROM users\s+WHERE users\.role IN/i.test(sql)) {
      return {
        rows: [{
          id: targetId,
          username: "mira.shah",
          first_name: "Mira",
          last_name: "Shah",
          email: "mira@example.test",
          role: "nurse",
          phone: null,
          gender: options.gender === undefined ? "female" : options.gender,
          created_at: new Date("2026-11-08T08:30:00.000Z"),
          is_signed_in: options.signedIn ?? true,
        } as T],
      };
    }
    return { rows: [] as T[] };
  };

  const transactionDatabase = { query };
  return {
    query,
    transaction: async <T>(operation: (database: typeof transactionDatabase) => Promise<T>) =>
      operation(transactionDatabase),
  };
}

async function withStaffEndpoint<T>(
  role: UserRole | null,
  database: AdminStaffDatabase,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use("/api/v1/admin", createAdminRouter({
    authenticationDatabase: {
      query: async () => ({
        rows: role
          ? [{ id: "actor-admin", name: "Hospital Admin", email: "admin@example.test", role }]
          : [],
      }),
    },
    allowedOrigins: [allowedOrigin],
    listUsersHandler: createAdminStaffListHandler(database),
    updateUserHandler: createAdminStaffUpdateHandler(database, async () => "bcrypt-hash"),
  }));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  try {
    return await run(`http://127.0.0.1:${address.port}/api/v1/admin/users`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function authHeaders(role: UserRole = "admin"): Record<string, string> {
  const token = generateAccessToken({
    userId: "actor-admin",
    role,
    csrfToken,
  });
  return {
    Origin: allowedOrigin,
    Cookie: `${AUTH_COOKIE_NAME}=${token}`,
  };
}

test("admin staff list returns only the staff contract and derives active sign-in status from sessions", async () => {
  const queries: string[] = [];
  const database = createDatabase({
    signedIn: false,
    gender: null,
    onQuery: (sql) => queries.push(sql),
  });

  await withStaffEndpoint("admin", database, async (url) => {
    const response = await fetch(url, { headers: authHeaders() });
    const body = await response.json() as { success: boolean; users: Record<string, unknown>[] };

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      success: true,
      users: [{
        id: targetId,
        username: "mira.shah",
        firstName: "Mira",
        lastName: "Shah",
        email: "mira@example.test",
        role: "nurse",
        phone: "",
        gender: "prefer-not-to-say",
        createdAt: "2026-11-08T08:30:00.000Z",
        isSignedIn: false,
      }],
    });
    assert.equal("password_hash" in body.users[0], false);
    assert.match(queries[0], /user_sessions/i);
    assert.match(queries[0], /users\.is_active = TRUE/i);
    assert.match(queries[0], /revoked_at IS NULL/i);
    assert.match(queries[0], /expires_at > NOW\(\)/i);
    assert.match(queries[0], /role IN \('admin', 'doctor', 'nurse', 'biller', 'receptionist'\)/i);
  });
});

test("admin staff endpoints reject unauthenticated and non-admin callers", async () => {
  const database = createDatabase();
  await withStaffEndpoint("doctor", database, async (url) => {
    const listResponse = await fetch(url, { headers: authHeaders("doctor") });
    assert.equal(listResponse.status, 403);

    const updateResponse = await fetch(`${url}/${targetId}`, {
      method: "PATCH",
      headers: {
        ...authHeaders("doctor"),
        "Content-Type": "application/json",
        [CSRF_HEADER_NAME]: csrfToken,
      },
      body: JSON.stringify(updateRequest),
    });
    assert.equal(updateResponse.status, 403);
  });

  await withStaffEndpoint(null, database, async (url) => {
    const response = await fetch(url, { headers: { Origin: allowedOrigin } });
    assert.equal(response.status, 401);
  });
});

test("staff update leaves password unchanged when omitted and audits changed fields", async () => {
  const statements: { sql: string; values: (string | number | boolean | null)[] }[] = [];
  const database = createDatabase({
    onQuery: (sql, values) => statements.push({ sql, values }),
  });

  await withStaffEndpoint("admin", database, async (url) => {
    const response = await fetch(`${url}/${targetId}`, {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        [CSRF_HEADER_NAME]: csrfToken,
      },
      body: JSON.stringify({ ...updateRequest, firstName: "Mira Updated", role: "nurse" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      message: "Staff account updated.",
    });
    const update = statements.find((statement) => /UPDATE users/i.test(statement.sql));
    assert.ok(update);
    assert.match(update.sql, /password_hash = COALESCE\(\$11, password_hash\)/);
    assert.equal(update.values[10], null);
    assert.equal(statements.some((statement) => /UPDATE user_sessions/i.test(statement.sql)), false);
    assert.ok(statements.some((statement) =>
      /INSERT INTO admin_audit_events/i.test(statement.sql)
      && !JSON.stringify(statement.values).includes("password")
    ));
  });
});

test("staff update hashes optional password, invalidates sessions, and does not audit the secret", async () => {
  const statements: { sql: string; values: (string | number | boolean | null)[] }[] = [];
  let hashedPassword = "";
  const database = createDatabase({
    onQuery: (sql, values) => statements.push({ sql, values }),
  });
  const handler = createAdminStaffUpdateHandler(database, async (password) => {
    hashedPassword = password;
    return "only-the-hash";
  });

  const app = express();
  app.use(express.json());
  app.use("/api/v1/admin", createAdminRouter({
    authenticationDatabase: {
      query: async () => ({
        rows: [{ id: "actor-admin", name: "Admin", email: "admin@example.test", role: "admin" }],
      }),
    },
    allowedOrigins: [allowedOrigin],
    updateUserHandler: handler,
  }));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");

  try {
    const secret = "a replacement password";
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/admin/users/${targetId}`, {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        [CSRF_HEADER_NAME]: csrfToken,
      },
      body: JSON.stringify({
        ...updateRequest,
        role: "admin",
        phone: "+1 555 0100",
        gender: "female",
        password: secret,
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(hashedPassword, secret);
    const update = statements.find((statement) => /UPDATE users/i.test(statement.sql));
    assert.ok(update);
    assert.ok(update.values.includes("only-the-hash"));
    assert.equal(update.values[7], "+1 555 0100");
    assert.equal(update.values[9], "female");
    assert.equal(update.values.includes(secret), false);
    assert.ok(statements.some((statement) => /UPDATE user_sessions/i.test(statement.sql)));
    const audit = statements.find((statement) => /INSERT INTO admin_audit_events/i.test(statement.sql));
    assert.ok(audit);
    assert.equal(JSON.stringify(audit.values).includes(secret), false);
    assert.equal(JSON.stringify(await response.clone().json()).includes(secret), false);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("staff update rejects invalid fields, patient roles, and missing CSRF before changing data", async () => {
  let updates = 0;
  const database = createDatabase({
    onQuery: (sql) => {
      if (/UPDATE users/i.test(sql)) updates += 1;
    },
  });
  const handler = createAdminStaffUpdateHandler(database, async () => "unused");
  const app = express();
  app.use(express.json());
  app.use("/api/v1/admin", createAdminRouter({
    authenticationDatabase: {
      query: async () => ({
        rows: [{ id: "actor-admin", name: "Admin", email: "admin@example.test", role: "admin" }],
      }),
    },
    allowedOrigins: [allowedOrigin],
    updateUserHandler: handler,
  }));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");

  try {
    const url = `http://127.0.0.1:${address.port}/api/v1/admin/users/${targetId}`;
    const invalidRole = await fetch(url, {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        [CSRF_HEADER_NAME]: csrfToken,
      },
      body: JSON.stringify({ ...updateRequest, role: "patient" }),
    });
    assert.equal(invalidRole.status, 400);

    const missingCsrf = await fetch(url, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(updateRequest),
    });
    assert.equal(missingCsrf.status, 403);

    const overlongName = await fetch(url, {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        [CSRF_HEADER_NAME]: csrfToken,
      },
      body: JSON.stringify({
        ...updateRequest,
        firstName: "a".repeat(80),
        lastName: "b".repeat(80),
      }),
    });
    assert.equal(overlongName.status, 400);
    assert.equal(updates, 0);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("staff update rejects duplicate accounts and protects the final administrator", async () => {
  let queries = 0;
  const duplicateDatabase = createDatabase({
    onQuery: (sql) => {
      if (/UPDATE users/i.test(sql)) {
        queries += 1;
        throw Object.assign(new Error("duplicate username"), { code: "23505" });
      }
    },
  });

  await withStaffEndpoint("admin", duplicateDatabase, async (url) => {
    const response = await fetch(`${url}/${targetId}`, {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        [CSRF_HEADER_NAME]: csrfToken,
      },
      body: JSON.stringify(updateRequest),
    });
    assert.equal(response.status, 409);
    assert.equal(queries, 1);
  });

  const lastAdminDatabase = createDatabase({
    staff: currentStaff({ role: "admin" }),
    admins: 1,
  });
  await withStaffEndpoint("admin", lastAdminDatabase, async (url) => {
    const response = await fetch(`${url}/${targetId}`, {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        [CSRF_HEADER_NAME]: csrfToken,
      },
      body: JSON.stringify({ ...updateRequest, role: "doctor" }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      success: false,
      message: "The final administrator cannot be demoted.",
    });
  });
});

test("staff update returns not found for an unknown account", async () => {
  const database = createDatabase({ staff: null });
  await withStaffEndpoint("admin", database, async (url) => {
    const response = await fetch(`${url}/${targetId}`, {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        [CSRF_HEADER_NAME]: csrfToken,
      },
      body: JSON.stringify(updateRequest),
    });
    assert.equal(response.status, 404);
  });
});

test("staff update cannot turn a patient account into a staff account", async () => {
  const database = createDatabase({ staff: currentStaff({ role: "patient" as UserRole }) });
  await withStaffEndpoint("admin", database, async (url) => {
    const response = await fetch(`${url}/${targetId}`, {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        [CSRF_HEADER_NAME]: csrfToken,
      },
      body: JSON.stringify(updateRequest),
    });
    assert.equal(response.status, 404);
  });
});
