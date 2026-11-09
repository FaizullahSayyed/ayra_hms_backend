import assert from "node:assert/strict";
import test from "node:test";
import { down, up } from "../src/migrations/1793600000000_add-admin-audit-events.js";

test("admin audit migration stores change metadata without account credentials", () => {
  const calls: { method: string; args: unknown[] }[] = [];
  const pgm = {
    createTable: (...args: unknown[]) => calls.push({ method: "createTable", args }),
    addConstraint: (...args: unknown[]) => calls.push({ method: "addConstraint", args }),
    createIndex: (...args: unknown[]) => calls.push({ method: "createIndex", args }),
    dropTable: (...args: unknown[]) => calls.push({ method: "dropTable", args }),
    func: (value: string) => value,
  };
  up(pgm);

  const table = calls.find((call) => call.method === "createTable");
  assert.ok(table);
  assert.equal(table.args[0], "admin_audit_events");
  const columns = table.args[1] as Record<string, unknown>;
  assert.deepEqual(Object.keys(columns), [
    "id",
    "actor_user_id",
    "target_user_id",
    "event_type",
    "changed_fields",
    "password_changed",
    "created_at",
  ]);
  assert.equal(calls.some((call) =>
    JSON.stringify(call.args).match(/password_hash|session|device/i) !== null
  ), false);
  assert.ok(calls.some((call) => call.method === "createIndex"));

  down(pgm);
  assert.ok(calls.some((call) => call.method === "dropTable" && call.args[0] === "admin_audit_events"));
});
