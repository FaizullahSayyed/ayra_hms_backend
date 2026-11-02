import "dotenv/config";
import app from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase, pool } from "./config/database.js";

const startServer = async (): Promise<void> => {
  try {
    // Connect to PostgreSQL
    await connectDatabase();

    // Start Express server
    const server = app.listen(env.PORT, () => {
      console.log(`Ayra Hospital API running on port ${env.PORT}`);
    });

    // Graceful shutdown
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
};

void startServer();