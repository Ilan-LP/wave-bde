import "./config/env.js";
import express, { type Express, type ErrorRequestHandler } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { authRouter } from "./routes/auth.js";
import { auditLog } from "./middleware/index.js";

function clientErrorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown; statusCode?: unknown } | undefined)?.status;
  const statusCode = (err as { statusCode?: unknown } | undefined)?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return status;
  }
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    return statusCode;
  }
  return undefined;
}

// Generic error handler: never leak stack traces or error messages to the
// client, regardless of NODE_ENV (Express's default handler does in
// non-production). It does still forward a genuine 4xx status (e.g. a
// malformed-JSON body from express.json(), or a too-large body once it
// exceeds the limit below) instead of always answering 500 — otherwise a
// client mistake gets reported as a server failure.
// Express only recognizes error-handling middleware by its 4-argument arity.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  const status = clientErrorStatus(err);
  if (status !== undefined) {
    res.status(status).json({ error: "bad request" });
    return;
  }
  res.status(500).json({ error: "internal server error" });
};

export function createApp(): Express {
  const app = express();

  const loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many login attempts, try again later" },
  });

  // Looser than login's: these endpoints aren't password-guessing targets
  // (refresh tokens are unguessable, signed JWTs), but each call still does
  // at least one DB round trip, so an explicit cap is cheap insurance.
  const refreshLogoutRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many requests, try again later" },
  });

  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
  app.use(auditLog);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth/login", loginRateLimit);
  app.use(["/auth/refresh", "/auth/logout"], refreshLogoutRateLimit);
  app.use("/auth", authRouter);

  app.use(errorHandler);

  return app;
}
