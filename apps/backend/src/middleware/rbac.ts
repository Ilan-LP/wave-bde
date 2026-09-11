import type { RequestHandler } from "express";
import type { MemberRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export function requireRole(...roles: MemberRole[]): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (req.auth.role === "BUREAU" || (req.auth.role !== null && roles.includes(req.auth.role))) {
      next();
      return;
    }
    res.status(403).json({ error: "forbidden" });
  };
}

export function requirePoleAccess(): RequestHandler {
  return async (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (req.auth.role === "BUREAU") {
      next();
      return;
    }
    const targetPoleId = req.params.poleId;
    if (!targetPoleId) {
      res.status(400).json({ error: "poleId route param required" });
      return;
    }
    if (req.auth.poleId === targetPoleId) {
      next();
      return;
    }
    if (!req.auth.memberId) {
      // No Member at all (a self-registered, no-role account) — there's no
      // PoleAccessGrant to look up.
      res.status(403).json({ error: "forbidden" });
      return;
    }
    try {
      const grant = await prisma.poleAccessGrant.findUnique({
        where: { memberId_poleId: { memberId: req.auth.memberId, poleId: targetPoleId } },
      });
      if (grant && (!grant.expiresAt || grant.expiresAt > new Date())) {
        next();
        return;
      }
    } catch (err) {
      next(err);
      return;
    }
    res.status(403).json({ error: "forbidden" });
  };
}
