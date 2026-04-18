import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../utils/prisma';
import { createError } from '../middleware/errorHandler';
import { TresoType } from '@prisma/client';

export async function getStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [transactions, venteAgg] = await Promise.all([
      prisma.tresoTransaction.findMany({ where: { deletedAt: null } }),
      prisma.buvetteVente.aggregate({ _sum: { totalCents: true }, _count: true }),
    ]);

    const recettes = transactions.filter(t => t.type === 'RECETTE').reduce((s, t) => s + t.amountCents, 0);
    const depenses = transactions.filter(t => t.type === 'DEPENSE').reduce((s, t) => s + t.amountCents, 0);
    const ventes = venteAgg._sum.totalCents ?? 0;

    res.json({
      success: true,
      stats: {
        recettesCents: recettes + ventes,
        depensesCents: depenses,
        soldeCents: recettes + ventes - depenses,
        ventesBuvetteCents: ventes,
        nbVentesBuvette: venteAgg._count,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function listTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = req.query.type as TresoType | undefined;
    const transactions = await prisma.tresoTransaction.findMany({
      where: { deletedAt: null, ...(type ? { type } : {}) },
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { date: 'desc' },
    });
    res.json({ success: true, transactions });
  } catch (err) {
    next(err);
  }
}

export async function createTransaction(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { type, amountCents, category, description, date } = req.body as {
      type: TresoType; amountCents: number; category?: string; description: string; date: string;
    };

    if (!type || !amountCents || !description || !date) {
      throw createError('type, amountCents, description et date sont requis', 400, 'VALIDATION_ERROR');
    }

    let invoiceUrl: string | undefined;
    if (req.file) {
      invoiceUrl = `/uploads/invoices/${path.basename(req.file.path)}`;
    }

    const transaction = await prisma.tresoTransaction.create({
      data: { type, amountCents, category, description, date: new Date(date), invoiceUrl, createdById: req.user!.id },
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
    });

    res.status(201).json({ success: true, transaction });
  } catch (err) {
    next(err);
  }
}

export async function updateTransaction(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const { type, amountCents, category, description, date } = req.body as {
      type?: TresoType; amountCents?: number; category?: string; description?: string; date?: string;
    };

    const transaction = await prisma.tresoTransaction.update({
      where: { id },
      data: { type, amountCents, category, description, date: date ? new Date(date) : undefined },
    });

    res.json({ success: true, transaction });
  } catch (err) {
    next(err);
  }
}

export async function deleteTransaction(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    await prisma.tresoTransaction.update({ where: { id }, data: { deletedAt: new Date() } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function uploadInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    if (!req.file) throw createError('Aucun fichier fourni', 400, 'NO_FILE');

    const invoiceUrl = `/uploads/invoices/${path.basename(req.file.path)}`;
    const transaction = await prisma.tresoTransaction.update({
      where: { id },
      data: { invoiceUrl },
    });

    res.json({ success: true, transaction });
  } catch (err) {
    next(err);
  }
}
