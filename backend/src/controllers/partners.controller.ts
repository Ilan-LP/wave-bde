import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { createError } from '../middleware/errorHandler';
import { PartnerStatus } from '@prisma/client';

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const partners = await prisma.partner.findMany({
      where: { deletedAt: null },
      include: { responsible: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, partners });
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const partner = await prisma.partner.findUnique({
      where: { id },
      include: { responsible: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!partner) throw createError('Partenaire introuvable', 404, 'NOT_FOUND');
    res.json({ success: true, partner });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, contactName, contactEmail, contactPhone, category, dealDescription, notes, responsibleId } =
      req.body as {
        name: string;
        contactName?: string;
        contactEmail?: string;
        contactPhone?: string;
        category?: string;
        dealDescription?: string;
        notes?: string;
        responsibleId?: number;
      };

    if (!name) throw createError('name est requis', 400, 'VALIDATION_ERROR');

    const partner = await prisma.partner.create({
      data: { name, contactName, contactEmail, contactPhone, category, dealDescription, notes, responsibleId },
    });

    res.status(201).json({ success: true, partner });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const data = req.body as {
      name?: string;
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      status?: PartnerStatus;
      category?: string;
      dealDescription?: string;
      notes?: string;
      responsibleId?: number;
    };

    const partner = await prisma.partner.update({ where: { id }, data });
    res.json({ success: true, partner });
  } catch (err) {
    next(err);
  }
}
