import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { Prisma } from "@prisma/client";
import { buvetteRouter } from "../../routes/buvette.js";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/jwt.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    pointsAccount: {
      findUnique: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
    },
    buvetteCardCheckout: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    buvetteCashSale: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../lib/sumup.js", () => ({
  listReaders: vi.fn(),
  pairReader: vi.fn(),
  createReaderCheckout: vi.fn(),
  terminateReaderCheckout: vi.fn(),
  getTransactionByClientId: vi.fn(),
  pointsToAmountMinorUnits: vi.fn((points: number) => Math.round((points * 100) / 15)),
  SUMUP_CURRENCY: "EUR",
}));

vi.mock("../../lib/buvetteCard.js", () => ({
  applyCardCheckoutStatus: vi.fn(),
}));

import {
  listReaders,
  pairReader,
  createReaderCheckout,
  terminateReaderCheckout,
  getTransactionByClientId,
  pointsToAmountMinorUnits,
} from "../../lib/sumup.js";
import { applyCardCheckoutStatus } from "../../lib/buvetteCard.js";

const pointsAccountFindUnique = vi.mocked(prisma.pointsAccount.findUnique);
const productFindUnique = vi.mocked(prisma.product.findUnique);
const transactionMock = vi.mocked(prisma.$transaction);
const cardCheckoutFindFirst = vi.mocked(prisma.buvetteCardCheckout.findFirst);
const cardCheckoutFindUnique = vi.mocked(prisma.buvetteCardCheckout.findUnique);
const cardCheckoutCreate = vi.mocked(prisma.buvetteCardCheckout.create);
const cardCheckoutUpdate = vi.mocked(prisma.buvetteCardCheckout.update);
const cashSaleCreate = vi.mocked(prisma.buvetteCashSale.create);
const auditLogCreate = vi.mocked(prisma.auditLog.create);
const listReadersMock = vi.mocked(listReaders);
const pairReaderMock = vi.mocked(pairReader);
const createReaderCheckoutMock = vi.mocked(createReaderCheckout);
const terminateReaderCheckoutMock = vi.mocked(terminateReaderCheckout);
const getTransactionByClientIdMock = vi.mocked(getTransactionByClientId);
const applyCardCheckoutStatusMock = vi.mocked(applyCardCheckoutStatus);
const pointsToAmountMinorUnitsMock = vi.mocked(pointsToAmountMinorUnits);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/buvette", buvetteRouter);
  return app;
}

function makeToken(role: "BUREAU" | "RESPONSABLE_POLE" | "MEMBRE_POLE" = "MEMBRE_POLE") {
  return signAccessToken({ sub: "operator-user-1", memberId: "operator-member-1", role, poleId: "pole-1" });
}

const pointsAccount = {
  id: "pa-1",
  userId: "customer-user-1",
  balance: 1000,
  qrToken: "wave:v1:valid-token",
  qrTokenExpiresAt: new Date(Date.now() + 60 * 1000),
};

const product = {
  id: "product-1",
  name: "Beer",
  pricePoints: 100,
  isActive: true,
};

