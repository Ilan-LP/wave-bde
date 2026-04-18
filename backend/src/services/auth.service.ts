import bcrypt from 'bcrypt';
import prisma from '../utils/prisma';
import { signAccessToken, signRefreshToken, JwtPayload } from '../utils/jwt';
import { createError } from '../middleware/errorHandler';

const BCRYPT_COST = 12;

export async function login(email: string, password: string): Promise<{
  accessToken: string;
  refreshToken: string;
  user: {
    id: number;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    pole: string | null;
    photoUrl: string | null;
  };
}> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      pole: true,
      photoUrl: true,
      passwordHash: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) {
    throw createError('Identifiants invalides', 401, 'INVALID_CREDENTIALS');
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    throw createError('Identifiants invalides', 401, 'INVALID_CREDENTIALS');
  }

  const payload: JwtPayload = {
    id: user.id,
    role: user.role,
    pole: user.pole ?? undefined,
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  const { passwordHash: _, ...safeUser } = user;

  return { accessToken, refreshToken, user: safeUser };
}

export async function getMe(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      pole: true,
      photoUrl: true,
      bio: true,
      isActive: true,
      isPublic: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw createError('Utilisateur introuvable', 404, 'NOT_FOUND');
  }

  return user;
}

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}
