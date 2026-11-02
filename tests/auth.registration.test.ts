import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { comparePassword } from "../src/utils/password.js";
import {
  createRegisterHandler,
  type RegistrationDatabase,
} from "../src/controllers/auth.controller.js";
import { createAuthRouter } from "../src/routes/auth.route.js";
import { USER_ROLES } from "../src/types/auth.js";
import { registerSchema } from "../src/validators/auth.validator.js";

const requestBody = {
  name: "  Aanya Patel  ",
  email: " Aanya@Example.Test ",
  password: "a secure password",
  role: "patient",
};

interface ApiResponse {
  success: boolean;
  message: string;
  code?: string;
  errors?: Record<string, string[]>;
  user?: {
    id: string;
    name: string;
    email: string;
    role: string;
    created_at: string;
  };
}

async function withRegistrationEndpoint<T>(
  handler: RequestHandler,
  run: (url: string) => Promise<T>,
): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", createAuthRouter({ registerHandler: handler }));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  try {
    return await run(`http://127.0.0.1:${address.port}/api/v1/auth/register`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function postRegistration(url: string, body: unknown): Promise<{
  status: number;
  body: ApiResponse;
}> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as ApiResponse,
  };
}

function createSuccessfulDatabase(
  onQuery: (values: [string, string, string, (typeof USER_ROLES)[number]]) => void,
): RegistrationDatabase {
  return {
    query: async (_sql, values) => {
      onQuery(values);
      return {
        rows: [{
          id: "user-123",
          name: values[0],
          email: values[1],
          role: values[3],
          created_at: "2026-11-01T00:00:00.000Z",
        }],
      };
    },
  };
}

test("registration schema accepts every supported role", () => {
  const expectedRoles = [
    "patient",
    "biller",
    "receptionist",
    "nurse",
    "doctor",
    "admin",
  ] as const;
  assert.deepEqual(USER_ROLES, expectedRoles);

  for (const role of expectedRoles) {
    const result = registerSchema.safeParse({ ...requestBody, role });
    assert.equal(result.success, true, `Expected ${role} to be an allowed role.`);
  }
});

test("patient registration persists and returns the normalized patient role", async () => {
  let insertedValues: [string, string, string, (typeof USER_ROLES)[number]] | undefined;
  const database = createSuccessfulDatabase((values) => {
    insertedValues = values;
  });

  await withRegistrationEndpoint(createRegisterHandler(database), async (url) => {
    const response = await postRegistration(url, requestBody);

    assert.equal(response.status, 201);
    assert.equal(response.body.success, true);
    assert.equal(response.body.message, "Patient registered successfully");
    assert.deepEqual(
      {
        id: response.body.user?.id,
        name: response.body.user?.name,
        email: response.body.user?.email,
        role: response.body.user?.role,
      },
      {
        id: "user-123",
        name: "Aanya Patel",
        email: "aanya@example.test",
        role: "patient",
      },
    );
    assert.equal(insertedValues?.[0], "Aanya Patel");
    assert.equal(insertedValues?.[1], "aanya@example.test");
    assert.equal(insertedValues?.[3], "patient");
    assert.ok(insertedValues?.[2]);
    assert.notEqual(insertedValues?.[2], requestBody.password);
    assert.equal(await comparePassword(requestBody.password, insertedValues![2]), true);
    assert.equal("password_hash" in (response.body.user ?? {}), false);
  });
});

test("unknown roles return a consistent validation error", async () => {
  let databaseCalled = false;
  const database: RegistrationDatabase = {
    query: async () => {
      databaseCalled = true;
      return { rows: [] };
    },
  };

  await withRegistrationEndpoint(createRegisterHandler(database), async (url) => {
    const response = await postRegistration(url, { ...requestBody, role: "superuser" });
    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.message, "Validation failed");
    assert.ok(response.body.errors?.role);
    assert.equal(databaseCalled, false);
  });
});

test("all staff roles are forbidden for public self-registration", async () => {
  let databaseCalled = false;
  let passwordHashCalled = false;
  const database: RegistrationDatabase = {
    query: async () => {
      databaseCalled = true;
      return { rows: [] };
    },
  };
  const handler = createRegisterHandler(database, async () => {
    passwordHashCalled = true;
    return "unused";
  });

  await withRegistrationEndpoint(handler, async (url) => {
    for (const role of USER_ROLES.filter((candidate) => candidate !== "patient")) {
      const response = await postRegistration(url, { ...requestBody, role });
      assert.equal(response.status, 403, `${role} should not be self-registered.`);
      assert.equal(response.body.code, "STAFF_REGISTRATION_UNAVAILABLE");
    }
    assert.equal(databaseCalled, false);
    assert.equal(passwordHashCalled, false);
  });
});

test("invalid fields return validation errors", async () => {
  await withRegistrationEndpoint(
    createRegisterHandler({
      query: async () => ({ rows: [] }),
    }),
    async (url) => {
      const response = await postRegistration(url, {
        ...requestBody,
        name: " ",
        email: "not-an-email",
        password: "short",
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.message, "Validation failed");
      assert.ok(response.body.errors?.name);
      assert.ok(response.body.errors?.email);
      assert.ok(response.body.errors?.password);
    },
  );
});

test("duplicate email returns conflict without success-shaped data", async () => {
  const database: RegistrationDatabase = {
    query: async () => {
      throw Object.assign(new Error("duplicate email"), { code: "23505" });
    },
  };

  await withRegistrationEndpoint(createRegisterHandler(database), async (url) => {
    const response = await postRegistration(url, requestBody);
    assert.equal(response.status, 409);
    assert.equal(response.body.success, false);
    assert.equal(response.body.message, "Email is already registered");
    assert.equal(response.body.user, undefined);
  });
});

test("database failures return an explicit server error", async () => {
  const database: RegistrationDatabase = {
    query: async () => {
      throw new Error("database unavailable");
    },
  };

  await withRegistrationEndpoint(createRegisterHandler(database), async (url) => {
    const response = await postRegistration(url, requestBody);
    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
    assert.equal(response.body.message, "Unable to register patient");
    assert.equal(response.body.user, undefined);
  });
});
