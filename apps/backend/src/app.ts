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

  // Secondary login guard, keyed on the normalized submitted email rather
  // than IP (same window/limit as loginRateLimit, applied in addition to
  // it) — a distributed attempt against one known email from many IPs would
  // otherwise never trip the per-IP limiter above. Falls back to
  // ipKeyGenerator (not raw req.ip) when the body's email is missing/not a
  // string, same pattern as buvetteQrReplayRateLimit.
  const loginEmailRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = (req.body as { email?: unknown } | undefined)?.email;
      return typeof email === "string" && email
        ? `email:${email.trim().toLowerCase()}`
        : ipKeyGenerator(req.ip!);
    },
    message: { error: "too many login attempts, try again later" },
  });

  // Guards against account-creation spam/abuse — registration is open to
  // anyone (no school-email or invite restriction, see CLAUDE.md
  // "Authentication"), so this is the only real throttle on bulk sign-ups.
  const registerRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many registration attempts, try again later" },
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

  // General throttle on the buvette cash-sale endpoint, same shape as
  // buvetteScanRateLimit above — cash, like scan, is a single synchronous
  // request per sale, unlike card's polling-driven higher limit.
  const buvetteCashRateLimit = rateLimit({
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

  // Throttles the self-service recharge *create* call only, per-IP like the
  // buvette limiters above — a live SumUp call sits behind it, so a runaway
  // client shouldn't be free to hammer it. Split from the confirm-poll
  // endpoint below (see rechargeConfirmRateLimit) — the two used to share
  // this one bucket, but confirm alone can burn through it in well under a
  // minute while a payment is in flight.
  const rechargeRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many requests, try again shortly" },
  });

  // Confirm is polled every ~3s while a payment is in flight, for up to the
  // 30-minute checkout validity window — a single legitimate recharge can
  // exhaust rechargeRateLimit's 20/min on its own, and on a shared IP
  // (school WiFi/NAT) that would 429 someone else's concurrent recharge
  // too. Given its own, higher bucket instead — same precedent as
  // buvetteCardRateLimit being split out from the general buvette limiter
  // for the same "polling burns the budget" reason.
  const rechargeConfirmRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many requests, try again shortly" },
  });

  // Light per-IP throttle on the two self-service read routes that
  // otherwise had none (unlike every other route family) — GET /me/balance,
  // GET /me/qrcode. Doesn't cover /me/recharge, which already has its own
  // rechargeRateLimit.
  const meReadRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many requests, try again shortly" },
  });

  // Covers reader listing/pairing and the whole card-checkout lifecycle
  // (create/confirm/cancel), per-IP like the limiters above. Higher than
  // rechargeRateLimit since the cashier UI polls confirm roughly every 2s
  // while a card checkout is in flight (~30 calls/min from that alone).
  const buvetteCardRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many requests, try again shortly" },
  });

  // Modest per-IP limiter on the product catalog/management routes,
  // matching the convention used for every other mutating route family
  // (POST /products, PATCH /products/:id, PATCH /products/:id/active
  // previously had none, relying only on requireRole("BUREAU") and the
  // global body-size cap). Mounted on the whole /products prefix, so it
  // also covers the two GET routes — same as buvetteCardRateLimit covering
  // GET /buvette/readers alongside its mutating routes.
  const productsRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
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

  app.use("/auth/login", loginRateLimit, loginEmailRateLimit);
  app.use("/auth/register", registerRateLimit);
  app.use(["/auth/refresh", "/auth/logout"], refreshLogoutRateLimit);
  app.use("/auth", authRouter);
  // Exact-route mounts (not app.use prefix-matching) so each endpoint gets
  // exactly one of the two buckets above, never both.
  app.post("/me/recharge", rechargeRateLimit);
  app.post("/me/recharge/:id/confirm", rechargeConfirmRateLimit);
  app.use(["/me/balance", "/me/qrcode"], meReadRateLimit);
  app.use("/me", meRouter);
  app.use("/products", productsRateLimit, productsRouter);
  app.use("/buvette/scan", buvetteScanRateLimit, buvetteQrReplayRateLimit);
  app.use("/buvette/cash", buvetteCashRateLimit);
  app.use(["/buvette/card", "/buvette/readers"], buvetteCardRateLimit);
  app.use("/buvette", buvetteRouter);

  app.use(errorHandler);

  return app;
}
