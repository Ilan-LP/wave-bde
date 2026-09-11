import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
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
    $transaction: vi.fn(),
  },
}));

const pointsAccountFindUnique = vi.mocked(prisma.pointsAccount.findUnique);
const productFindUnique = vi.mocked(prisma.product.findUnique);
const transactionMock = vi.mocked(prisma.$transaction);

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
  transactionMock.mockImplementation(async (cb) => {
    const tx = {
      pointsAccount: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ balance: overrides?.balanceAfter ?? 900 }),
      },
      transaction: {
        create: vi.fn().mockResolvedValue({ id: "txn-1" }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return cb(tx);
  });
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
    transactionMock.mockImplementation(async (cb) => {
      const tx = {
        pointsAccount: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
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
        pointsAccount: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
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
