import { Router, type Router as ExpressRouter } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate, requireRole } from "../middleware/index.js";

export const productsRouter: ExpressRouter = Router();

productsRouter.get("/", authenticate, requireRole("RESPONSABLE_POLE", "MEMBRE_POLE"), async (_req, res) => {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, pricePoints: true },
  });

  res.json({ products });
});

// Management listing: includes inactive products, BUREAU-only. Kept as a
// separate route rather than a query param on GET / so the till's existing
// "any logged-in member" role check stays a fixed, declarative middleware
// chain (see CLAUDE.md's Product Catalog section).
productsRouter.get("/all", authenticate, requireRole("BUREAU"), async (_req, res) => {
  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, pricePoints: true, isActive: true },
  });

  res.json({ products });
});

productsRouter.post("/", authenticate, requireRole("BUREAU"), async (req, res) => {
  const { name, pricePoints } = req.body as { name?: unknown; pricePoints?: unknown };

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (typeof pricePoints !== "number" || !Number.isInteger(pricePoints) || pricePoints < 1) {
    res.status(400).json({ error: "pricePoints must be a positive integer" });
    return;
  }

  const product = await prisma.product.create({
    data: { name: name.trim(), pricePoints },
    select: { id: true, name: true, pricePoints: true, isActive: true },
  });

  // Response is wrapped ({ product: {...} }), not a flat body with a
  // top-level `id`, so the audit middleware's inference fallback wouldn't
  // find one — set it explicitly (see CLAUDE.md's Audit Logging section).
  res.locals.auditEntityId = product.id;

  res.status(201).json({ product });
});

productsRouter.patch("/:id", authenticate, requireRole("BUREAU"), async (req, res) => {
  const { name, pricePoints } = req.body as { name?: unknown; pricePoints?: unknown };

  if (name === undefined && pricePoints === undefined) {
    res.status(400).json({ error: "at least one of name or pricePoints is required" });
    return;
  }
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    res.status(400).json({ error: "name must be a non-empty string" });
    return;
  }
  if (
    pricePoints !== undefined &&
    (typeof pricePoints !== "number" || !Number.isInteger(pricePoints) || pricePoints < 1)
  ) {
    res.status(400).json({ error: "pricePoints must be a positive integer" });
    return;
  }

  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "product not found" });
    return;
  }

  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined ? { name: (name as string).trim() } : {}),
      ...(pricePoints !== undefined ? { pricePoints: pricePoints as number } : {}),
    },
    select: { id: true, name: true, pricePoints: true, isActive: true },
  });

  res.json({ product });
});

productsRouter.patch("/:id/active", authenticate, requireRole("BUREAU"), async (req, res) => {
  const { isActive } = req.body as { isActive?: unknown };

  if (typeof isActive !== "boolean") {
    res.status(400).json({ error: "isActive must be a boolean" });
    return;
  }

  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: "product not found" });
    return;
  }

  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: { isActive },
    select: { id: true, name: true, pricePoints: true, isActive: true },
  });

  res.json({ product });
});