function mockSuccessfulTransaction(overrides?: { balanceAfter?: number }) {
  const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
  transactionMock.mockImplementation(async (cb) => {
    const tx = {
      pointsAccount: {
        updateMany: updateManyMock,
        findUnique: vi.fn().mockResolvedValue({ balance: overrides?.balanceAfter ?? 900 }),
      },
      transaction: {
        create: vi.fn().mockResolvedValue({ id: "txn-1" }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return cb(tx);
  });
  return { updateManyMock };
}

describe("POST /buvette/scan", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a valid access token", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1" });

    expect(res.status).toBe(401);
  });

  it("returns 400 when qrPayload is missing", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ productId: "product-1" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when neither productId nor customAmount is provided", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when both productId and customAmount are provided", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1", customAmount: 50 });

    expect(res.status).toBe(400);
  });

  it("returns 400 when customAmount is not a positive integer", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", customAmount: 0 });

    expect(res.status).toBe(400);
  });

  it("returns 400 when quantity is provided alongside customAmount", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", customAmount: 50, quantity: 2 });

    expect(res.status).toBe(400);
  });

  it("returns 400 when quantity is not a positive integer", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1", quantity: 0 });

    expect(res.status).toBe(400);
  });

  it("returns 400 when quantity exceeds the upper bound", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1", quantity: 999_999_999 });

    expect(res.status).toBe(400);
    expect(pointsAccountFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 when customAmount exceeds the upper bound", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", customAmount: 999_999_999 });

    expect(res.status).toBe(400);
    expect(pointsAccountFindUnique).not.toHaveBeenCalled();
  });

  it("returns 401 when the QR token is unknown", async () => {
    pointsAccountFindUnique.mockResolvedValue(null);

    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:unknown", productId: "product-1" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or expired/);
  });

  it("returns 401 when the QR token has expired", async () => {
    pointsAccountFindUnique.mockResolvedValue({
      ...pointsAccount,
      qrTokenExpiresAt: new Date(Date.now() - 1000),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1" });

    expect(res.status).toBe(401);
  });

  it("returns 404 when the product does not exist", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    productFindUnique.mockResolvedValue(null);

    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "nonexistent" });

    expect(res.status).toBe(404);
  });

  it("returns 409 when the product is inactive", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue({ ...product, isActive: false } as any);

    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1" });

    expect(res.status).toBe(409);
  });

  it("returns 402 when the balance is insufficient", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    const updateManyMock = vi.fn().mockResolvedValue({ count: 0 });
    transactionMock.mockImplementation(async (cb) => {
      const tx = {
        pointsAccount: {
          updateMany: updateManyMock,
          // qrToken unchanged from the presented payload -> the 0-row result
          // must be attributed to balance, not a consumed QR.
          findUnique: vi.fn().mockResolvedValue({ ...pointsAccount }),
        },
        transaction: { create: vi.fn() },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      return cb(tx);
    });

    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1" });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe("insufficient balance");
    // The rotation is folded into this same conditional updateMany, so
    // proving it's only ever called once here proves there's no separate
    // rotation write happening after (or despite) the failed deduction.
    expect(updateManyMock).toHaveBeenCalledTimes(1);
  });

  it("returns 402 (no partial deduction) when a concurrent scan wins the balance race", async () => {
    // Simulates two concurrent requests racing on the same account: the
    // conditional updateMany reports count 0 even though a plain read would
    // have shown a sufficient balance moments earlier — same defense as
    // auth.ts's refresh-token rotation race.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    const createSpy = vi.fn();
    transactionMock.mockImplementation(async (cb) => {
      const tx = {
        pointsAccount: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findUnique: vi.fn().mockResolvedValue({ ...pointsAccount }),
        },
        transaction: { create: createSpy },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      return cb(tx);
    });

    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1" });

    expect(res.status).toBe(402);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("returns 401 (invalid/expired qr code) when a concurrent scan already consumed this exact QR value", async () => {
    // The where clause ANDs balance and qrToken, so a 0-row result can also
    // mean a concurrent scan rotated the token away first, not that the
    // balance was too low. The re-read inside the transaction sees a
    // different (already-rotated) qrToken, which must map to the same
    // "invalid or expired" response as a genuinely stale token, never to
    // "insufficient balance".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    const createSpy = vi.fn();
    transactionMock.mockImplementation(async (cb) => {
      const tx = {
        pointsAccount: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findUnique: vi.fn().mockResolvedValue({ ...pointsAccount, qrToken: "wave:v1:already-rotated" }),
        },
        transaction: { create: createSpy },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      return cb(tx);
    });

    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or expired/);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("deducts points, creates a PURCHASE transaction, and returns the new balance on success", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    mockSuccessfulTransaction({ balanceAfter: 900 });

    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1", quantity: 1 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      transactionId: "txn-1",
      product: { id: "product-1", name: "Beer", pricePoints: 100 },
      quantity: 1,
      amountDeducted: 100,
      newBalance: 900,
      customerUserId: "customer-user-1",
    });
  });

  it("rotates the QR token atomically with the balance deduction on a successful scan", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    const { updateManyMock } = mockSuccessfulTransaction({ balanceAfter: 900 });

    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1" });

    expect(res.status).toBe(201);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    const [[call]] = updateManyMock.mock.calls;
    expect(call.data.balance).toEqual({ decrement: 100 });
    expect(typeof call.data.qrToken).toBe("string");
    expect(call.data.qrToken).toMatch(/^wave:v1:/);
    expect(call.data.qrToken).not.toBe(pointsAccount.qrToken);
    expect(call.data.qrTokenExpiresAt).toBeInstanceOf(Date);
    expect(call.data.qrTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("deducts a custom amount and returns null product/quantity on success", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    mockSuccessfulTransaction({ balanceAfter: 950 });

    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", customAmount: 50 });

    expect(res.status).toBe(201);
    expect(productFindUnique).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      transactionId: "txn-1",
      product: null,
      quantity: null,
      amountDeducted: 50,
      newBalance: 950,
      customerUserId: "customer-user-1",
    });
  });

  it("multiplies price by quantity for the deducted amount", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    mockSuccessfulTransaction({ balanceAfter: 700 });

    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1", quantity: 3 });

    expect(res.status).toBe(201);
    expect(res.body.amountDeducted).toBe(300);
  });

  it("allows BUREAU and RESPONSABLE_POLE roles through, not just MEMBRE_POLE", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointsAccountFindUnique.mockResolvedValue(pointsAccount as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    mockSuccessfulTransaction();

    const res = await supertest(makeApp())
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1" });

    expect(res.status).toBe(201);
  });

  it("forwards an unexpected error to the error middleware instead of crashing", async () => {
    // Simulates the exact H1 scenario: something inside the async handler
    // throws unexpectedly (here, a DB error) after all the 400-level
    // validation has passed. Without asyncHandler wrapping the route, this
    // would become an unhandled promise rejection instead of reaching an
    // error-handling middleware.
    pointsAccountFindUnique.mockRejectedValue(new Error("db exploded"));

    const app = express();
    app.use(express.json());
    app.use("/buvette", buvetteRouter);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: "internal server error" });
    });

    const res = await supertest(app)
      .post("/buvette/scan")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ qrPayload: "wave:v1:valid-token", productId: "product-1" });

    expect(res.status).toBe(500);
  });
});

