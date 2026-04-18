import crypto from 'crypto';
import prisma from '../utils/prisma';
import { createError } from '../middleware/errorHandler';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.LOCK_CODE_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw createError('Clé de chiffrement de la serrure manquante ou trop courte', 500, 'CONFIG_ERROR');
  }
  return Buffer.from(key.slice(0, 32), 'utf8');
}

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(stored: string): string {
  const [ivHex, encryptedHex] = stored.split(':');
  if (!ivHex || !encryptedHex) {
    throw createError('Format du code chiffré invalide', 500, 'DECRYPT_ERROR');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const encryptedText = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  return decrypted.toString('utf8');
}

export async function getCode(userId: number, ipAddress?: string): Promise<string> {
  const record = await prisma.lockCode.findFirst({ where: { id: 1 } });

  if (!record) {
    throw createError('Aucun code de serrure configuré', 404, 'LOCK_NOT_CONFIGURED');
  }

  const code = decrypt(record.code);

  await prisma.lockAccessLog.create({
    data: {
      userId,
      ipAddress: ipAddress ?? null,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: 'LOCK_CODE_CONSULTE',
      entity: 'LockCode',
      entityId: 1,
      metadata: { ipAddress },
    },
  });

  return code;
}

export async function updateCode(newCode: string, updatedById: number): Promise<void> {
  if (!newCode || newCode.trim().length === 0) {
    throw createError('Le code ne peut pas être vide', 400, 'VALIDATION_ERROR');
  }

  const encrypted = encrypt(newCode.trim());

  await prisma.$transaction(async (tx) => {
    await tx.lockCode.upsert({
      where: { id: 1 },
      update: { code: encrypted, updatedById },
      create: { id: 1, code: encrypted, updatedById },
    });

    await tx.auditLog.create({
      data: {
        userId: updatedById,
        action: 'LOCK_CODE_MODIFIE',
        entity: 'LockCode',
        entityId: 1,
      },
    });
  });
}

export async function getAccessHistory() {
  return prisma.lockAccessLog.findMany({
    orderBy: { accessedAt: 'desc' },
    take: 100,
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}
