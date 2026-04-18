import { v4 as uuidv4 } from 'uuid';
import prisma from '../utils/prisma';
import { createError } from '../middleware/errorHandler';
import { AvoirStatus } from '@prisma/client';

function generateAvoirCode(): string {
  const raw = uuidv4().replace(/-/g, '');
  const suffix = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  return `AV-${suffix}`;
}

async function ensureUniqueCode(): Promise<string> {
  let code = generateAvoirCode();
  for (let i = 0; i < 10; i++) {
    const existing = await prisma.avoir.findUnique({ where: { code } });
    if (!existing) return code;
    code = generateAvoirCode();
  }
  throw createError('Impossible de générer un code avoir unique', 500, 'CODE_GENERATION_FAILED');
}

export async function createAvoir(params: {
  issuedById: number;
  amountCents: number;
  reason?: string;
  issuedToId?: number;
  externalName?: string;
  externalEmail?: string;
}) {
  const { issuedById, amountCents, reason, issuedToId, externalName, externalEmail } = params;
  const code = await ensureUniqueCode();

  const avoir = await prisma.$transaction(async (tx) => {
    const created = await tx.avoir.create({
      data: { code, amountCents, issuedToId, issuedById, externalName, externalEmail, reason },
    });

    await tx.avoirLog.create({
      data: { avoirId: created.id, userId: issuedById, action: 'CREE', metadata: { amountCents, reason } },
    });

    await tx.auditLog.create({
      data: {
        userId: issuedById,
        action: 'AVOIR_CREE',
        entity: 'Avoir',
        entityId: created.id,
        metadata: { code, amountCents, issuedToId, externalName },
      },
    });

    return created;
  });

  return avoir;
}

export async function consumeAvoir(code: string, consumedById: number) {
  const avoir = await prisma.avoir.findUnique({ where: { code } });

  if (!avoir) throw createError('Avoir introuvable', 404, 'AVOIR_NOT_FOUND');

  if (avoir.status !== AvoirStatus.ACTIF) {
    throw createError(`L'avoir est ${avoir.status.toLowerCase()} et ne peut pas être consommé`, 400, 'AVOIR_NOT_ACTIVE');
  }

  if (avoir.expiresAt && avoir.expiresAt < new Date()) {
    await expireAvoir(avoir.id);
    throw createError("L'avoir a expiré", 400, 'AVOIR_EXPIRED');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.avoir.update({
      where: { id: avoir.id },
      data: { status: 'CONSOMME', consumedAt: new Date(), consumedById },
    });

    await tx.avoirLog.create({
      data: { avoirId: avoir.id, userId: consumedById, action: 'CONSOMME', metadata: { code } },
    });

    await tx.auditLog.create({
      data: { userId: consumedById, action: 'AVOIR_CONSOMME', entity: 'Avoir', entityId: avoir.id, metadata: { code } },
    });

    return result;
  });

  return updated;
}

export async function getAvoir(code: string, requesterId: number) {
  const avoir = await prisma.avoir.findUnique({
    where: { code },
    include: {
      issuedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      issuedBy: { select: { id: true, firstName: true, lastName: true } },
      consumedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (!avoir) throw createError('Avoir introuvable', 404, 'AVOIR_NOT_FOUND');

  await prisma.avoirLog.create({
    data: { avoirId: avoir.id, userId: requesterId, action: 'CONSULTE', metadata: { code } },
  });

  return avoir;
}

export async function expireAvoir(avoirId: number) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.avoir.update({
      where: { id: avoirId },
      data: { status: 'EXPIRE' },
    });

    await tx.avoirLog.create({
      data: { avoirId, userId: avoirId, action: 'EXPIRE' },
    });

    return result;
  });
}

export async function listAvoirs(filters?: { status?: AvoirStatus }) {
  return prisma.avoir.findMany({
    where: { deletedAt: null, ...(filters?.status ? { status: filters.status } : {}) },
    include: {
      issuedTo: { select: { id: true, firstName: true, lastName: true } },
      issuedBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}