const cardCheckout = {
  id: "card-1",
  readerId: "rdr_1",
  clientTransactionId: "ctx-1",
  amountPoints: 100,
  amountMinorUnit: 667,
  currency: "EUR",
  status: "PENDING" as const,
  cancelRequestedAt: null as Date | null,
  forcedCancelAt: null as Date | null,
  forcedCancelRecheckedAt: null as Date | null,
  metadata: null,
  createdAt: new Date(),
  resolvedAt: null,
};

describe("GET /buvette/readers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a valid access token", async () => {
    const res = await supertest(makeApp()).get("/buvette/readers");
    expect(res.status).toBe(401);
  });

  it("lists readers for any logged-in member", async () => {
    listReadersMock.mockResolvedValue([{ id: "rdr_1", name: "Frontdesk", status: "paired", device: { identifier: "U1", model: "solo" } }]);

    const res = await supertest(makeApp())
      .get("/buvette/readers")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ readers: [{ id: "rdr_1", name: "Frontdesk", status: "paired" }] });
  });
});

describe("POST /buvette/readers/pair", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a valid access token", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/readers/pair")
      .send({ pairingCode: "4WLFDSBF", name: "Frontdesk" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-BUREAU member", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/readers/pair")
      .set("Authorization", `Bearer ${makeToken("MEMBRE_POLE")}`)
      .send({ pairingCode: "4WLFDSBF", name: "Frontdesk" });
    expect(res.status).toBe(403);
    expect(pairReaderMock).not.toHaveBeenCalled();
  });

  it("returns 400 when pairingCode is missing", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/readers/pair")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ name: "Frontdesk" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is missing", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/readers/pair")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ pairingCode: "4WLFDSBF" });
    expect(res.status).toBe(400);
  });

  it("pairs the reader for a BUREAU member", async () => {
    pairReaderMock.mockResolvedValue({ id: "rdr_1", name: "Frontdesk", status: "paired", device: { identifier: "U1", model: "solo" } });

    const res = await supertest(makeApp())
      .post("/buvette/readers/pair")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ pairingCode: "4WLFDSBF", name: "Frontdesk" });

    expect(res.status).toBe(201);
    expect(pairReaderMock).toHaveBeenCalledWith({ pairingCode: "4WLFDSBF", name: "Frontdesk" });
  });

  it("returns 502 when pairing fails", async () => {
    pairReaderMock.mockRejectedValue(new Error("offline"));

    const res = await supertest(makeApp())
      .post("/buvette/readers/pair")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ pairingCode: "4WLFDSBF", name: "Frontdesk" });

    expect(res.status).toBe(502);
  });
});

