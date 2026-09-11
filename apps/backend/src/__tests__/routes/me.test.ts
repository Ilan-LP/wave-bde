import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { meRouter } from "../../routes/me.js";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/jwt.js";
import { createHostedCheckout, getCheckoutStatus } from "../../lib/sumup.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    pointsAccount: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    rechargeCheckout: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../lib/sumup.js", () => ({
  createHostedCheckout: vi.fn(),
  getCheckoutStatus: vi.fn(),
  pointsToAmountMinorUnits: (points: number) => Math.round((points * 100) / 15),
  SUMUP_CURRENCY: "EUR",
}));

const pointsAccountFindUnique = vi.mocked(prisma.pointsAccount.findUnique);
const pointsAccountUpdate = vi.mocked(prisma.pointsAccount.update);
const rechargeCheckoutCreate = vi.mocked(prisma.rechargeCheckout.create);
const rechargeCheckoutFindUnique = vi.mocked(prisma.rechargeCheckout.findUnique);
const rechargeCheckoutUpdateMany = vi.mocked(prisma.rechargeCheckout.updateMany);
const transactionMock = vi.mocked(prisma.$transaction);
const createHostedCheckoutMock = vi.mocked(createHostedCheckout);
const getCheckoutStatusMock = vi.mocked(getCheckoutStatus);

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

describe("POST /me/recharge", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a valid access token", async () => {
    const res = await supertest(makeApp()).post("/me/recharge").send({ points: 150 });
    expect(res.status).toBe(401);
  });

  it("returns 400 when points is missing or not a positive integer", async () => {
    const app = makeApp();
    const token = makeToken();

    for (const points of [undefined, 0, -5, 1.5, "150"]) {
      const res = await supertest(app)
        .post("/me/recharge")
        .set("Authorization", `Bearer ${token}`)
        .send({ points });
      expect(res.status).toBe(400);
    }
  });

  it("returns 400 when points exceeds the sanity cap", async () => {
    const res = await supertest(makeApp())
      .post("/me/recharge")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ points: 3001 });

    expect(res.status).toBe(400);
  });

  it("returns 404 when the caller has no PointsAccount", async () => {
    pointsAccountFindUnique.mockResolvedValue(null);

    const res = await supertest(makeApp())
      .post("/me/recharge")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ points: 150 });

    expect(res.status).toBe(404);
  });

  it("creates a hosted checkout and a PENDING RechargeCheckout, never crediting points yet", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue({ id: "pa-1", userId: "user-1", balance: 0 } as any);
    createHostedCheckoutMock.mockResolvedValue({
      id: "sumup-checkout-1",
      status: "PENDING",
      hostedCheckoutUrl: "https://pay.example/1",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rechargeCheckoutCreate.mockResolvedValue({ id: "recharge-1" } as any);

    const res = await supertest(makeApp())
      .post("/me/recharge")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ points: 150 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      rechargeId: "recharge-1",
      checkoutId: "sumup-checkout-1",
      hostedCheckoutUrl: "https://pay.example/1",
      points: 150,
      amount: 10,
      currency: "EUR",
    });
    expect(rechargeCheckoutCreate).toHaveBeenCalledWith({
      data: {
        pointsAccountId: "pa-1",
        sumupCheckoutId: "sumup-checkout-1",
        points: 150,
        amountMinorUnit: 1000,
        currency: "EUR",
      },
    });
    expect(pointsAccountUpdate).not.toHaveBeenCalled();
  });

  it("returns 502 and creates no RechargeCheckout when SumUp checkout creation fails", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue({ id: "pa-1", userId: "user-1", balance: 0 } as any);
    createHostedCheckoutMock.mockRejectedValue(new Error("SumUp checkout creation failed: 400 Bad Request"));

    const res = await supertest(makeApp())
      .post("/me/recharge")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ points: 150 });

    expect(res.status).toBe(502);
    expect(rechargeCheckoutCreate).not.toHaveBeenCalled();
  });
});

