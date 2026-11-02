import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import type { ErrorRequestHandler } from "express";
import { env } from "./config/env.js";
import { pool } from "./config/database.js";
import authRoutes from "./routes/auth.route.js";

const app: Express = express();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
    exposedHeaders: ["X-CSRF-Token"],
  })
);

// Request body parsing
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));

// Health check
app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Ayra Hospital API is running",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/v1/health/database", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      success: true,
      message: "Database connection is healthy",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(503).json({
      success: false,
      message: "Database connection unavailable",
    });
  }
});

app.use("/api/v1/auth", authRoutes);

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (typeof error === "object" && error !== null && "type" in error) {
    if (error.type === "entity.parse.failed") {
      response.status(400).json({
        success: false,
        message: "Request body must contain valid JSON.",
      });
      return;
    }
    if (error.type === "entity.too.large") {
      response.status(413).json({
        success: false,
        message: "Request body exceeds the allowed size.",
      });
      return;
    }
  }

  console.error("Unhandled request error.");
  response.status(500).json({
    success: false,
    message: "An unexpected server error occurred.",
  });
};

app.use(errorHandler);

export default app;