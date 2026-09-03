import type { RequestHandler } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const EXCLUDED_PATH_PREFIXES = ["/auth", "/health"];

const REDACTED_KEYS = new Set([
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "tokenHash",
]);

const REDACTED_PLACEHOLDER = "[REDACTED]";

function redact(value: unknown): Prisma.InputJsonValue | undefined {
  if (Array.isArray(value)) {
    return value.map(redact) as Prisma.InputJsonValue;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        REDACTED_KEYS.has(key) ? REDACTED_PLACEHOLDER : redact(val),
      ]),
    ) as Prisma.InputJsonValue;
  }
  return value as Prisma.InputJsonValue | undefined;
}

function methodToAction(method: string): string {
  switch (method) {
    case "POST":
      return "CREATE";
    case "PUT":
    case "PATCH":
      return "UPDATE";
    case "DELETE":
      return "DELETE";
    default:
      return method;
  }
}

function inferEntityType(path: string): string {
  const [firstSegment = ""] = path.split("/").filter(Boolean);
  const pascal = firstSegment
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  if (!pascal) {
    return "Unknown";
  }
  return pascal.endsWith("s") ? pascal.slice(0, -1) : pascal;
}

/**
 * Logs every mutating (POST/PUT/PATCH/DELETE) request automatically, once
 * the response has finished, without route handlers calling anything.
 * Skips /auth and /health (see CLAUDE.md "Audit Logging") and only logs
 * responses that actually succeeded (statusCode < 400).
 *
 * A handler can opt out of inference without opting out of logging via
 * `res.locals.auditEntityType` / `res.locals.auditEntityId`, or skip audit
 * logging entirely for one route via `res.locals.skipAudit = true`.
 */
export const auditLog: RequestHandler = (req, res, next) => {
  if (!MUTATING_METHODS.has(req.method) || EXCLUDED_PATH_PREFIXES.some((p) => req.path.startsWith(p))) {
    next();
    return;
  }

  let responseBody: unknown;
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    responseBody = body;
    return originalJson(body);
  }) as typeof res.json;

  res.on("finish", () => {
    if (res.locals.skipAudit) {
      return;
    }
    if (res.statusCode >= 400) {
      return;
    }

    const entityType = (res.locals.auditEntityType as string | undefined) ?? inferEntityType(req.path);
    let entityId = res.locals.auditEntityId as string | undefined;
    entityId ??= req.params.id;
    entityId ??= (responseBody as { id?: string } | undefined)?.id;
    if (!entityId) {
      console.warn(`[audit] could not determine entityId for ${req.method} ${req.path}; using "unknown"`);
      entityId = "unknown";
    }

    prisma.auditLog
      .create({
        data: {
          actorId: req.auth?.sub ?? null,
          action: methodToAction(req.method),
          entityType,
          entityId,
          ipAddress: req.ip ?? null,
          metadata: {
            method: req.method,
            path: req.path,
            role: req.auth?.role ?? null,
            requestBody: redact(req.body),
            responseBody: redact(responseBody),
          },
        },
      })
      .catch((err: unknown) => {
        console.error(`[audit] failed to write audit log for ${req.method} ${req.path}`, err);
      });
  });

  next();
};
