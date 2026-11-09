import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createAuthRouter } from "../src/routes/auth.route.js";

async function withRegistrationEndpoint<T>(run: (url: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", createAuthRouter());
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

async function postRegistration(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "patient", password: "unused" }),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

test("patient registration is explicitly deferred without creating an account", async () => {
  await withRegistrationEndpoint(async (url) => {
    const response = await postRegistration(url);
    assert.equal(response.status, 501);
    assert.deepEqual(response.body, {
      success: false,
      code: "PATIENT_REGISTRATION_DEFERRED",
      message: "Patient registration is not available yet.",
    });
  });
});
