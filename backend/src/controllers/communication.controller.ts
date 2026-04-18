import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { createError } from '../middleware/errorHandler';
import { Platform, PostStatus } from '@prisma/client';

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const posts = await prisma.communicationPost.findMany({
      where: { deletedAt: null },
      include: {
        responsible: { select: { id: true, firstName: true, lastName: true } },
        event: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, posts });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { platform, title, caption, scheduledAt, eventId } = req.body as {
      platform: Platform;
      title: string;
      caption?: string;
      scheduledAt?: string;
      eventId?: number;
    };

    if (!platform || !title) throw createError('platform et title sont requis', 400, 'VALIDATION_ERROR');

    const post = await prisma.communicationPost.create({
      data: {
        platform,
        title,
        caption,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        eventId,
        responsibleId: req.user!.id,
      },
    });

    res.status(201).json({ success: true, post });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const { title, caption, status, scheduledAt, publishedAt } = req.body as {
      title?: string;
      caption?: string;
      status?: PostStatus;
      scheduledAt?: string;
      publishedAt?: string;
    };

    const post = await prisma.communicationPost.update({
      where: { id },
      data: {
        title,
        caption,
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        publishedAt: publishedAt ? new Date(publishedAt) : undefined,
      },
    });

    res.json({ success: true, post });
  } catch (err) {
    next(err);
  }
}
