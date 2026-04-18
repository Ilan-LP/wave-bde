import { Request, Response, NextFunction } from 'express';
import * as lockService from '../services/lock.service';
import { createError } from '../middleware/errorHandler';

export async function getCode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = req.ip ?? req.socket.remoteAddress;
    const code = await lockService.getCode(req.user!.id, ip);
    res.json({ success: true, code });
  } catch (err) {
    next(err);
  }
}

export async function updateCode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = req.body as { code: string };
    if (!code) {
      throw createError('Le code est requis', 400, 'VALIDATION_ERROR');
    }
    await lockService.updateCode(code, req.user!.id);
    res.json({ success: true, message: 'Code mis à jour' });
  } catch (err) {
    next(err);
  }
}

export async function getHistory(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const logs = await lockService.getAccessHistory();
    res.json({ success: true, logs });
  } catch (err) {
    next(err);
  }
}
