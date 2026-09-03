import "./config/env.js";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { authRouter } from "./routes/auth.js";
import { auditLog } from "./middleware/index.js";
import { prisma } from "./lib/prisma.js";

const app = express();
const port = process.env.PORT ?? 3000;

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many login attempts, try again later" },
});

app.use(helmet());
app.use(express.json());
app.use(auditLog);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth/login", loginRateLimit);
app.use("/auth", authRouter);

// Generic error handler: never leak stack traces to the client, regardless
// of NODE_ENV (Express's default handler does in non-production).
// Express only recognizes error-handling middleware by its 4-argument arity.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
};
app.use(errorHandler);

const server = app.listen(port, () => {
  console.log(`Wave backend listening on port ${port}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    prisma
      .$disconnect()
      .catch((err: unknown) => console.error("error disconnecting prisma", err))
      .finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
