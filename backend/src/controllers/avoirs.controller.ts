import { Request, Response, NextFunction } from 'express';
import QRCode from 'qrcode';
import * as avoirsService from '../services/avoirs.service';
import { createError } from '../middleware/errorHandler';
import { AvoirStatus } from '@prisma/client';

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = req.query.status as AvoirStatus | undefined;
    const avoirs = await avoirsService.listAvoirs(status ? { status } : undefined);
    res.json({ success: true, avoirs });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { issuedToId, amountCents, reason, externalName, externalEmail } = req.body as {
      issuedToId?: number;
      amountCents: number;
      reason?: string;
      externalName?: string;
      externalEmail?: string;
    };

    if (!amountCents || amountCents <= 0) {
      throw createError('amountCents (> 0) est requis', 400, 'VALIDATION_ERROR');
    }

    if (!issuedToId && !externalName) {
      throw createError('issuedToId ou externalName est requis', 400, 'VALIDATION_ERROR');
    }

    const avoir = await avoirsService.createAvoir({
      issuedById: req.user!.id,
      amountCents,
      reason,
      issuedToId,
      externalName,
      externalEmail,
    });

    res.status(201).json({ success: true, avoir });
  } catch (err) {
    next(err);
  }
}

export async function getByCode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = req.params;
    const avoir = await avoirsService.getAvoir(code, req.user!.id);
    res.json({ success: true, avoir });
  } catch (err) {
    next(err);
  }
}

export async function consume(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = req.body as { code: string };
    if (!code) throw createError('Le code avoir est requis', 400, 'VALIDATION_ERROR');
    const avoir = await avoirsService.consumeAvoir(code, req.user!.id);
    res.json({ success: true, avoir });
  } catch (err) {
    next(err);
  }
}

export async function getQRCode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = req.params;
    const png = await QRCode.toBuffer(code, { type: 'png', width: 300, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (err) {
    next(err);
  }
}
