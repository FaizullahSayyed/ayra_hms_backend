import "dotenv/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import app from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase, pool } from "./config/database.js";

export async function startServer(): Promise<void> {
  try {
    await connectDatabase();

    const server = app.listen(env.PORT, () => {
      console.log(`Ayra Hospital API running on port ${env.PORT}`);
    });

    const shutdown = (signal: string): void => {
      console.log(`${signal} received. Shutting down...`);

      server.close(async () => {
        await pool.end();
        console.log("Server and database connections closed.");
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    console.error("Failed to start application:", error);
    await pool.end();
    process.exit(1);
  }
}

export default app;

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  void startServer();
}
