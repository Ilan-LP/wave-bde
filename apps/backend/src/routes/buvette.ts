import { createHash } from "node:crypto";
import { Router, type Router as ExpressRouter } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authenticate, requireRole } from "../middleware/index.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { generateQrPayload, QR_TOKEN_TTL_MS } from "../lib/qrToken.js";
import { env } from "../config/env.js";
import {
  createReaderCheckout,
  getTransactionByClientId,
  listReaders,
  pairReader,
  pointsToAmountMinorUnits,
  SUMUP_CURRENCY,
  terminateReaderCheckout,
  type SumUpTransactionStatus,
} from "../lib/sumup.js";
import { applyCardCheckoutStatus } from "../lib/buvetteCard.js";
import { writeAuditLog } from "../middleware/audit.js";

export const buvetteRouter: ExpressRouter = Router();

const CONDITIONAL_UPDATE_ROLLBACK = "CONDITIONAL_UPDATE_ROLLBACK";

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
    let qrAlreadyConsumed = false;
    let transactionId: string | undefined;
    let newBalance: number | undefined;

    await prisma
      .$transaction(async (tx) => {
        // Rotated in the same conditional write as the balance decrement, so
        // a successful scan invalidates the just-used QR value atomically —
        // if the where clause doesn't match, nothing is written at all, so a
        // failed scan never rotates the token.
        const newQrToken = generateQrPayload();
        const newQrTokenExpiresAt = new Date(Date.now() + QR_TOKEN_TTL_MS);

        // qrToken is part of the where clause (not just the initial
        // findUnique above) so the single-use guarantee is enforced by this
        // conditional write itself, not only by the HTTP-layer replay rate
        // limiter — a concurrent scan that rotates this exact token between
        // our read and this write loses the race here instead of both scans
        // succeeding.
        const deducted = await tx.pointsAccount.updateMany({
          where: { id: pointsAccount.id, balance: { gte: totalPrice }, qrToken: qrPayload },
          data: {
            balance: { decrement: totalPrice },
            qrToken: newQrToken,
            qrTokenExpiresAt: newQrTokenExpiresAt,
          },
        });
        if (deducted.count === 0) {
          // Two independent conditions are ANDed in the where clause above,
          // so a 0-row result no longer means "balance too low" on its own —
          // it can also mean a concurrent scan already rotated this exact
          // qrToken away first. Re-read to tell the two apart so the
          // response below isn't misleading.
          const current = await tx.pointsAccount.findUnique({ where: { id: pointsAccount.id } });
          if (current?.qrToken !== qrPayload) {
            qrAlreadyConsumed = true;
          } else {
            insufficientBalance = true;
          }
          throw new Error(CONDITIONAL_UPDATE_ROLLBACK);
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
        if (!insufficientBalance && !qrAlreadyConsumed) {
          throw err;
        }
      });

    if (qrAlreadyConsumed) {
      // Same status/message as the initial QR validation above — from the
      // caller's perspective this token is no longer valid, and collapsing
      // "already used by a concurrent scan" into the same generic response
      // keeps the existing anti-enumeration convention rather than revealing
      // that a race occurred.
      res.status(401).json({ error: "invalid or expired qr code" });
      return;
    }

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

// ---------------------------------------------------------------------------
// Card payment (SumUp Readers API) — see CLAUDE.md's "Buvette Card Payment"
// section for the full design. Deliberately independent of the points
// deduction above: a card-present sale never identifies a customer, so none
// of these routes touch PointsAccount or create a Transaction row.
// ---------------------------------------------------------------------------

// How long after a cancel request we keep trusting "SumUp still shows no
// transaction for this checkout" as evidence the termination actually
// worked, rather than as an in-flight payment SumUp just hasn't recorded
// yet. Short on purpose: terminate only has any effect before the card is
// presented, so if a transaction was going to appear at all it appears fast.
const CANCEL_GRACE_MS = 8 * 1000;

// Lists readers already paired with the configured merchant account, for
// the till's reader picker (apps/buvette/src/components/ReaderPicker.tsx).
// Any logged-in member, same "any logged-in member" RBAC shape as the rest
// of the buvette routes — pairing itself (below) is BUREAU-only, but
// picking among already-paired readers is a normal till operation.
buvetteRouter.get(
  "/readers",
  authenticate,
  requireRole("RESPONSABLE_POLE", "MEMBRE_POLE"),
  asyncHandler(async (_req, res) => {
    if (!env.isSumUpConfigured) {
      res.status(503).json({ error: "card payment is not available yet" });
      return;
    }
    const readers = await listReaders();
    res.json({ readers: readers.map((r) => ({ id: r.id, name: r.name, status: r.status })) });
  }),
);

// Pairs a new physical reader using the pairing code shown on the device's
// own screen — a one-time, physical setup action, not a per-sale one.
// BUREAU-only: this is account/hardware configuration, not till operation,
// same reasoning as product management being BUREAU-only (see CLAUDE.md
// "Product Catalog").
buvetteRouter.post(
  "/readers/pair",
  authenticate,
  requireRole("BUREAU"),
  asyncHandler(async (req, res) => {
    if (!env.isSumUpConfigured) {
      res.status(503).json({ error: "card payment is not available yet" });
      return;
    }

    const { pairingCode, name } = req.body as { pairingCode?: unknown; name?: unknown };
    if (typeof pairingCode !== "string" || !pairingCode) {
      res.status(400).json({ error: "pairingCode is required" });
      return;
    }
    if (typeof name !== "string" || !name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    let reader;
    try {
      reader = await pairReader({ pairingCode, name });
    } catch (err) {
      console.error("[buvette-card] failed to pair reader", err);
      res.status(502).json({ error: "failed to pair reader" });
      return;
    }

    res.locals.auditEntityType = "SumUpReader";
    res.locals.auditEntityId = reader.id;

    res.status(201).json({ reader });
  }),
);

// Starts a card-present checkout on a paired reader for a basket, using the
// exact same productId/customAmount/quantity validation as POST /scan above
// (duplicated rather than extracted into a shared helper, to avoid touching
// that existing, already-tested handler). No QR involved: the caller is the
// till operator identifying which reader and which basket, not a customer.
buvetteRouter.post(
  "/card/checkout",
  authenticate,
  requireRole("RESPONSABLE_POLE", "MEMBRE_POLE"),
  asyncHandler(async (req, res) => {
    if (!env.isSumUpConfigured) {
      res.status(503).json({ error: "card payment is not available yet" });
      return;
    }

    const {
      readerId,
      productId,
      customAmount: rawCustomAmount,
      quantity: rawQuantity,
    } = req.body as {
      readerId?: unknown;
      productId?: unknown;
      customAmount?: unknown;
      quantity?: unknown;
    };

    if (typeof readerId !== "string" || !readerId) {
      res.status(400).json({ error: "readerId is required" });
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

    // Mirrors the /scan QR replay guard's spirit: refuse to start a second
    // checkout on a reader that already has one in flight, rather than
    // relying solely on SumUp's own same-device rejection during its
    // 60-second window.
    const existingPending = await prisma.buvetteCardCheckout.findFirst({
      where: { readerId, status: "PENDING" },
    });
    if (existingPending) {
      res.status(409).json({ error: "this reader already has a checkout in progress" });
      return;
    }

    // readerId was previously accepted as any non-empty string, never
    // checked against reality — a caller could target a reader that was
    // never paired with this merchant account. Validated against a live
    // listReaders() result (the same call GET /buvette/readers already
    // makes) rather than a format regex, since the goal is confirming the
    // device is actually paired, not just that the string looks plausible.
    let pairedReaders;
    try {
      pairedReaders = await listReaders();
    } catch (err) {
      console.error("[buvette-card] failed to list readers for validation", err);
      res.status(502).json({ error: "failed to verify reader" });
      return;
    }
    if (!pairedReaders.some((r) => r.id === readerId)) {
      res.status(404).json({ error: "reader not found" });
      return;
    }

    const amountMinorUnit = pointsToAmountMinorUnits(totalPrice);

    let checkout;
    try {
      checkout = await createReaderCheckout({ readerId, amountMinorUnit });
    } catch (err) {
      console.error("[buvette-card] failed to start reader checkout", err);
      res.status(502).json({ error: "failed to start card payment" });
      return;
    }

    let cardCheckout;
    try {
      cardCheckout = await prisma.buvetteCardCheckout.create({
        data: {
          readerId,
          clientTransactionId: checkout.clientTransactionId,
          amountPoints: totalPrice,
          amountMinorUnit,
          currency: SUMUP_CURRENCY,
          metadata: product
            ? { productId: product.id, productName: product.name, quantity, unitPricePoints: product.pricePoints }
            : { customAmount: true, amountPoints: totalPrice },
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Lost the race against the findFirst pre-check above: the DB-level
        // partial unique index (readerId WHERE status = 'PENDING', see
        // schema.prisma's BuvetteCardCheckout doc comment) is the real
        // guarantee here, since that pre-check and this create are not
        // atomic together. Same message as the pre-check's own 409 so a
        // caller can't tell which layer caught it.
        res.status(409).json({ error: "this reader already has a checkout in progress" });
        return;
      }
      throw err;
    }

    res.locals.auditEntityType = "BuvetteCardCheckout";
    res.locals.auditEntityId = cardCheckout.id;

    res.status(201).json({
      checkoutId: cardCheckout.id,
      readerId,
      product: product ? { id: product.id, name: product.name, pricePoints: product.pricePoints } : null,
      quantity: product ? quantity : null,
      amountPoints: totalPrice,
      amount: amountMinorUnit / 100,
      currency: SUMUP_CURRENCY,
      status: "PENDING",
    });
  }),
);

// Polled by the cashier UI every ~2s while a card checkout is PENDING — same
// "safe to call repeatedly" idempotent shape as POST /me/recharge/:id/confirm
// (see CLAUDE.md "SumUp Integration + Recharge"). Once a checkout leaves
// PENDING, later calls just replay the stored outcome without a second SumUp
// call.
buvetteRouter.post(
  "/card/checkout/:id/confirm",
  authenticate,
  requireRole("RESPONSABLE_POLE", "MEMBRE_POLE"),
  asyncHandler(async (req, res) => {
    const cardCheckout = await prisma.buvetteCardCheckout.findUnique({ where: { id: req.params.id } });
    if (!cardCheckout) {
      res.status(404).json({ error: "card checkout not found" });
      return;
    }

    if (cardCheckout.status !== "PENDING") {
      // Pure replay of an already-resolved row — no state change on this call.
      res.locals.skipAudit = true;
      res.status(200).json({ status: cardCheckout.status, checkoutId: cardCheckout.id });
      return;
    }

    let sumupStatus: SumUpTransactionStatus;
    try {
      sumupStatus = await getTransactionByClientId(cardCheckout.clientTransactionId);
    } catch (err) {
      console.error("[buvette-card] failed to check SumUp transaction status", err);
      res.status(502).json({ error: "failed to check payment status" });
      return;
    }

    let forcedCancel = false;
    if (
      sumupStatus === "PENDING" &&
      cardCheckout.cancelRequestedAt &&
      Date.now() - cardCheckout.cancelRequestedAt.getTime() > CANCEL_GRACE_MS
    ) {
      // Cancel was requested a while ago and SumUp still shows no
      // transaction for this checkout — trust the termination worked rather
      // than leaving the till waiting on a payment that was never started.
      // This is a forced call, not an observed SumUp status, so it's flagged
      // (forcedCancel) so applyCardCheckoutStatus stamps forcedCancelAt —
      // the reconciliation job later re-checks this against SumUp's real
      // status once, in case SumUp actually completed the charge after all
      // (see src/lib/buvetteCard.ts's recheckForcedCancellation).
      sumupStatus = "CANCELLED";
      forcedCancel = true;
    }

    const resolution = await applyCardCheckoutStatus({
      cardCheckout,
      sumupStatus,
      actorId: req.auth!.sub,
      ipAddress: req.ip ?? null,
      source: "poll-endpoint",
      forcedCancel,
    });

    if (resolution.outcome === "still-pending") {
      // No-op poll — nothing changed on this call.
      res.locals.skipAudit = true;
      res.status(202).json({ status: "PENDING", checkoutId: cardCheckout.id });
      return;
    }

    // applyCardCheckoutStatus already wrote the audit row for this transition.
    res.locals.skipAudit = true;
    res.status(200).json({ status: resolution.status, checkoutId: cardCheckout.id });
  }),
);

// Requests SumUp stop the current transaction on the reader. Deliberately
// does NOT flip status to CANCELLED itself — see CARD_CHECKOUT_STALE_MS's
// sibling constant CANCEL_GRACE_MS above and CLAUDE.md's "Buvette Card
// Payment" section: terminate gives no confirmation it worked, so the
// checkout is only ever resolved by a later poll observing SumUp's actual
// transaction outcome, never by this call's own success.
buvetteRouter.post(
  "/card/checkout/:id/cancel",
  authenticate,
  requireRole("RESPONSABLE_POLE", "MEMBRE_POLE"),
  asyncHandler(async (req, res) => {
    const cardCheckout = await prisma.buvetteCardCheckout.findUnique({ where: { id: req.params.id } });
    if (!cardCheckout) {
      res.status(404).json({ error: "card checkout not found" });
      return;
    }
    if (cardCheckout.status !== "PENDING") {
      res.status(200).json({ status: cardCheckout.status, checkoutId: cardCheckout.id });
      return;
    }

    try {
      await terminateReaderCheckout(cardCheckout.readerId);
    } catch (err) {
      console.error("[buvette-card] terminate request failed (best-effort)", err);
    }

    await prisma.buvetteCardCheckout.update({
      where: { id: cardCheckout.id },
      data: { cancelRequestedAt: new Date() },
    });

    // The cancellation *request* itself is a real, audit-worthy action (the
    // cashier asked SumUp to stop the sale), even though the checkout's own
    // status isn't resolved yet — that eventual resolution is audited
    // separately by applyCardCheckoutStatus. Logged explicitly, same pattern
    // as applyCardCheckoutStatus/applySumUpCheckoutStatus, since the generic
    // middleware would otherwise mislabel this CREATE (it's a POST) rather
    // than the cancel-request it actually is.
    writeAuditLog({
      actorId: req.auth!.sub,
      action: "CANCEL_REQUESTED",
      entityType: "BuvetteCardCheckout",
      entityId: cardCheckout.id,
      ipAddress: req.ip ?? null,
      metadata: { source: "cancel-endpoint", readerId: cardCheckout.readerId },
    });

    res.locals.skipAudit = true;
    res.status(202).json({ status: "PENDING", checkoutId: cardCheckout.id, cancelRequested: true });
  }),
);
