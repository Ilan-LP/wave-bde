import { createHash } from "node:crypto";
import { Router, type Router as ExpressRouter } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate, requireRole } from "../middleware/index.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const buvetteRouter: ExpressRouter = Router();

const INSUFFICIENT_BALANCE_ROLLBACK = "INSUFFICIENT_BALANCE_ROLLBACK";

// Sanity ceilings, not business-mandated limits — guard against an Int4
// overflow in totalPrice (pricePoints * quantity) once written to
// Transaction.amount / decremented from PointsAccount.balance. Worst case
// with both at their max is 100,000 * 100 = 10,000,000, far under Int4's
// ~2.1 billion ceiling. Adjust freely.
const MAX_CUSTOM_AMOUNT = 100_000;
const MAX_QUANTITY = 100;

buvetteRouter.post(
  "/scan",
  authenticate,
  requireRole("RESPONSABLE_POLE", "MEMBRE_POLE"),
  asyncHandler(async (req, res) => {
    const {
      qrPayload,
      productId,
      customAmount: rawCustomAmount,
      quantity: rawQuantity,
    } = req.body as {
      qrPayload?: unknown;
      productId?: unknown;
      customAmount?: unknown;
      quantity?: unknown;
    };

    if (typeof qrPayload !== "string" || !qrPayload) {
      res.status(400).json({ error: "qrPayload is required" });
      return;
    }

    const hasProductId = typeof productId === "string" && productId.length > 0;
    const hasCustomAmount = rawCustomAmount !== undefined;

    if (hasProductId === hasCustomAmount) {
      res.status(400).json({ error: "exactly one of productId or customAmount is required" });
      return;
    }

    if (hasCustomAmount) {
      if (
        typeof rawCustomAmount !== "number" ||
        !Number.isInteger(rawCustomAmount) ||
        rawCustomAmount < 1 ||
        rawCustomAmount > MAX_CUSTOM_AMOUNT
      ) {
        res.status(400).json({ error: `customAmount must be an integer between 1 and ${MAX_CUSTOM_AMOUNT}` });
        return;
      }
      if (rawQuantity !== undefined) {
        res.status(400).json({ error: "quantity is not allowed with customAmount" });
        return;
      }
    }

    let quantity = 1;
    if (hasProductId && rawQuantity !== undefined) {
      if (
        typeof rawQuantity !== "number" ||
        !Number.isInteger(rawQuantity) ||
        rawQuantity < 1 ||
        rawQuantity > MAX_QUANTITY
      ) {
        res.status(400).json({ error: `quantity must be an integer between 1 and ${MAX_QUANTITY}` });
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

    let product: { id: string; name: string; pricePoints: number; isActive: boolean } | null = null;
    let totalPrice: number;

    if (hasProductId) {
      product = await prisma.product.findUnique({ where: { id: productId as string } });
      if (!product) {
        res.status(404).json({ error: "product not found" });
        return;
      }
      if (!product.isActive) {
        res.status(409).json({ error: "product is not active" });
        return;
      }
      totalPrice = product.pricePoints * quantity;
    } else {
      totalPrice = rawCustomAmount as number;
    }

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

        // Hash, not the raw token: the QR doesn't rotate on use, so it stays
        // valid for the rest of its 5-minute TTL — storing it verbatim would
        // leave a still-usable credential sitting in the ledger, the same
        // reasoning that keeps RefreshToken storing only tokenHash (see
        // src/lib/jwt.ts).
        const qrTokenHash = createHash("sha256").update(qrPayload).digest("hex");

        const created = await tx.transaction.create({
          data: {
            pointsAccountId: pointsAccount.id,
            type: "PURCHASE",
            amount: -totalPrice,
            description: product ? `${product.name} x${quantity}` : "Custom amount",
            metadata: product
              ? {
                  productId: product.id,
                  productName: product.name,
                  quantity,
                  unitPricePoints: product.pricePoints,
                  qrTokenHash,
                }
              : {
                  customAmount: true,
                  amountPoints: totalPrice,
                  qrTokenHash,
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
      product: product ? { id: product.id, name: product.name, pricePoints: product.pricePoints } : null,
      quantity: product ? quantity : null,
      amountDeducted: totalPrice,
      newBalance,
      customerUserId: pointsAccount.userId,
    });
  }),
);
