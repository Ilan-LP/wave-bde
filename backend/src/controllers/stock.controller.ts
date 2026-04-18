import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { createError } from '../middleware/errorHandler';

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await prisma.stockItem.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, description, quantity, unit, alertThreshold, category, isBuvette, priceCents } = req.body as {
      name: string; description?: string; quantity?: number; unit: string;
      alertThreshold?: number; category?: string; isBuvette?: boolean; priceCents?: number;
    };

    if (!name || !unit) throw createError('name et unit sont requis', 400, 'VALIDATION_ERROR');

    const item = await prisma.stockItem.create({
      data: { name, description, quantity, unit, alertThreshold, category, isBuvette, priceCents, lastUpdatedById: req.user!.id },
    });

    res.status(201).json({ success: true, item });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const { name, description, unit, alertThreshold, category, isBuvette, priceCents } = req.body as {
      name?: string; description?: string; unit?: string;
      alertThreshold?: number; category?: string; isBuvette?: boolean; priceCents?: number;
    };

    const item = await prisma.stockItem.update({
      where: { id },
      data: { name, description, unit, alertThreshold, category, isBuvette, priceCents, lastUpdatedById: req.user!.id },
    });

    res.json({ success: true, item });
  } catch (err) {
    next(err);
  }
}

export async function softDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    await prisma.stockItem.update({ where: { id }, data: { deletedAt: new Date() } });
    res.json({ success: true, message: 'Article archivé' });
  } catch (err) {
    next(err);
  }
}

export async function addMovement(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stockItemId = Number(req.params.id);
    const { delta, reason } = req.body as { delta: number; reason?: string };

    if (delta === undefined || delta === 0) throw createError('delta (non nul) est requis', 400, 'VALIDATION_ERROR');

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({ where: { id: stockItemId } });
      if (!item) throw createError('Article introuvable', 404, 'NOT_FOUND');

      const newQty = item.quantity + delta;
      if (newQty < 0) throw createError('Stock insuffisant', 400, 'INSUFFICIENT_STOCK');

      const updated = await tx.stockItem.update({
        where: { id: stockItemId },
        data: { quantity: newQty, lastUpdatedById: req.user!.id },
      });

      const movement = await tx.stockMovement.create({
        data: { stockItemId, userId: req.user!.id, delta, reason },
      });

      return { item: updated, movement };
    });

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getMovements(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stockItemId = Number(req.params.id);
    const movements = await prisma.stockMovement.findMany({
      where: { stockItemId },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, movements });
  } catch (err) {
    next(err);
  }
}
