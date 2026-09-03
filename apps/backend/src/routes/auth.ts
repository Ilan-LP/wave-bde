import { Router, type Router as ExpressRouter } from "express";
import type { Member, User } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { verifyPassword } from "../lib/password.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from "../lib/jwt.js";

export const authRouter: ExpressRouter = Router();

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

function issueTokenPair(user: Pick<User, "id">, member: Pick<Member, "id" | "role" | "poleId">) {
  const accessToken = signAccessToken({
    sub: user.id,
    memberId: member.id,
    role: member.role,
    poleId: member.poleId,
  });
  const { token: refreshToken, tokenHash } = signRefreshToken(user.id);
  return { accessToken, refreshToken, tokenHash };
}

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { member: true },
  });

  const invalidCredentials = () => res.status(401).json({ error: "invalid credentials" });

  if (!user || !user.isActive || !user.passwordHash || !user.member || !user.member.isActive) {
    invalidCredentials();
    return;
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    invalidCredentials();
    return;
  }

  const { accessToken, refreshToken, tokenHash } = issueTokenPair(user, user.member);
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  res.json({
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.member.role,
      poleId: user.member.poleId,
    },
  });
});

authRouter.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: unknown };
  if (typeof refreshToken !== "string") {
    res.status(400).json({ error: "refreshToken is required" });
    return;
  }

  try {
    verifyRefreshToken(refreshToken);
  } catch {
    res.status(401).json({ error: "invalid refresh token" });
    return;
  }

  const tokenHash = hashRefreshToken(refreshToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { include: { member: true } } },
  });

  if (!existing) {
    res.status(401).json({ error: "invalid refresh token" });
    return;
  }

  if (existing.revokedAt) {
    // Reuse of an already-rotated/revoked token: treat as theft and kill
    // every active session for this user.
    await prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.status(401).json({ error: "invalid refresh token" });
    return;
  }

  const { user } = existing;
  if (!user.isActive || !user.member || !user.member.isActive) {
    res.status(401).json({ error: "invalid refresh token" });
    return;
  }

  const { accessToken, refreshToken: newRefreshToken, tokenHash: newTokenHash } = issueTokenPair(
    user,
    user.member,
  );

  await prisma.$transaction(async (tx) => {
    const created = await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newTokenHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedByTokenId: created.id },
    });
  });

  res.json({
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.member.role,
      poleId: user.member.poleId,
    },
  });
});

authRouter.post("/logout", async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: unknown };
  if (typeof refreshToken !== "string") {
    res.status(400).json({ error: "refreshToken is required" });
    return;
  }

  const tokenHash = hashRefreshToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  res.status(204).send();
});