describe("POST /buvette/card/checkout", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // resetAllMocks() also wipes the vi.mock() factory's inline
    // implementation above, so it must be re-armed per test.
    pointsToAmountMinorUnitsMock.mockImplementation((points) => Math.round((points * 100) / 15));
    // Default: "rdr_1" (the readerId every test below sends) is a
    // currently-paired reader. Tests exercising the readerId-validation
    // rejection paths override this per-test.
    listReadersMock.mockResolvedValue([{ id: "rdr_1", name: "Frontdesk", status: "paired", device: { identifier: "U1", model: "solo" } }]);
  });

  it("returns 401 without a valid access token", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .send({ readerId: "rdr_1", productId: "product-1" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when readerId is missing", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ productId: "product-1" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when neither productId nor customAmount is provided", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ readerId: "rdr_1" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the product does not exist", async () => {
    productFindUnique.mockResolvedValue(null);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ readerId: "rdr_1", productId: "nonexistent" });

    expect(res.status).toBe(404);
  });

  it("returns 409 when the product is inactive", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue({ ...product, isActive: false } as any);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ readerId: "rdr_1", productId: "product-1" });

    expect(res.status).toBe(409);
  });

  it("returns 409 when the reader already has a checkout in progress", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardCheckoutFindFirst.mockResolvedValue(cardCheckout as any);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ readerId: "rdr_1", productId: "product-1" });

    expect(res.status).toBe(409);
    expect(createReaderCheckoutMock).not.toHaveBeenCalled();
  });

  it("returns 404 when readerId does not match a currently paired reader", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    cardCheckoutFindFirst.mockResolvedValue(null);
    listReadersMock.mockResolvedValue([{ id: "rdr_other", name: "Backdesk", status: "paired", device: { identifier: "U2", model: "solo" } }]);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ readerId: "rdr_1", productId: "product-1" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "reader not found" });
    expect(createReaderCheckoutMock).not.toHaveBeenCalled();
  });

  it("returns 502 when listing readers for validation fails", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    cardCheckoutFindFirst.mockResolvedValue(null);
    listReadersMock.mockRejectedValue(new Error("sumup unreachable"));

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ readerId: "rdr_1", productId: "product-1" });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "failed to verify reader" });
    expect(createReaderCheckoutMock).not.toHaveBeenCalled();
  });

  it("returns 502 when starting the SumUp reader checkout fails", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    cardCheckoutFindFirst.mockResolvedValue(null);
    createReaderCheckoutMock.mockRejectedValue(new Error("reader offline"));

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ readerId: "rdr_1", productId: "product-1" });

    expect(res.status).toBe(502);
    expect(cardCheckoutCreate).not.toHaveBeenCalled();
  });

  it("starts a reader checkout for a product and returns 201", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    cardCheckoutFindFirst.mockResolvedValue(null);
    createReaderCheckoutMock.mockResolvedValue({ clientTransactionId: "ctx-1" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardCheckoutCreate.mockResolvedValue(cardCheckout as any);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ readerId: "rdr_1", productId: "product-1", quantity: 2 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ checkoutId: "card-1", status: "PENDING", product: { id: "product-1" }, quantity: 2 });
    expect(createReaderCheckoutMock).toHaveBeenCalledWith({ readerId: "rdr_1", amountMinorUnit: expect.any(Number) });
  });

  it("returns 400 when the converted amount exceeds MAX_CARD_CHECKOUT_AMOUNT_CENTS", async () => {
    cardCheckoutFindFirst.mockResolvedValue(null);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .set("Authorization", `Bearer ${makeToken()}`)
      // 10,000 points -> 66,667 cents at 15pts/EUR, above the 50,000-cent cap.
      .send({ readerId: "rdr_1", customAmount: 10000 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "card checkout amount exceeds the maximum allowed (500 EUR)" });
    expect(createReaderCheckoutMock).not.toHaveBeenCalled();
  });

  it("starts a reader checkout for a custom amount and returns 201 with null product/quantity", async () => {
    cardCheckoutFindFirst.mockResolvedValue(null);
    createReaderCheckoutMock.mockResolvedValue({ clientTransactionId: "ctx-1" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardCheckoutCreate.mockResolvedValue(cardCheckout as any);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ readerId: "rdr_1", customAmount: 50 });

    expect(res.status).toBe(201);
    expect(productFindUnique).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ product: null, quantity: null });
  });

  it("returns 409 when the DB-level partial unique index rejects a concurrent PENDING checkout on the same reader", async () => {
    // The findFirst pre-check passed (no PENDING row seen), but the create
    // still races another request that inserted first — the DB constraint
    // (see schema.prisma's BuvetteCardCheckout doc comment) is what actually
    // catches this, surfaced here as a Prisma P2002 on the create call.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    cardCheckoutFindFirst.mockResolvedValue(null);
    createReaderCheckoutMock.mockResolvedValue({ clientTransactionId: "ctx-1" });
    cardCheckoutCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        // The hand-written partial index isn't in schema.prisma, so Prisma
        // can't map it to field names — it reports the raw constraint name.
        meta: { target: "BuvetteCardCheckout_readerId_pending_key" },
      }),
    );

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ readerId: "rdr_1", productId: "product-1" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "this reader already has a checkout in progress" });
  });

  it("does not return 409 when the P2002 is a clientTransactionId collision instead", async () => {
    // A different unique constraint colliding is not the reader-busy race
    // the 409 branch exists for — it should fall through to the generic
    // error handler instead of being mislabeled. This file's makeApp() only
    // mounts the router (no app.ts error middleware), so the thrown error
    // reaches Express's own default handler rather than the real
    // `{ error: "internal server error" }` JSON body — asserting the status
    // isn't 409 is what's actually under test here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    cardCheckoutFindFirst.mockResolvedValue(null);
    createReaderCheckoutMock.mockResolvedValue({ clientTransactionId: "ctx-1" });
    cardCheckoutCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        // A field Prisma does recognize from schema.prisma reports as an
        // array of field names, not a raw constraint-name string.
        meta: { target: ["clientTransactionId"] },
      }),
    );

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ readerId: "rdr_1", productId: "product-1" });

    expect(res.status).not.toBe(409);
  });
});

