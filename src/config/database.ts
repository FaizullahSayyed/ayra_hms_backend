import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { env } from "./env.js";

const caCertificate = readFileSync(
  "certs/ca.pem",
  "utf8"
);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,

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