import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { createError } from '../middleware/errorHandler';
import { EventStatus } from '@prisma/client';

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const events = await prisma.event.findMany({
      where: { deletedAt: null },
      include: {
        responsible: { select: { id: true, firstName: true, lastName: true } },
        tasks: true,
      },
      orderBy: { date: 'desc' },
    });
    res.json({ success: true, events });
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        responsible: { select: { id: true, firstName: true, lastName: true } },
        tasks: {
          include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!event) throw createError('Événement introuvable', 404, 'NOT_FOUND');
    res.json({ success: true, event });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { title, description, date, location, budgetCents, responsibleId } = req.body as {
      title: string;
      description?: string;
      date: string;
      location?: string;
      budgetCents?: number;
      responsibleId?: number;
    };

    if (!title || !date) throw createError('title et date sont requis', 400, 'VALIDATION_ERROR');

    const event = await prisma.event.create({
      data: { title, description, date: new Date(date), location, budgetCents, responsibleId },
    });

    res.status(201).json({ success: true, event });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const { title, description, date, location, status, budgetCents, spentCents, responsibleId } = req.body as {
      title?: string;
      description?: string;
      date?: string;
      location?: string;
      status?: EventStatus;
      budgetCents?: number;
      spentCents?: number;
      responsibleId?: number;
    };

    const event = await prisma.event.update({
      where: { id },
      data: {
        title,
        description,
        date: date ? new Date(date) : undefined,
        location,
        status,
        budgetCents,
        spentCents,
        responsibleId,
      },
    });

    res.json({ success: true, event });
  } catch (err) {
    next(err);
  }
}
