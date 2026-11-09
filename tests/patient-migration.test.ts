import assert from "node:assert/strict";
import test from "node:test";
import { down, up } from "../src/migrations/1793580000000_create-patients-and-restrict-user-roles.js";
import {
  down as downPatientNames,
  up as upPatientNames,
} from "../src/migrations/1793590000000_add-patient-name-fields.js";

function createMigrationBuilder(hasPatients = false) {
  const calls: { method: string; args: unknown[] }[] = [];
  const pgm = {
    createTable: (...args: unknown[]) => calls.push({ method: "createTable", args }),
    addColumns: (...args: unknown[]) => calls.push({ method: "addColumns", args }),
    addConstraint: (...args: unknown[]) => calls.push({ method: "addConstraint", args }),
    dropConstraint: (...args: unknown[]) => calls.push({ method: "dropConstraint", args }),
    dropColumns: (...args: unknown[]) => calls.push({ method: "dropColumns", args }),
    dropTable: (...args: unknown[]) => calls.push({ method: "dropTable", args }),
    func: (value: string) => value,
    sql: (value: string) => calls.push({ method: "sql", args: [value] }),
    db: {
      query: async () => ({ rows: [{ has_patients: hasPatients }] }),
    },
  };
  return { calls, pgm };
}

test("patient migration creates a credential-free table and removes patient user roles", () => {
  const { calls, pgm } = createMigrationBuilder();
  up(pgm);

  const patientTable = calls.find((call) => call.method === "createTable");
  assert.ok(patientTable);
  assert.equal(patientTable.args[0], "patients");
  const columns = patientTable.args[1] as Record<string, unknown>;
  assert.deepEqual(Object.keys(columns), [
    "id",
    "name",
    "phone",
    "gender",
    "created_at",
    "updated_at",
  ]);
  assert.ok(calls.some((call) =>
    call.method === "sql"
    && String(call.args[0]).includes("INSERT INTO patients")
    && String(call.args[0]).includes("WHERE role = 'patient'")
  ));
  assert.ok(calls.some((call) =>
    call.method === "sql" && String(call.args[0]).includes("DELETE FROM users WHERE role = 'patient'")
  ));
  assert.ok(calls.some((call) =>
    call.method === "addConstraint"
    && call.args[0] === "users"
    && JSON.stringify(call.args[2]).includes("'admin', 'doctor', 'nurse', 'biller', 'receptionist'")
  ));
});

test("patient migration refuses rollback if it would discard patient records", async () => {
  const { calls, pgm } = createMigrationBuilder(true);
  await assert.rejects(down(pgm), /Cannot roll back patient data/);
  assert.equal(calls.some((call) => call.method === "dropTable"), false);
});

test("patient migration can roll back when the patient table is empty", async () => {
  const { calls, pgm } = createMigrationBuilder();
  await down(pgm);
  assert.ok(calls.some((call) => call.method === "dropTable" && call.args[0] === "patients"));
});

test("patient name migration adds frontend profile fields without adding account credentials", () => {
  const { calls, pgm } = createMigrationBuilder();
  upPatientNames(pgm);

  const addedColumns = calls.find((call) => call.method === "addColumns");
  assert.ok(addedColumns);
  assert.equal(addedColumns.args[0], "patients");
  assert.deepEqual(Object.keys(addedColumns.args[1] as Record<string, unknown>), [
    "first_name",
    "last_name",
  ]);
  assert.ok(calls.some((call) =>
    call.method === "sql"
    && String(call.args[0]).includes("UPDATE patients AS patient")
    && String(call.args[0]).includes("normalized_name")
  ));
  assert.equal(
    calls.some((call) => JSON.stringify(call.args).match(/username|email|password/i) !== null),
    false,
  );
});

test("patient name migration rolls back only its added columns and constraints", () => {
  const { calls, pgm } = createMigrationBuilder();
  downPatientNames(pgm);

  assert.ok(calls.some((call) =>
    call.method === "dropColumns"
    && JSON.stringify(call.args) === JSON.stringify(["patients", ["first_name", "last_name"]])
  ));
  assert.equal(calls.some((call) => call.method === "dropTable"), false);
});
