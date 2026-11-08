import assert from "node:assert/strict";
import test from "node:test";
import { removeConnectionStringSslOptions } from "../src/config/database-url.js";

test("removes URL SSL options so the configured CA is used", () => {
  const connectionString = removeConnectionStringSslOptions(
    "postgres://user:password@db.example.test:5432/ayra?ssl=1&sslmode=require&sslrootcert=%2Ftmp%2Fca.pem&application_name=ayra-api",
  );
  const databaseUrl = new URL(connectionString);

  assert.equal(databaseUrl.searchParams.has("ssl"), false);
  assert.equal(databaseUrl.searchParams.has("sslmode"), false);
  assert.equal(databaseUrl.searchParams.has("sslrootcert"), false);
  assert.equal(databaseUrl.searchParams.get("application_name"), "ayra-api");
  assert.equal(databaseUrl.username, "user");
  assert.equal(databaseUrl.password, "password");
});
