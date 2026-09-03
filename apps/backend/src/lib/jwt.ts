import { randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type { MemberRole } from "@prisma/client";
import { env } from "../config/env.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "30d";
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AccessTokenPayload {
  sub: string;
  memberId: string;
  role: MemberRole;
  poleId: string | null;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

/**
 * Refresh tokens are signed JWTs (so JWT_REFRESH_SECRET is actually used, and
 * expiry/tampering are rejected before a DB lookup happens), but the JWT
 * itself is never trusted as sufficient proof of validity: only its SHA-256
 * hash, looked up against `RefreshToken.tokenHash`, tells us whether it has
 * been rotated away or revoked.
 */
export function signRefreshToken(userId: string): { token: string; tokenHash: string } {
  const jti = randomBytes(32).toString("hex");
  const token = jwt.sign({ sub: userId, jti } satisfies RefreshTokenPayload, env.jwtRefreshSecret, {
    expiresIn: REFRESH_TOKEN_TTL,
  });
  return { token, tokenHash: hashRefreshToken(token) };
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.jwtRefreshSecret) as RefreshTokenPayload;
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