describe("POST /buvette/card/checkout/:id/confirm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a valid access token", async () => {
    const res = await supertest(makeApp()).post("/buvette/card/checkout/card-1/confirm");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the checkout does not exist", async () => {
    cardCheckoutFindUnique.mockResolvedValue(null);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout/nonexistent/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });

  it("replays the stored outcome without a new SumUp call once already terminal", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardCheckoutFindUnique.mockResolvedValue({ ...cardCheckout, status: "SUCCESSFUL" } as any);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout/card-1/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "SUCCESSFUL", checkoutId: "card-1" });
    expect(getTransactionByClientIdMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the SumUp transaction lookup fails", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardCheckoutFindUnique.mockResolvedValue(cardCheckout as any);
    getTransactionByClientIdMock.mockRejectedValue(new Error("network blip"));

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout/card-1/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(502);
  });

  it("returns 202 while SumUp still reports PENDING", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardCheckoutFindUnique.mockResolvedValue(cardCheckout as any);
    getTransactionByClientIdMock.mockResolvedValue("PENDING");
    applyCardCheckoutStatusMock.mockResolvedValue({ outcome: "still-pending" });

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout/card-1/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "PENDING", checkoutId: "card-1" });
  });

  it("returns 200 with the resolved status once SumUp reports a terminal outcome", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardCheckoutFindUnique.mockResolvedValue(cardCheckout as any);
    getTransactionByClientIdMock.mockResolvedValue("SUCCESSFUL");
    applyCardCheckoutStatusMock.mockResolvedValue({ outcome: "resolved", status: "SUCCESSFUL" });

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout/card-1/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "SUCCESSFUL", checkoutId: "card-1" });
  });

  it("treats a still-PENDING SumUp lookup as CANCELLED once the cancel grace period has elapsed", async () => {
    const overdueCancel = {
      ...cardCheckout,
      cancelRequestedAt: new Date(Date.now() - 30 * 1000),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardCheckoutFindUnique.mockResolvedValue(overdueCancel as any);
    getTransactionByClientIdMock.mockResolvedValue("PENDING");
    applyCardCheckoutStatusMock.mockResolvedValue({ outcome: "resolved", status: "CANCELLED" });

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout/card-1/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(applyCardCheckoutStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ sumupStatus: "CANCELLED", forcedCancel: true }),
    );
  });

  it("does not apply the cancel grace period while still within it", async () => {
    const recentCancel = {
      ...cardCheckout,
      cancelRequestedAt: new Date(Date.now() - 1000),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardCheckoutFindUnique.mockResolvedValue(recentCancel as any);
    getTransactionByClientIdMock.mockResolvedValue("PENDING");
    applyCardCheckoutStatusMock.mockResolvedValue({ outcome: "still-pending" });

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout/card-1/confirm")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(202);
    expect(applyCardCheckoutStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ sumupStatus: "PENDING", forcedCancel: false }),
    );
  });
});

