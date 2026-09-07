import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { meRouter } from "../../routes/me.js";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/jwt.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    pointsAccount: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const pointsAccountFindUnique = vi.mocked(prisma.pointsAccount.findUnique);
const pointsAccountUpdate = vi.mocked(prisma.pointsAccount.update);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/me", meRouter);
  return app;
}

function makeToken() {
  return signAccessToken({ sub: "user-1", memberId: "member-1", role: "MEMBRE_POLE", poleId: "pole-1" });
}

describe("GET /me/qrcode", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a valid access token", async () => {
    const res = await supertest(makeApp()).get("/me/qrcode");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the caller has no PointsAccount", async () => {
    pointsAccountFindUnique.mockResolvedValue(null);

    const res = await supertest(makeApp())
      .get("/me/qrcode")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });

  it("generates and persists a token when none exists yet", async () => {
    pointsAccountFindUnique.mockResolvedValue({
      id: "pa-1",
      userId: "user-1",
      qrToken: null,
      qrTokenExpiresAt: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountUpdate.mockResolvedValue({} as any);

    const res = await supertest(makeApp())
      .get("/me/qrcode")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.qrPayload).toMatch(/^wave:v1:/);
    expect(res.body.expiresAt).toBeTypeOf("string");
    expect(pointsAccountUpdate).toHaveBeenCalledWith({
      where: { id: "pa-1" },
      data: { qrToken: res.body.qrPayload, qrTokenExpiresAt: new Date(res.body.expiresAt) },
    });
  });

  it("regenerates a token once the existing one has expired", async () => {
    pointsAccountFindUnique.mockResolvedValue({
      id: "pa-1",
      userId: "user-1",
      qrToken: "wave:v1:stale",
      qrTokenExpiresAt: new Date(Date.now() - 1000),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountUpdate.mockResolvedValue({} as any);

    const res = await supertest(makeApp())
      .get("/me/qrcode")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.qrPayload).not.toBe("wave:v1:stale");
    expect(pointsAccountUpdate).toHaveBeenCalled();
  });

  it("returns the same token without writing to the DB when it is still valid", async () => {
    pointsAccountFindUnique.mockResolvedValue({
      id: "pa-1",
      userId: "user-1",
      qrToken: "wave:v1:still-fresh",
      qrTokenExpiresAt: new Date(Date.now() + 1000 * 60),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await supertest(makeApp())
      .get("/me/qrcode")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.qrPayload).toBe("wave:v1:still-fresh");
    expect(pointsAccountUpdate).not.toHaveBeenCalled();
  });
});
