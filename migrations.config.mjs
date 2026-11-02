import "dotenv/config";
import { readFileSync } from "node:fs";

export default {
  "database-url-var": {
    connectionString: process.env.DATABASE_URL,

    ssl: {
      ca: readFileSync("certs/ca.pem", "utf8"),
      rejectUnauthorized: true,
    },
  },

  "migrations-dir": "src/migrations",
  "migrations-table": "pgmigrations",
  "check-order": true,
};