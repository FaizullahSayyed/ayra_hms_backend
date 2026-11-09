import assert from "node:assert/strict";
import test from "node:test";
import {
  hashOpaqueValue,
  PostgresSessionService,
  type SessionDatabase,
} from "../src/services/session.service.js";

test("JWT sessions persist only hashed tokens with the exact access-token expiration", async () => {
  const statements: { sql: string; values: (string | number)[] }[] = [];
  const database: SessionDatabase = {
    query: async (sql, values = []) => {
      statements.push({ sql, values });
      return { rows: [] };
    },
  };
  const sessions = new PostgresSessionService(database);
  const token = "signed.jwt.token";
  const csrfToken = "csrf-token";
  const expiresAt = new Date("2026-12-09T05:30:00.000Z");

  await sessions.recordAccessToken("user-id", token, csrfToken, expiresAt);

  assert.match(statements[0].sql, /INSERT INTO user_sessions/);
  assert.deepEqual(statements[0].values, [
    hashOpaqueValue(token),
    hashOpaqueValue(csrfToken),
    "user-id",
    expiresAt.toISOString(),
  ]);
  assert.equal(statements[0].values.includes(token), false);
  assert.equal(statements[0].values.includes(csrfToken), false);
});

test("session revocation supports a single session hash and every session for a user", async () => {
  const statements: { sql: string; values: (string | number)[] }[] = [];
  const sessions = new PostgresSessionService({
    query: async (sql, values = []) => {
      statements.push({ sql, values });
      return { rows: [] };
    },
  });

  await sessions.revokeHash("a".repeat(64));
  await sessions.revokeAllForUser("user-id");

  assert.match(statements[0].sql, /WHERE session_hash = \$1/);
  assert.deepEqual(statements[0].values, ["a".repeat(64)]);
  assert.match(statements[1].sql, /WHERE user_id = \$1/);
  assert.deepEqual(statements[1].values, ["user-id"]);
});
