import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import apiHandler from "../api/index.js";
import app from "../src/app.js";
import serverEntryApp from "../src/index.js";

test("Vercel function exports the Express app without starting a local listener", () => {
  assert.equal(serverEntryApp, app);
  assert.equal(apiHandler, app);
});

test("Vercel function serves the backend health endpoint", async () => {
  const server = createServer(apiHandler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`);
    assert.equal(response.status, 200);
    const body = await response.json() as { success: boolean; message: string };
    assert.equal(body.success, true);
  } finally {
    server.close();
    await once(server, "close");
  }
});
