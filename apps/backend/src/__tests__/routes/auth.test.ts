import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { authRouter } from "../../routes/auth.js";
import { prisma } from "../../lib/prisma.js";
import { verifyPassword, verifyDummyPassword } from "../../lib/password.js";
import { signRefreshToken, hashRefreshToken } from "../../lib/jwt.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../lib/password.js", () => ({
  verifyPassword: vi.fn(),
  verifyDummyPassword: vi.fn(),
}));

const userFindUnique = vi.mocked(prisma.user.findUnique);
const refreshTokenCreate = vi.mocked(prisma.refreshToken.create);
const refreshTokenFindUnique = vi.mocked(prisma.refreshToken.findUnique);
const refreshTokenUpdateMany = vi.mocked(prisma.refreshToken.updateMany);
const transaction = vi.mocked(prisma.$transaction);
const verifyPasswordMock = vi.mocked(verifyPassword);
const verifyDummyPasswordMock = vi.mocked(verifyDummyPassword);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRouter);
  return app;
}

const member = { id: "member-1", role: "MEMBRE_POLE" as const, poleId: "pole-1", isActive: true };
const user = {
  id: "user-1",
  email: "a@example.com",
  firstName: "A",
  lastName: "B",
  isActive: true,
  passwordHash: "hashed",
  member,
};

describe("POST /auth/login", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("still runs the dummy password check when the user does not exist (timing normalization)", async () => {
    userFindUnique.mockResolvedValue(null);

    const res = await supertest(makeApp())
      .post("/auth/login")
      .send({ email: "nobody@example.com", password: "whatever" });

    expect(res.status).toBe(401);
    expect(verifyDummyPasswordMock).toHaveBeenCalledWith("whatever");
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it("still runs the dummy password check when the member is inactive", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userFindUnique.mockResolvedValue({ ...user, member: { ...member, isActive: false } } as any);

    const res = await supertest(makeApp())
      .post("/auth/login")
      .send({ email: user.email, password: "whatever" });

    expect(res.status).toBe(401);
    expect(verifyDummyPasswordMock).toHaveBeenCalledWith("whatever");
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it("issues a token pair on valid credentials", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userFindUnique.mockResolvedValue(user as any);
    verifyPasswordMock.mockResolvedValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refreshTokenCreate.mockResolvedValue({} as any);

    const res = await supertest(makeApp())
      .post("/auth/login")
      .send({ email: user.email, password: "correct" });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf("string");
    expect(res.body.refreshToken).toBeTypeOf("string");
    expect(verifyDummyPasswordMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong password without shortcutting the bcrypt check", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userFindUnique.mockResolvedValue(user as any);
    verifyPasswordMock.mockResolvedValue(false);

    const res = await supertest(makeApp())
      .post("/auth/login")
      .send({ email: user.email, password: "wrong" });

    expect(res.status).toBe(401);
    expect(verifyPasswordMock).toHaveBeenCalledWith("wrong", user.passwordHash);
  });

  it("normalizes email case/whitespace before the lookup", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userFindUnique.mockResolvedValue(user as any);
    verifyPasswordMock.mockResolvedValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refreshTokenCreate.mockResolvedValue({} as any);

    const res = await supertest(makeApp())
      .post("/auth/login")
      .send({ email: "  A@Example.COM  ", password: "correct" });

    expect(res.status).toBe(200);
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { email: "a@example.com" },
      include: { member: true },
    });
  });
});

describe("POST /auth/refresh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function presentedToken() {
    const { token, tokenHash } = signRefreshToken(user.id);
    return { token, tokenHash };
  }

  it("rejects a token whose DB row has expired, even though revokedAt is null", async () => {
    const { token, tokenHash } = presentedToken();
    refreshTokenFindUnique.mockResolvedValue({
      id: "rt-1",
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      replacedByTokenId: null,
      createdAt: new Date(),
      user,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await supertest(makeApp()).post("/auth/refresh").send({ refreshToken: token });

    expect(res.status).toBe(401);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("treats a losing rotation race the same as reuse of a revoked token", async () => {
    const { token, tokenHash } = presentedToken();
    refreshTokenFindUnique.mockResolvedValue({
      id: "rt-1",
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 1000 * 60),
      revokedAt: null,
      replacedByTokenId: null,
      createdAt: new Date(),
      user,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // Simulate a concurrent request having already rotated this row: the
    // conditional updateMany inside the transaction matches zero rows.
    transaction.mockImplementation(async (fn) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx: any = {
        refreshToken: {
          create: vi.fn().mockResolvedValue({ id: "rt-2" }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return fn(tx as any);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refreshTokenUpdateMany.mockResolvedValue({ count: 2 } as any);

    const res = await supertest(makeApp()).post("/auth/refresh").send({ refreshToken: token });

    expect(res.status).toBe(401);
    // The theft response: revoke every active token for this user.
    expect(refreshTokenUpdateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("rotates successfully when no race occurs", async () => {
    const { token, tokenHash } = presentedToken();
    refreshTokenFindUnique.mockResolvedValue({
      id: "rt-1",
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 1000 * 60),
      revokedAt: null,
      replacedByTokenId: null,
      createdAt: new Date(),
      user,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    transaction.mockImplementation(async (fn) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx: any = {
        refreshToken: {
          create: vi.fn().mockResolvedValue({ id: "rt-2" }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return fn(tx as any);
    });

    const res = await supertest(makeApp()).post("/auth/refresh").send({ refreshToken: token });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf("string");
    expect(res.body.refreshToken).not.toBe(token);
    expect(refreshTokenUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown token hash", async () => {
    const { token } = presentedToken();
    refreshTokenFindUnique.mockResolvedValue(null);

    const res = await supertest(makeApp()).post("/auth/refresh").send({ refreshToken: token });

    expect(res.status).toBe(401);
  });

  it("kills every session on reuse of an already-revoked token", async () => {
    const { token, tokenHash } = presentedToken();
    refreshTokenFindUnique.mockResolvedValue({
      id: "rt-1",
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 1000 * 60),
      revokedAt: new Date(),
      replacedByTokenId: "rt-2",
      createdAt: new Date(),
      user,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refreshTokenUpdateMany.mockResolvedValue({ count: 3 } as any);

    const res = await supertest(makeApp()).post("/auth/refresh").send({ refreshToken: token });

    expect(res.status).toBe(401);
    expect(refreshTokenUpdateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("POST /auth/logout", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("is idempotent for an already-revoked/garbage token", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refreshTokenUpdateMany.mockResolvedValue({ count: 0 } as any);
    const res = await supertest(makeApp()).post("/auth/logout").send({ refreshToken: "garbage" });
    expect(res.status).toBe(204);
  });

  it("revokes the presented token", async () => {
    const tokenHash = hashRefreshToken("some-token");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refreshTokenUpdateMany.mockResolvedValue({ count: 1 } as any);

    const res = await supertest(makeApp()).post("/auth/logout").send({ refreshToken: "some-token" });

    expect(res.status).toBe(204);
    expect(refreshTokenUpdateMany).toHaveBeenCalledWith({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