describe("POST /me/recharge/:id/confirm", () => {
  const pointsAccount = { id: "pa-1", userId: "user-1", balance: 500 };
  const pendingCheckout = {
    id: "recharge-1",
    pointsAccountId: "pa-1",
    sumupCheckoutId: "sumup-checkout-1",
    points: 150,
    amountMinorUnit: 1000,
    currency: "EUR",
    status: "PENDING",
  };

  function mockSuccessfulCredit(overrides?: { balanceAfter?: number }) {
    transactionMock.mockImplementation(async (cb) => {
      const tx = {
        rechargeCheckout: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        pointsAccount: {
          update: vi.fn().mockResolvedValue({}),
          findUnique: vi.fn().mockResolvedValue({ balance: overrides?.balanceAfter ?? 650 }),
        },
        transaction: { create: vi.fn().mockResolvedValue({ id: "txn-1" }) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      return cb(tx);
    });
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a valid access token", async () => {
    const res = await supertest(makeApp()).post("/me/recharge/recharge-1/confirm");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the caller has no PointsAccount", async () => {
    pointsAccountFindUnique.mockResolvedValue(null);

    const res = await supertest(makeApp())
      .post("/me/recharge/recharge-1/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });

  it("returns 404 when the RechargeCheckout does not belong to the caller", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rechargeCheckoutFindUnique.mockResolvedValue({ ...pendingCheckout, pointsAccountId: "someone-elses-pa" } as any);

    const res = await supertest(makeApp())
      .post("/me/recharge/recharge-1/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
    expect(getCheckoutStatusMock).not.toHaveBeenCalled();
  });

  it("returns 202 and credits nothing while SumUp still reports PENDING", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rechargeCheckoutFindUnique.mockResolvedValue(pendingCheckout as any);
    getCheckoutStatusMock.mockResolvedValue("PENDING");

    const res = await supertest(makeApp())
      .post("/me/recharge/recharge-1/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(202);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 402 and marks FAILED, crediting nothing, when SumUp reports FAILED", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rechargeCheckoutFindUnique.mockResolvedValue(pendingCheckout as any);
    getCheckoutStatusMock.mockResolvedValue("FAILED");
    rechargeCheckoutUpdateMany.mockResolvedValue({ count: 1 });

    const res = await supertest(makeApp())
      .post("/me/recharge/recharge-1/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(402);
    expect(rechargeCheckoutUpdateMany).toHaveBeenCalledWith({
      where: { id: "recharge-1", status: "PENDING" },
      data: { status: "FAILED" },
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("credits points and creates a TOPUP transaction when SumUp reports PAID", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rechargeCheckoutFindUnique.mockResolvedValue(pendingCheckout as any);
    getCheckoutStatusMock.mockResolvedValue("PAID");
    mockSuccessfulCredit({ balanceAfter: 650 });

    const res = await supertest(makeApp())
      .post("/me/recharge/recharge-1/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "CONFIRMED", points: 150, newBalance: 650 });
  });

  it("does not call SumUp again and does not double-credit when the checkout is already CONFIRMED", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rechargeCheckoutFindUnique.mockResolvedValue({ ...pendingCheckout, status: "CONFIRMED" } as any);

    const res = await supertest(makeApp())
      .post("/me/recharge/recharge-1/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "CONFIRMED", points: 150 });
    expect(getCheckoutStatusMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("does not double-credit when it loses a concurrent confirm race", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rechargeCheckoutFindUnique.mockResolvedValue(pendingCheckout as any);
    getCheckoutStatusMock.mockResolvedValue("PAID");
    const createSpy = vi.fn();
    transactionMock.mockImplementation(async (cb) => {
      const tx = {
        rechargeCheckout: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        pointsAccount: { update: vi.fn(), findUnique: vi.fn() },
        transaction: { create: createSpy },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      return cb(tx);
    });

    const res = await supertest(makeApp())
      .post("/me/recharge/recharge-1/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