describe("POST /buvette/card/checkout/:id/cancel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a valid access token", async () => {
    const res = await supertest(makeApp()).post("/buvette/card/checkout/card-1/cancel");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the checkout does not exist", async () => {
    cardCheckoutFindUnique.mockResolvedValue(null);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout/nonexistent/cancel")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });

  it("returns the stored status without calling terminate once already resolved", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardCheckoutFindUnique.mockResolvedValue({ ...cardCheckout, status: "FAILED" } as any);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout/card-1/cancel")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "FAILED", checkoutId: "card-1" });
    expect(terminateReaderCheckoutMock).not.toHaveBeenCalled();
  });

  it("requests termination and stamps cancelRequestedAt, without flipping status itself", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardCheckoutFindUnique.mockResolvedValue(cardCheckout as any);
    terminateReaderCheckoutMock.mockResolvedValue(undefined);
    cardCheckoutUpdate.mockResolvedValue({} as never);
    auditLogCreate.mockResolvedValue({} as never);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout/card-1/cancel")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "PENDING", checkoutId: "card-1", cancelRequested: true });
    expect(terminateReaderCheckoutMock).toHaveBeenCalledWith("rdr_1");
    expect(cardCheckoutUpdate).toHaveBeenCalledWith({
      where: { id: "card-1" },
      data: { cancelRequestedAt: expect.any(Date) },
    });
  });

  it("writes an explicit CANCEL_REQUESTED audit log entry on the cancel-request success path", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardCheckoutFindUnique.mockResolvedValue(cardCheckout as any);
    terminateReaderCheckoutMock.mockResolvedValue(undefined);
    cardCheckoutUpdate.mockResolvedValue({} as never);
    auditLogCreate.mockResolvedValue({} as never);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout/card-1/cancel")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(202);
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CANCEL_REQUESTED",
          entityType: "BuvetteCardCheckout",
          entityId: "card-1",
        }),
      }),
    );
  });

  it("still stamps cancelRequestedAt even when the terminate call itself fails (best-effort)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardCheckoutFindUnique.mockResolvedValue(cardCheckout as any);
    terminateReaderCheckoutMock.mockRejectedValue(new Error("device offline"));
    cardCheckoutUpdate.mockResolvedValue({} as never);
    auditLogCreate.mockResolvedValue({} as never);

    const res = await supertest(makeApp())
      .post("/buvette/card/checkout/card-1/cancel")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(202);
    expect(cardCheckoutUpdate).toHaveBeenCalled();
  });
});

