import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createAdminPatientsHandler } from "../src/controllers/admin-patients.controller.js";
import { createAdminRouter } from "../src/routes/admin.route.js";
import type { UserRole } from "../src/types/auth.js";
import { AUTH_COOKIE_NAME } from "../src/middlewares/session.middleware.js";
import { generateAccessToken } from "../src/utils/jwt.js";

const allowedOrigin = "https://frontend.example.test";
const csrfToken = "C".repeat(43);

async function withPatientsEndpoint<T>(
  role: UserRole | null,
  run: (url: string, token: string, getPatientQuery: () => string) => Promise<T>,
): Promise<T> {
  const app = express();
  let patientQuery = "";
  app.use("/api/v1/admin", createAdminRouter({
    authenticationDatabase: {
      query: async () => ({
        rows: role
          ? [{ id: "actor-123", name: "Hospital Admin", email: "admin@example.test", role }]
          : [],
      }),
    },
    allowedOrigins: [allowedOrigin],
    listPatientsHandler: createAdminPatientsHandler({
      query: async (sql) => {
        patientQuery = sql;
        return {
          rows: [{
            id: "patient-123",
            name: "Mira Shah",
            phone: "+1 555 0100",
            gender: "female",
            created_at: new Date("2026-11-08T08:30:00.000Z"),
          }],
        };
      },
    }),
  }));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  try {
    const token = generateAccessToken({
      userId: "actor-123",
      role: "admin",
      csrfToken,
    });
    return await run(`http://127.0.0.1:${address.port}/api/v1/admin/patients`, token, () => patientQuery);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("admin can list patients from the patient table without auth fields", async () => {
  await withPatientsEndpoint("admin", async (url, token, getPatientQuery) => {
    const response = await fetch(url, {
      headers: {
        Origin: allowedOrigin,
        Cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
    });
    const body = await response.json() as {
      success: boolean;
      patients: {
        id: string;
        name: string;
        phone: string | null;
        gender: string | null;
        createdAt: string;
      }[];
    };

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      success: true,
      patients: [{
        id: "patient-123",
        name: "Mira Shah",
        phone: "+1 555 0100",
        gender: "female",
        createdAt: "2026-11-08T08:30:00.000Z",
      }],
    });
    assert.match(getPatientQuery(), /FROM patients/);
    assert.doesNotMatch(getPatientQuery(), /FROM users|email|password|username/i);
  });
});

test("patient account list is restricted to authenticated administrators", async () => {
  await withPatientsEndpoint("doctor", async (url, token) => {
    const response = await fetch(url, {
      headers: {
        Origin: allowedOrigin,
        Cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
    });
    assert.equal(response.status, 403);
  });

  await withPatientsEndpoint(null, async (url) => {
    const response = await fetch(url, { headers: { Origin: allowedOrigin } });
    assert.equal(response.status, 401);
  });
});
