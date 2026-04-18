import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { createError } from '../middleware/errorHandler';
import { PaymentMethod } from '@prisma/client';
import * as avoirsService from '../services/avoirs.service';

export async function listItems(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await prisma.stockItem.findMany({
      where: { deletedAt: null, isBuvette: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
}

interface SellItem { stockItemId: number; quantity: number; }

export async function sell(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { items, paymentMethod, avoirCode } = req.body as {
      items: SellItem[];
      paymentMethod: PaymentMethod;
      avoirCode?: string;
    };

    if (!items || items.length === 0) throw createError('items est requis', 400, 'VALIDATION_ERROR');
    if (!paymentMethod) throw createError('paymentMethod est requis', 400, 'VALIDATION_ERROR');
    if (paymentMethod === 'AVOIR' && !avoirCode) throw createError('avoirCode est requis pour un paiement par avoir', 400, 'VALIDATION_ERROR');

    if (paymentMethod === 'AVOIR' && avoirCode) {
      const avoir = await prisma.avoir.findUnique({ where: { code: avoirCode.trim().toUpperCase() } });
      if (!avoir) throw createError('Avoir introuvable', 404, 'AVOIR_NOT_FOUND');
      if (avoir.status !== 'ACTIF') throw createError('Cet avoir n\'est plus actif', 400, 'AVOIR_NOT_ACTIVE');
    }

    const result = await prisma.$transaction(async (tx) => {
      let totalCents = 0;
      const processedItems: { stockItemId: number; quantity: number; priceCents: number }[] = [];

      for (const entry of items) {
        const item = await tx.stockItem.findUnique({ where: { id: entry.stockItemId } });
        if (!item) throw createError(`Article ${entry.stockItemId} introuvable`, 404, 'NOT_FOUND');
        if (!item.isBuvette) throw createError(`${item.name} n'est pas disponible à la buvette`, 400, 'NOT_BUVETTE');
        if (item.quantity < entry.quantity) throw createError(`Stock insuffisant pour ${item.name}`, 400, 'INSUFFICIENT_STOCK');

        await tx.stockItem.update({
          where: { id: entry.stockItemId },
          data: { quantity: item.quantity - entry.quantity, lastUpdatedById: req.user!.id },
        });

        await tx.stockMovement.create({
          data: { stockItemId: entry.stockItemId, userId: req.user!.id, delta: -entry.quantity, reason: 'Vente buvette' },
        });

        totalCents += item.priceCents * entry.quantity;
        processedItems.push({ stockItemId: entry.stockItemId, quantity: entry.quantity, priceCents: item.priceCents });
      }

      const vente = await tx.buvetteVente.create({
        data: {
          totalCents,
          paymentMethod,
          avoirCode: paymentMethod === 'AVOIR' ? avoirCode?.trim().toUpperCase() : null,
          vendeurId: req.user!.id,
          items: { create: processedItems },
        },
        include: { items: { include: { stockItem: { select: { id: true, name: true } } } } },
      });

      if (paymentMethod === 'AVOIR' && avoirCode) {
        await avoirsService.consumeAvoir(avoirCode.trim().toUpperCase(), req.user!.id);
      }

      return vente;
    });

    res.json({ success: true, vente: result });
  } catch (err) {
    next(err);
  }
}

export async function listVentes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const ventes = await prisma.buvetteVente.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        vendeur: { select: { id: true, firstName: true, lastName: true } },
        items: { include: { stockItem: { select: { id: true, name: true } } } },
      },
    });
    res.json({ success: true, ventes });
  } catch (err) {
    next(err);
  }
}
