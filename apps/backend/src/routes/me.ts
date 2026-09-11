import { randomUUID } from "node:crypto";
import { Router, type Router as ExpressRouter } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middleware/index.js";
import { generateQrPayload, QR_TOKEN_TTL_MS } from "../lib/qrToken.js";
import { env } from "../config/env.js";
import { createHostedCheckout, getCheckoutStatus, pointsToAmountMinorUnits, SUMUP_CURRENCY } from "../lib/sumup.js";
import { applySumUpCheckoutStatus, CHECKOUT_VALID_MS } from "../lib/recharge.js";
import { asyncHandler } from "../lib/asyncHandler.js";

export const meRouter: ExpressRouter = Router();

// Sanity bounds on a free-form recharge amount, not a business-mandated
// limit — see CLAUDE.md "Recharge (points top-up)" for why a free amount
// was chosen over fixed presets. Adjust freely.
const MIN_RECHARGE_POINTS = 1;
const MAX_RECHARGE_POINTS = 3000;

meRouter.get("/balance", authenticate, asyncHandler(async (req, res) => {
  const pointsAccount = await prisma.pointsAccount.findUnique({
    where: { userId: req.auth!.sub },
  });

  if (!pointsAccount) {
    res.status(404).json({ error: "points account not found" });
    return;
  }

  res.json({ balance: pointsAccount.balance });
}));

meRouter.get("/qrcode", authenticate, asyncHandler(async (req, res) => {
  const pointsAccount = await prisma.pointsAccount.findUnique({
    where: { userId: req.auth!.sub },
  });

  if (!pointsAccount) {
    res.status(404).json({ error: "points account not found" });
    return;
  }

  const isExpired = !pointsAccount.qrTokenExpiresAt || pointsAccount.qrTokenExpiresAt <= new Date();

  let qrToken = pointsAccount.qrToken;
  let qrTokenExpiresAt = pointsAccount.qrTokenExpiresAt;

  if (!qrToken || isExpired) {
    qrToken = generateQrPayload();
    qrTokenExpiresAt = new Date(Date.now() + QR_TOKEN_TTL_MS);
    await prisma.pointsAccount.update({
      where: { id: pointsAccount.id },
      data: { qrToken, qrTokenExpiresAt },
    });
  }

  res.json({ qrPayload: qrToken, expiresAt: qrTokenExpiresAt!.toISOString() });
}));

// Identifies the paying member purely from req.auth.sub (the JWT) — never
// from anything in the request body — so one member can only ever recharge
// their own PointsAccount, matching the /qrcode self-service convention
// above.
meRouter.post("/recharge", authenticate, asyncHandler(async (req, res) => {
  if (!env.isSumUpConfigured) {
    res.status(503).json({ error: "recharge is not available yet" });
    return;
  }

  const { points } = req.body as { points?: unknown };
  if (
    typeof points !== "number" ||
    !Number.isInteger(points) ||
    points < MIN_RECHARGE_POINTS ||
    points > MAX_RECHARGE_POINTS
  ) {
    res.status(400).json({ error: `points must be an integer between ${MIN_RECHARGE_POINTS} and ${MAX_RECHARGE_POINTS}` });
    return;
  }

  const pointsAccount = await prisma.pointsAccount.findUnique({
    where: { userId: req.auth!.sub },
  });
  if (!pointsAccount) {
    res.status(404).json({ error: "points account not found" });
    return;
  }

  const amountMinorUnit = pointsToAmountMinorUnits(points);

  let checkout;
  try {
    checkout = await createHostedCheckout({
      checkoutReference: randomUUID(),
      amountMinorUnit,
      description: `Wave points recharge (${points} pts)`,
      validUntil: new Date(Date.now() + CHECKOUT_VALID_MS),
    });
  } catch (err) {
    console.error("[recharge] failed to create SumUp checkout", err);
    res.status(502).json({ error: "failed to start payment" });
    return;
  }

  const rechargeCheckout = await prisma.rechargeCheckout.create({
    data: {
      pointsAccountId: pointsAccount.id,
      sumupCheckoutId: checkout.id,
      points,
      amountMinorUnit,
      currency: SUMUP_CURRENCY,
    },
  });

  res.locals.auditEntityType = "RechargeCheckout";
  res.locals.auditEntityId = rechargeCheckout.id;

  res.status(201).json({
    rechargeId: rechargeCheckout.id,
    checkoutId: checkout.id,
    hostedCheckoutUrl: checkout.hostedCheckoutUrl,
    points,
    amount: amountMinorUnit / 100,
    currency: SUMUP_CURRENCY,
  });
}));

// Polled by the (future, not-built-here) frontend after the member returns
// from the SumUp hosted checkout page. Safe to call repeatedly: once a
// RechargeCheckout leaves PENDING, later calls just replay the outcome
// without a second SumUp call or a second credit (see the conditional
// updateMany below, same race-safety pattern as buvette.ts's scan
// endpoint).
meRouter.post("/recharge/:id/confirm", authenticate, asyncHandler(async (req, res) => {
  const pointsAccount = await prisma.pointsAccount.findUnique({
    where: { userId: req.auth!.sub },
  });
  if (!pointsAccount) {
    res.status(404).json({ error: "points account not found" });
    return;
  }

  const rechargeCheckout = await prisma.rechargeCheckout.findUnique({
    where: { id: req.params.id },
  });
  if (!rechargeCheckout || rechargeCheckout.pointsAccountId !== pointsAccount.id) {
    res.status(404).json({ error: "recharge not found" });
    return;
  }

  if (rechargeCheckout.status === "CONFIRMED") {
    res.status(200).json({
      status: "CONFIRMED",
      points: rechargeCheckout.points,
      newBalance: pointsAccount.balance,
    });
    return;
  }
  if (rechargeCheckout.status === "FAILED" || rechargeCheckout.status === "EXPIRED") {
    res.status(402).json({ error: "payment failed or was cancelled", status: rechargeCheckout.status });
    return;
  }

  let sumupStatus;
  try {
    sumupStatus = await getCheckoutStatus(rechargeCheckout.sumupCheckoutId);
  } catch (err) {
    console.error("[recharge] failed to check SumUp checkout status", err);
    res.status(502).json({ error: "failed to check payment status" });
    return;
  }

  const resolution = await applySumUpCheckoutStatus({
    rechargeCheckout,
    sumupStatus,
    actorId: req.auth!.sub,
    ipAddress: req.ip ?? null,
    source: "confirm-endpoint",
  });

  if (resolution.outcome === "still-pending") {
    res.status(202).json({ status: "PENDING" });
    return;
  }

  if (resolution.outcome === "failed-or-expired") {
    // applySumUpCheckoutStatus already wrote the audit row for this transition.
    res.locals.skipAudit = true;
    res.status(402).json({ error: "payment failed or was cancelled", status: resolution.status });
    return;
  }

  if (resolution.outcome === "already-confirmed") {
    res.status(200).json({ status: "CONFIRMED", points: rechargeCheckout.points, newBalance: resolution.newBalance });
    return;
  }

  // applySumUpCheckoutStatus already wrote the audit row for this credit.
  res.locals.skipAudit = true;
  res.status(200).json({ status: "CONFIRMED", points: rechargeCheckout.points, newBalance: resolution.newBalance });
}));
