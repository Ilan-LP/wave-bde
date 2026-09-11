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
