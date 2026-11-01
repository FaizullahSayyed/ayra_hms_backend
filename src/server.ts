import express, { type Express } from "express";

const app: Express = express();

const PORT: number = Number(process.env.PORT) || 3001;

// Middleware
app.use(express.json());

// Routes
app.get("/", (_req, res) => {
  res.status(200).send("Express server is running 🚀");
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});