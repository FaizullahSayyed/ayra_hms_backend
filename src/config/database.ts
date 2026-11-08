import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";
import { removeConnectionStringSslOptions } from "./database-url.js";

const caCertificatePath = fileURLToPath(
  new URL("../../certs/ca.pem", import.meta.url),
);
const caCertificate = readFileSync(caCertificatePath, "utf8");

export const pool = new Pool({
  // URL-level SSL options override this CA configuration in node-postgres.
  connectionString: removeConnectionStringSslOptions(env.DATABASE_URL),

  ssl: {
    ca: caCertificate,
    rejectUnauthorized: true,
  },

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (error) => {
  console.error("PostgreSQL pool error:", error);
});

export const connectDatabase = async (): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query("SELECT 1");
    console.log("Aiven PostgreSQL connected successfully");
  } finally {
    client.release();
  }
};