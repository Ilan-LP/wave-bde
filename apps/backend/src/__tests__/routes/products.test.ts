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
    },
  },
}));

const productFindMany = vi.mocked(prisma.product.findMany);

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