describe("POST /buvette/cash", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a valid access token", async () => {
    const res = await supertest(makeApp()).post("/buvette/cash").send({ productId: "product-1" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when neither productId nor customAmount is provided", async () => {
    const res = await supertest(makeApp()).post("/buvette/cash").set("Authorization", `Bearer ${makeToken()}`).send({});

    expect(res.status).toBe(400);
    expect(cashSaleCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when both productId and customAmount are provided", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/cash")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ productId: "product-1", customAmount: 50 });

    expect(res.status).toBe(400);
  });

  it("returns 400 when customAmount exceeds the upper bound", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/cash")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ customAmount: 999_999_999 });

    expect(res.status).toBe(400);
    expect(cashSaleCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when quantity exceeds the upper bound", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/cash")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ productId: "product-1", quantity: 999_999_999 });

    expect(res.status).toBe(400);
    expect(productFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 when quantity is provided alongside customAmount", async () => {
    const res = await supertest(makeApp())
      .post("/buvette/cash")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ customAmount: 50, quantity: 2 });

    expect(res.status).toBe(400);
  });

  it("returns 404 when the product does not exist", async () => {
    productFindUnique.mockResolvedValue(null);

    const res = await supertest(makeApp())
      .post("/buvette/cash")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ productId: "nonexistent" });

    expect(res.status).toBe(404);
    expect(cashSaleCreate).not.toHaveBeenCalled();
  });

  it("returns 409 when the product is inactive", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue({ ...product, isActive: false } as any);

    const res = await supertest(makeApp())
      .post("/buvette/cash")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ productId: "product-1" });

    expect(res.status).toBe(409);
    expect(cashSaleCreate).not.toHaveBeenCalled();
  });

  it("records a cash sale for a product and returns 201", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue(product as any);
    cashSaleCreate.mockResolvedValue({
      id: "cash-1",
      paymentMethod: "CASH",
      amountPoints: 200,
      metadata: { productId: "product-1", productName: "Beer", quantity: 2, unitPricePoints: 100 },
      createdAt: new Date(),
    });

    const res = await supertest(makeApp())
      .post("/buvette/cash")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ productId: "product-1", quantity: 2 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      saleId: "cash-1",
      product: { id: "product-1", name: "Beer", pricePoints: 100 },
      quantity: 2,
      amountPoints: 200,
    });
    expect(cashSaleCreate).toHaveBeenCalledWith({
      data: {
        amountPoints: 200,
        metadata: { productId: "product-1", productName: "Beer", quantity: 2, unitPricePoints: 100 },
      },
    });
  });

  it("records a cash sale for a custom amount and returns null product/quantity", async () => {
    cashSaleCreate.mockResolvedValue({
      id: "cash-2",
      paymentMethod: "CASH",
      amountPoints: 50,
      metadata: { customAmount: true, amountPoints: 50 },
      createdAt: new Date(),
    });

    const res = await supertest(makeApp())
      .post("/buvette/cash")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ customAmount: 50 });

    expect(res.status).toBe(201);
    expect(productFindUnique).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ saleId: "cash-2", product: null, quantity: null, amountPoints: 50 });
  });

  it("allows BUREAU and RESPONSABLE_POLE roles through, not just MEMBRE_POLE", async () => {
    cashSaleCreate.mockResolvedValue({
      id: "cash-3",
      paymentMethod: "CASH",
      amountPoints: 50,
      metadata: { customAmount: true, amountPoints: 50 },
      createdAt: new Date(),
    });

    const res = await supertest(makeApp())
      .post("/buvette/cash")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ customAmount: 50 });

    expect(res.status).toBe(201);
  });
});
