import jwt from 'jsonwebtoken';
import { Roles, Poles } from '@prisma/client';

export interface JwtPayload {
  id: number;
  role: Roles;
  pole?: Poles;
}

function getSecret(key: string): string {
  const secret = process.env[key];
  if (!secret) throw new Error(`Variable d'environnement manquante : ${key}`);
  return secret;
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, getSecret('JWT_SECRET'), {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '15m') as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, getSecret('JWT_REFRESH_SECRET'), {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret('JWT_SECRET')) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret('JWT_REFRESH_SECRET')) as JwtPayload;
}
