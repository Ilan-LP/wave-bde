import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { productsRouter } from "../../routes/products.js";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/jwt.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const productFindMany = vi.mocked(prisma.product.findMany);
const productFindUnique = vi.mocked(prisma.product.findUnique);
const productCreate = vi.mocked(prisma.product.create);
const productUpdate = vi.mocked(prisma.product.update);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/products", productsRouter);
  return app;
}

function makeToken(role: "BUREAU" | "RESPONSABLE_POLE" | "MEMBRE_POLE" = "MEMBRE_POLE") {
  return signAccessToken({ sub: "user-1", memberId: "member-1", role, poleId: "pole-1" });
}

describe("GET /products", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a valid access token", async () => {
    const res = await supertest(makeApp()).get("/products");
    expect(res.status).toBe(401);
  });

  it("returns only active products, ordered by name", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindMany.mockResolvedValue([{ id: "p1", name: "Beer", pricePoints: 100 }] as any);

    const res = await supertest(makeApp())
      .get("/products")
      .set("Authorization", `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ products: [{ id: "p1", name: "Beer", pricePoints: 100 }] });
    expect(productFindMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, pricePoints: true },
    });
  });

  it("allows BUREAU and RESPONSABLE_POLE roles through, not just MEMBRE_POLE", async () => {
    productFindMany.mockResolvedValue([]);

    const res = await supertest(makeApp())
      .get("/products")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`);

    expect(res.status).toBe(200);
  });
});

describe("GET /products/all", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 for a non-BUREAU role", async () => {
    const res = await supertest(makeApp())
      .get("/products/all")
      .set("Authorization", `Bearer ${makeToken("MEMBRE_POLE")}`);

    expect(res.status).toBe(403);
    expect(productFindMany).not.toHaveBeenCalled();
  });

  it("returns active and inactive products for BUREAU", async () => {
    productFindMany.mockResolvedValue([
      { id: "p1", name: "Beer", pricePoints: 100, isActive: true },
      { id: "p2", name: "Retired Snack", pricePoints: 50, isActive: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const res = await supertest(makeApp())
      .get("/products/all")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`);

    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(2);
    expect(productFindMany).toHaveBeenCalledWith({
      orderBy: { name: "asc" },
      select: { id: true, name: true, pricePoints: true, isActive: true },
    });
  });
});

describe("POST /products", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 for a non-BUREAU role", async () => {
    const res = await supertest(makeApp())
      .post("/products")
      .set("Authorization", `Bearer ${makeToken("MEMBRE_POLE")}`)
      .send({ name: "Beer", pricePoints: 100 });

    expect(res.status).toBe(403);
    expect(productCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when name is missing or blank", async () => {
    const res = await supertest(makeApp())
      .post("/products")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ name: "   ", pricePoints: 100 });

    expect(res.status).toBe(400);
    expect(productCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when pricePoints is not a positive integer", async () => {
    const res = await supertest(makeApp())
      .post("/products")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ name: "Beer", pricePoints: 0 });

    expect(res.status).toBe(400);
    expect(productCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when pricePoints exceeds the upper bound", async () => {
    const res = await supertest(makeApp())
      .post("/products")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ name: "Beer", pricePoints: 999_999_999 });

    expect(res.status).toBe(400);
    expect(productCreate).not.toHaveBeenCalled();
  });

  it("creates a product, active by default, trimming the name", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productCreate.mockResolvedValue({ id: "p1", name: "Beer", pricePoints: 100, isActive: true } as any);

    const res = await supertest(makeApp())
      .post("/products")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ name: "  Beer  ", pricePoints: 100 });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ product: { id: "p1", name: "Beer", pricePoints: 100, isActive: true } });
    expect(productCreate).toHaveBeenCalledWith({
      data: { name: "Beer", pricePoints: 100 },
      select: { id: true, name: true, pricePoints: true, isActive: true },
    });
  });
});

describe("PATCH /products/:id", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 for a non-BUREAU role", async () => {
    const res = await supertest(makeApp())
      .patch("/products/p1")
      .set("Authorization", `Bearer ${makeToken("RESPONSABLE_POLE")}`)
      .send({ name: "Soda" });

    expect(res.status).toBe(403);
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when neither name nor pricePoints is provided", async () => {
    const res = await supertest(makeApp())
      .patch("/products/p1")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({});

    expect(res.status).toBe(400);
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the product does not exist", async () => {
    productFindUnique.mockResolvedValue(null);

    const res = await supertest(makeApp())
      .patch("/products/missing")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ name: "Soda" });

    expect(res.status).toBe(404);
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when pricePoints exceeds the upper bound", async () => {
    const res = await supertest(makeApp())
      .patch("/products/p1")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ pricePoints: 999_999_999 });

    expect(res.status).toBe(400);
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("updates only the provided fields", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue({ id: "p1", name: "Beer", pricePoints: 100, isActive: true } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productUpdate.mockResolvedValue({ id: "p1", name: "Beer", pricePoints: 150, isActive: true } as any);

    const res = await supertest(makeApp())
      .patch("/products/p1")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ pricePoints: 150 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: { id: "p1", name: "Beer", pricePoints: 150, isActive: true } });
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { pricePoints: 150 },
      select: { id: true, name: true, pricePoints: true, isActive: true },
    });
  });
});

describe("PATCH /products/:id/active", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 for a non-BUREAU role", async () => {
    const res = await supertest(makeApp())
      .patch("/products/p1/active")
      .set("Authorization", `Bearer ${makeToken("MEMBRE_POLE")}`)
      .send({ isActive: false });

    expect(res.status).toBe(403);
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when isActive is not a boolean", async () => {
    const res = await supertest(makeApp())
      .patch("/products/p1/active")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ isActive: "false" });

    expect(res.status).toBe(400);
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the product does not exist", async () => {
    productFindUnique.mockResolvedValue(null);

    const res = await supertest(makeApp())
      .patch("/products/missing/active")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ isActive: false });

    expect(res.status).toBe(404);
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("sets isActive explicitly rather than flipping it", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productFindUnique.mockResolvedValue({ id: "p1", name: "Beer", pricePoints: 100, isActive: true } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productUpdate.mockResolvedValue({ id: "p1", name: "Beer", pricePoints: 100, isActive: false } as any);

    const res = await supertest(makeApp())
      .patch("/products/p1/active")
      .set("Authorization", `Bearer ${makeToken("BUREAU")}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: { id: "p1", name: "Beer", pricePoints: 100, isActive: false } });
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { isActive: false },
      select: { id: true, name: true, pricePoints: true, isActive: true },
    });
  });
});
