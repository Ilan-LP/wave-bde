import { Router, type Router as ExpressRouter } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middleware/index.js";
import { generateQrPayload, QR_TOKEN_TTL_MS } from "../lib/qrToken.js";

export const meRouter: ExpressRouter = Router();

meRouter.get("/qrcode", authenticate, async (req, res) => {
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
});
