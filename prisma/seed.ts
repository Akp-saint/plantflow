import { PrismaClient, Role, PaymentMethod, InventoryMovementType, RecordStatus, ProductionStatus } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

const demoAdminEmail = process.env.DEMO_ADMIN_EMAIL ?? 'admin@example.local';
const demoAdminPassword = process.env.DEMO_ADMIN_PASSWORD ?? 'change-me-demo-password';

async function main() {
  console.log('🌱 Démarrage du seed de démonstration PlantFlow...');

  // 1. Création de l'utilisateur admin de démo
  let admin = await prisma.user.findUnique({ where: { email: demoAdminEmail } });

  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: demoAdminEmail,
        name: 'Directeur Général (Démo)',
        passwordHash: hashPassword(demoAdminPassword),
      },
    });
    console.log(`✅ Utilisateur démo créé: ${demoAdminEmail} / mot de passe défini via DEMO_ADMIN_PASSWORD`);
  } else {
    console.log('ℹ️ Utilisateur démo existe déjà.');
  }
