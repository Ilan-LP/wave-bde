import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { createError } from './errorHandler';
import { Roles, Poles } from '@prisma/client';

export interface AuthUser {
  id: number;
  role: Roles;
  pole?: Poles;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const ROLE_HIERARCHY: Record<Roles, number> = {
  MEMBRE: 0,
  POLE_LEAD: 1,
  ADMIN: 2,
};

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw createError('Token manquant', 401, 'UNAUTHORIZED');
    }

    const token = authHeader.slice(7);
    const payload = verifyAccessToken(token);

    req.user = {
      id: payload.id,
      role: payload.role,
      pole: payload.pole,
    };

    next();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'UNAUTHORIZED') {
      next(err);
    } else {
      next(createError('Token invalide ou expiré', 401, 'UNAUTHORIZED'));
    }
  }
}

export function requireRole(...roles: Roles[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(createError('Non authentifié', 401, 'UNAUTHORIZED'));
      return;
    }

    const userLevel = ROLE_HIERARCHY[req.user.role];
    const requiredLevel = Math.min(...roles.map((r) => ROLE_HIERARCHY[r]));

    if (userLevel < requiredLevel) {
      next(createError('Accès refusé : rôle insuffisant', 403, 'FORBIDDEN'));
      return;
    }

    next();
  };
}
