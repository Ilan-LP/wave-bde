import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { createError } from '../middleware/errorHandler';
import { ShiftStatus, ShiftType } from '@prisma/client';

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const type = (req.query.type as ShiftType) ?? 'BUVETTE';
    const shifts = await prisma.shift.findMany({
      where: { deletedAt: null, type },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { date: 'asc' },
    });
    res.json({ success: true, shifts });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { date, startTime, endTime, userId, note, type } = req.body as {
      date: string; startTime: string; endTime: string; userId?: number; note?: string; type?: ShiftType;
    };

    if (!date || !startTime || !endTime) {
      throw createError('date, startTime et endTime sont requis', 400, 'VALIDATION_ERROR');
    }

    const shift = await prisma.shift.create({
      data: { date: new Date(date), startTime, endTime, userId, note, type: type ?? 'BUVETTE' },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });

    res.status(201).json({ success: true, shift });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const { status, userId, note } = req.body as {
      status?: ShiftStatus; userId?: number | null; note?: string;
    };

    const shift = await prisma.shift.update({
      where: { id },
      data: { status, userId, note },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });

    res.json({ success: true, shift });
  } catch (err) {
    next(err);
  }
}

export async function claim(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.shift.findUnique({ where: { id } });
    if (!existing) throw createError('Créneau introuvable', 404, 'NOT_FOUND');
    if (existing.status !== 'OUVERT') throw createError('Ce créneau n\'est plus disponible', 400, 'NOT_AVAILABLE');

    const shift = await prisma.shift.update({
      where: { id },
      data: { userId: req.user!.id, status: 'ASSIGNE' },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });

    res.json({ success: true, shift });
  } catch (err) {
    next(err);
  }
}

export async function requestExchange(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { targetId, fromShiftId, toShiftId } = req.body as {
      targetId: number; fromShiftId: number; toShiftId: number;
    };

    if (!targetId || !fromShiftId || !toShiftId) {
      throw createError('targetId, fromShiftId et toShiftId sont requis', 400, 'VALIDATION_ERROR');
    }

    const exchange = await prisma.shiftExchange.create({
      data: { requesterId: req.user!.id, targetId, fromShiftId, toShiftId },
    });

    res.status(201).json({ success: true, exchange });
  } catch (err) {
    next(err);
  }
}
