import "dotenv/config";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const app = express();
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";

app.use(cors({ origin: frontendOrigin }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ data: { status: "ok" } });
});

app.use((_request, response) => {
  response.status(404).json({
    error: { code: "NOT_FOUND", message: "The requested endpoint was not found." },
  });
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (
    error instanceof SyntaxError
    && typeof error === "object"
    && error !== null
    && "type" in error
    && error.type === "entity.parse.failed"
  ) {
    response.status(400).json({
      error: { code: "INVALID_JSON", message: "The request body must contain valid JSON." },
    });
    return;
  }

  console.error("Unhandled server error:", error);
  response.status(500).json({
    error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected server error occurred." },
  });
};

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Ayra Hospital API listening on port ${port}`);
});
