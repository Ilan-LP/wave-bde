import { PrismaClient, Roles, Poles } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const firstName = process.env.ADMIN_FIRST_NAME ?? 'Admin';
  const lastName = process.env.ADMIN_LAST_NAME ?? 'BDE';

  if (!email || !password) {
    throw new Error(
      'ADMIN_EMAIL et ADMIN_PASSWORD sont requis pour seeder le compte admin. ' +
      'Vérifiez votre fichier .env.'
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`Compte admin déjà existant : ${email} — seed ignoré.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName,
      lastName,
      role: Roles.ADMIN,
      pole: Poles.BUREAU,
      isActive: true,
      isPublic: false,
    },
  });

  console.log(`Compte admin créé : ${admin.email} (id=${admin.id})`);
}

main()
  .catch((err) => {
    console.error('Seed échoué :', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
