import { createHash } from "node:crypto";
import { Router, type Router as ExpressRouter } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate, requireRole } from "../middleware/index.js";

export const buvetteRouter: ExpressRouter = Router();

const INSUFFICIENT_BALANCE_ROLLBACK = "INSUFFICIENT_BALANCE_ROLLBACK";

buvetteRouter.post(
  "/scan",
  authenticate,
  requireRole("RESPONSABLE_POLE", "MEMBRE_POLE"),
  async (req, res) => {
    const { qrPayload, productId, quantity: rawQuantity } = req.body as {
      qrPayload?: unknown;
      productId?: unknown;
      quantity?: unknown;
    };

    if (typeof qrPayload !== "string" || !qrPayload || typeof productId !== "string" || !productId) {
      res.status(400).json({ error: "qrPayload and productId are required" });
      return;
    }

    let quantity = 1;
    if (rawQuantity !== undefined) {
      if (typeof rawQuantity !== "number" || !Number.isInteger(rawQuantity) || rawQuantity < 1) {
        res.status(400).json({ error: "quantity must be a positive integer" });
        return;
      }
      quantity = rawQuantity;
    }

    const pointsAccount = await prisma.pointsAccount.findUnique({ where: { qrToken: qrPayload } });
    const qrValid = pointsAccount?.qrTokenExpiresAt && pointsAccount.qrTokenExpiresAt > new Date();
    if (!qrValid) {
      res.status(401).json({ error: "invalid or expired qr code" });
      return;
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      res.status(404).json({ error: "product not found" });
      return;
    }
    if (!product.isActive) {
      res.status(409).json({ error: "product is not active" });
      return;
    }

    const totalPrice = product.pricePoints * quantity;

    let insufficientBalance = false;
    let transactionId: string | undefined;
    let newBalance: number | undefined;

    await prisma
      .$transaction(async (tx) => {
        const deducted = await tx.pointsAccount.updateMany({
          where: { id: pointsAccount.id, balance: { gte: totalPrice } },
          data: { balance: { decrement: totalPrice } },
        });
        if (deducted.count === 0) {
          insufficientBalance = true;
          throw new Error(INSUFFICIENT_BALANCE_ROLLBACK);
        }

        const created = await tx.transaction.create({
          data: {
            pointsAccountId: pointsAccount.id,
            type: "PURCHASE",
            amount: -totalPrice,
            description: `${product.name} x${quantity}`,
            metadata: {
              productId: product.id,
              productName: product.name,
              quantity,
              unitPricePoints: product.pricePoints,
              // Hash, not the raw token: the QR doesn't rotate on use, so it
              // stays valid for the rest of its 5-minute TTL — storing it
              // verbatim would leave a still-usable credential sitting in
              // the ledger, the same reasoning that keeps RefreshToken
              // storing only tokenHash (see src/lib/jwt.ts).
              qrTokenHash: createHash("sha256").update(qrPayload).digest("hex"),
            },
          },
        });
        transactionId = created.id;

        const account = await tx.pointsAccount.findUnique({ where: { id: pointsAccount.id } });
        newBalance = account?.balance;
      })
      .catch((err: unknown) => {
        if (!insufficientBalance) {
          throw err;
        }
      });

    if (insufficientBalance) {
      res.status(402).json({ error: "insufficient balance" });
      return;
    }

    res.locals.auditEntityType = "Transaction";
    res.locals.auditEntityId = transactionId;

    res.status(201).json({
      transactionId,
      product: { id: product.id, name: product.name, pricePoints: product.pricePoints },
      quantity,
      amountDeducted: totalPrice,
      newBalance,
      customerUserId: pointsAccount.userId,
    });
  },
);
