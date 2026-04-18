import { Request, Response, NextFunction } from 'express';
import path from 'path';
import prisma from '../utils/prisma';
import { createError } from '../middleware/errorHandler';
import { hashPassword } from '../services/auth.service';
import { Roles, Poles } from '@prisma/client';

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, pole: true, photoUrl: true, isActive: true, isPublic: true, createdAt: true,
      },
      orderBy: { lastName: 'asc' },
    });
    res.json({ success: true, users });
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, pole: true, photoUrl: true, bio: true, isActive: true, isPublic: true, createdAt: true,
        memberNotes: {
          where: { deletedAt: null },
          include: { author: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });

    if (!user) throw createError('Utilisateur introuvable', 404, 'NOT_FOUND');
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, firstName, lastName, role, pole } = req.body as {
      email: string; password: string; firstName: string; lastName: string; role: Roles; pole?: Poles;
    };

    if (!email || !password || !firstName || !lastName || !role) {
      throw createError('Champs requis manquants', 400, 'VALIDATION_ERROR');
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash, firstName, lastName, role, pole },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, pole: true },
    });

    res.status(201).json({ success: true, user });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    const { firstName, lastName, pole, bio, isActive, isPublic } = req.body as {
      firstName?: string; lastName?: string; pole?: Poles; bio?: string; isActive?: boolean; isPublic?: boolean;
    };

    const user = await prisma.user.update({
      where: { id },
      data: { firstName, lastName, pole, bio, isActive, isPublic },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, pole: true },
    });

    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
}

export async function softDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);
    await prisma.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    res.json({ success: true, message: 'Membre archivé' });
  } catch (err) {
    next(err);
  }
}

export async function uploadPhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = Number(req.params.id);

    if (req.user!.id !== id && req.user!.role !== 'ADMIN') {
      throw createError('Accès refusé', 403, 'FORBIDDEN');
    }

    if (!req.file) throw createError('Aucun fichier fourni', 400, 'NO_FILE');

    const photoUrl = `/uploads/photos/${path.basename(req.file.path)}`;
    const user = await prisma.user.update({
      where: { id },
      data: { photoUrl },
      select: { id: true, photoUrl: true },
    });

    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
}
