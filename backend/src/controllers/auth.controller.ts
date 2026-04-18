import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';
import { verifyRefreshToken } from '../utils/jwt';
import { signAccessToken } from '../utils/jwt';
import { createError } from '../middleware/errorHandler';

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body as { email: string; password: string };

    if (!email || !password) {
      throw createError('Email et mot de passe requis', 400, 'VALIDATION_ERROR');
    }

    const { accessToken, refreshToken, user } = await authService.login(email, password);

    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTIONS);

    res.json({ success: true, accessToken, user });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies[REFRESH_COOKIE] as string | undefined;
    if (!token) {
      throw createError('Refresh token manquant', 401, 'UNAUTHORIZED');
    }

    const payload = verifyRefreshToken(token);
    const accessToken = signAccessToken({
      id: payload.id,
      role: payload.role,
      pole: payload.pole,
    });

    res.json({ success: true, accessToken });
  } catch (err) {
    next(createError('Refresh token invalide ou expiré', 401, 'UNAUTHORIZED'));
  }
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie(REFRESH_COOKIE);
  res.json({ success: true, message: 'Déconnecté' });
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.getMe(req.user!.id);
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
}
