import "./config/env.js";
import express, { type Express, type ErrorRequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.js";
import { meRouter } from "./routes/me.js";
import { productsRouter } from "./routes/products.js";
import { buvetteRouter } from "./routes/buvette.js";
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

  // Trust exactly one hop: the shared edge Caddy instance this backend sits
  // behind in production. Needed for rate-limiting and audit-log IPs to see
  // the real client IP (req.ip) instead of the proxy's. Do not raise this
  // past 1 without also confirming the real proxy chain in front of it —
  // see CLAUDE.md's Deployment section.
  app.set("trust proxy", 1);

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

  // General throttle on the buvette scan endpoint (per-IP, same as the two
  // limiters above) — guards against a runaway till client or a compromised
  // operator session hammering the endpoint.
  const buvetteScanRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many requests, try again shortly" },
  });

  // Anti-fraud replay guard: the exact same scanned QR value can only be
  // attempted once per 3 seconds, keyed on the request body rather than the
  // caller's IP. Falls back to ipKeyGenerator (not raw req.ip) when the body
  // is missing/malformed, per express-rate-limit's own guidance for a custom
  // keyGenerator that falls back to IP.
  const buvetteQrReplayRateLimit = rateLimit({
    windowMs: 3 * 1000,
    limit: 1,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const qrPayload = (req.body as { qrPayload?: unknown } | undefined)?.qrPayload;
      return typeof qrPayload === "string" && qrPayload ? `qr:${qrPayload}` : ipKeyGenerator(req.ip!);
    },
    message: { error: "duplicate scan, please rescan" },
  });

  // Throttles self-service recharge attempts (create + confirm), per-IP
  // like the buvette limiters above — a live SumUp call sits behind both
  // routes, so a runaway client shouldn't be free to hammer it.
  const rechargeRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many requests, try again shortly" },
  });

  app.use(helmet());
  // No credentials/cookies needed — auth is Bearer-token only.
  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json({ limit: "100kb" }));
  app.use(auditLog);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth/login", loginRateLimit);
  app.use(["/auth/refresh", "/auth/logout"], refreshLogoutRateLimit);
  app.use("/auth", authRouter);
  // Prefix match: also covers /me/recharge/:id/confirm.
  app.use("/me/recharge", rechargeRateLimit);
  app.use("/me", meRouter);
  app.use("/products", productsRouter);
  app.use("/buvette/scan", buvetteScanRateLimit, buvetteQrReplayRateLimit);
  app.use("/buvette", buvetteRouter);

  app.use(errorHandler);

  return app;
}
