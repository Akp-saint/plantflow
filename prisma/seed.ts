import { PrismaClient, Role, PaymentMethod, InventoryMovementType, RecordStatus, ProductionStatus } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

async function main() {
  console.log('🌱 Démarrage du seed de démonstration PlantFlow...');

  // 1. Création de l'utilisateur admin de démo
  const adminEmail = 'admin@plantflow.com';
  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Directeur Général (Démo)',
        passwordHash: hashPassword('PlantFlow2026!'),
      },
    });
    console.log('✅ Utilisateur démo créé: admin@plantflow.com / PlantFlow2026!');
  } else {
    console.log('ℹ️ Utilisateur démo existe déjà.');
  }

  // 2. Création ou récupération du workspace
  let workspace = await prisma.workspace.findFirst({
    where: { members: { some: { userId: admin.id } } },
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Briqueterie du Faso (Démo)',
        members: {
          create: {
            userId: admin.id,
            role: Role.OWNER,
          },
        },
      },
    });
    console.log('✅ Workspace démo créé:', workspace.name);
  }

  // 3. Usine principale
  let plant = await prisma.plant.findFirst({
    where: { workspaceId: workspace.id },
  });

  if (!plant) {
    plant = await prisma.plant.create({
      data: {
        workspaceId: workspace.id,
        name: 'Usine Principale Ouagadougou',
        city: 'Ouagadougou',
        address: 'Zone Industrielle de Kossodo, Secteur 24',
        currency: 'XOF',
      },
    });

    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId: workspace.id, userId: admin.id },
    });
    if (member) {
      await prisma.plantMember.create({
        data: { plantId: plant.id, memberId: member.id },
      });
    }
    console.log('✅ Usine démo créée:', plant.name);
  }

  // 4. Formats de briques
  const briquesData = [
    { name: 'Brique Creuse 15', dimensions: '15 × 20 × 40 cm' },
    { name: 'Brique Pleine 10', dimensions: '10 × 20 × 40 cm' },
    { name: 'Pavé Autobloquant 6cm', dimensions: '20 × 10 × 6 cm' },
    { name: 'Hourdis 16', dimensions: '16 × 20 × 50 cm' },
  ];

  const brickSizes: Record<string, any> = {};
  for (const b of briquesData) {
    let size = await prisma.brickSize.findFirst({
      where: { workspaceId: workspace.id, name: b.name },
    });
    if (!size) {
      size = await prisma.brickSize.create({
        data: {
          workspaceId: workspace.id,
          name: b.name,
          dimensions: b.dimensions,
          unit: 'u',
          active: true,
        },
      });
    }
    brickSizes[b.name] = size;
  }
  console.log('✅ Formats de briques configurés.');

  // 5. Matières premières
  const matData = [
    { name: 'Ciment CPJ 42.5', category: 'Liant', unit: 'sac (50kg)', lowStockAt: 50 },
    { name: 'Sable fin de fleuve', category: 'Granulats', unit: 'm³', lowStockAt: 15 },
    { name: 'Gravier 5/15', category: 'Granulats', unit: 'm³', lowStockAt: 20 },
    { name: 'Adjuvant hydrofuge', category: 'Chimie', unit: 'litre', lowStockAt: 10 },
  ];

  const materials: Record<string, any> = {};
  for (const m of matData) {
    let mat = await prisma.material.findFirst({
      where: { workspaceId: workspace.id, name: m.name },
    });
    if (!mat) {
      mat = await prisma.material.create({
        data: {
          workspaceId: workspace.id,
          name: m.name,
          category: m.category,
          unit: m.unit,
          lowStockAt: m.lowStockAt,
          active: true,
        },
      });
    }
    materials[m.name] = mat;
  }
  console.log('✅ Matières premières configurées.');

  // 6. Recette / Formule pour la Brique Creuse 15
  let recipe = await prisma.recipe.findFirst({
    where: { workspaceId: workspace.id, brickSizeId: brickSizes['Brique Creuse 15'].id },
  });

  if (!recipe) {
    recipe = await prisma.recipe.create({
      data: {
        workspaceId: workspace.id,
        brickSizeId: brickSizes['Brique Creuse 15'].id,
        name: 'Dosage Standard 350kg/m³',
        items: {
          create: [
            { materialId: materials['Ciment CPJ 42.5'].id, quantity: 0.035 }, // 35 sacs pour 1000 briques
            { materialId: materials['Sable fin de fleuve'].id, quantity: 0.0025 },
            { materialId: materials['Gravier 5/15'].id, quantity: 0.0018 },
          ],
        },
      },
    });
    console.log('✅ Recette de dosage configurée.');
  }

  // 7. Compte de caisse
  let cashAccount = await prisma.cashAccount.findFirst({
    where: { workspaceId: workspace.id, plantId: plant.id, name: 'Caisse Principale Usine' },
  });

  if (!cashAccount) {
    cashAccount = await prisma.cashAccount.create({
      data: {
        workspaceId: workspace.id,
        plantId: plant.id,
        name: 'Caisse Principale Usine',
        openingBalance: 1500000,
        active: true,
      },
    });
    console.log('✅ Compte de caisse créé avec solde initial.');
  }

  // 8. Clients
  const clientsData = [
    { name: 'BTP Faso Construction SARL', phone: '+226 70 20 30 40', email: 'contact@btpfaso.bf', address: 'Ouaga 2000' },
    { name: 'Entreprise Savane Bâtiment', phone: '+226 76 11 22 33', email: 'savane.bat@fasonet.bf', address: 'Gounghin' },
    { name: 'Oumarou Sawadogo (Particulier)', phone: '+226 78 55 44 33', address: 'Karpala Secteur 51' },
  ];

  const customers: any[] = [];
  for (const c of clientsData) {
    let cust = await prisma.customer.findFirst({
      where: { workspaceId: workspace.id, plantId: plant.id, name: c.name },
    });
    if (!cust) {
      cust = await prisma.customer.create({
        data: {
          workspaceId: workspace.id,
          plantId: plant.id,
          name: c.name,
          phone: c.phone,
          email: c.email || null,
          address: c.address,
        },
      });
    }
    customers.push(cust);
  }

  // 9. Fournisseurs
  const vendorsData = [
    { name: 'Cimburkina SA (Cimenterie)', phone: '+226 25 30 11 22', address: 'Zone Industrielle Kossodo' },
    { name: 'Carrière des Granulats du Sahel', phone: '+226 70 99 88 77', address: 'Pabré' },
  ];

  const vendors: any[] = [];
  for (const v of vendorsData) {
    let vend = await prisma.vendor.findFirst({
      where: { workspaceId: workspace.id, plantId: plant.id, name: v.name },
    });
    if (!vend) {
      vend = await prisma.vendor.create({
        data: {
          workspaceId: workspace.id,
          plantId: plant.id,
          name: v.name,
          phone: v.phone,
          address: v.address,
        },
      });
    }
    vendors.push(vend);
  }

  // 10. Ouvriers
  const workersData = [
    { name: 'Moussa Kaboré', jobTitle: 'Chef Équipe Presse' },
    { name: 'Seydou Traoré', jobTitle: 'Opérateur Malaxeur' },
    { name: 'Issouf Diallo', jobTitle: 'Manutentionnaire / Empileur' },
  ];

  for (const w of workersData) {
    let worker = await prisma.worker.findFirst({
      where: { workspaceId: workspace.id, plantId: plant.id, name: w.name },
    });
    if (!worker) {
      await prisma.worker.create({
        data: {
          workspaceId: workspace.id,
          plantId: plant.id,
          name: w.name,
          jobTitle: w.jobTitle,
          phone: '+226 70 00 00 00',
        },
      });
    }
  }

  // 11. Stocks initiaux (Mouvements d'ajustement pour briques et matières)
  const existingMovements = await prisma.inventoryMovement.count({
    where: { workspaceId: workspace.id, plantId: plant.id },
  });

  if (existingMovements === 0) {
    // Stock initial briques
    await prisma.inventoryMovement.createMany({
      data: [
        {
          workspaceId: workspace.id,
          plantId: plant.id,
          brickSizeId: brickSizes['Brique Creuse 15'].id,
          type: InventoryMovementType.ADJUSTMENT,
          quantity: 4500,
          reason: 'Inventaire d’ouverture démonstration',
          createdById: admin.id,
        },
        {
          workspaceId: workspace.id,
          plantId: plant.id,
          brickSizeId: brickSizes['Brique Pleine 10'].id,
          type: InventoryMovementType.ADJUSTMENT,
          quantity: 2800,
          reason: 'Inventaire d’ouverture démonstration',
          createdById: admin.id,
        },
        {
          workspaceId: workspace.id,
          plantId: plant.id,
          brickSizeId: brickSizes['Pavé Autobloquant 6cm'].id,
          type: InventoryMovementType.ADJUSTMENT,
          quantity: 6000,
          reason: 'Inventaire d’ouverture démonstration',
          createdById: admin.id,
        },
        // Stock initial matières premières
        {
          workspaceId: workspace.id,
          plantId: plant.id,
          materialId: materials['Ciment CPJ 42.5'].id,
          type: InventoryMovementType.ADJUSTMENT,
          quantity: 420,
          reason: 'Inventaire matières d’ouverture',
          createdById: admin.id,
        },
        {
          workspaceId: workspace.id,
          plantId: plant.id,
          materialId: materials['Sable fin de fleuve'].id,
          type: InventoryMovementType.ADJUSTMENT,
          quantity: 85,
          reason: 'Inventaire matières d’ouverture',
          createdById: admin.id,
        },
        {
          workspaceId: workspace.id,
          plantId: plant.id,
          materialId: materials['Gravier 5/15'].id,
          type: InventoryMovementType.ADJUSTMENT,
          quantity: 60,
          reason: 'Inventaire matières d’ouverture',
          createdById: admin.id,
        },
      ],
    });
    console.log('✅ Stocks initiaux injectés.');
  }

  // 12. Vente de démonstration
  const existingSales = await prisma.sale.count({
    where: { workspaceId: workspace.id, plantId: plant.id },
  });

  if (existingSales === 0) {
    const saleDate = new Date();
    const qty = 1200;
    const unitPrice = 350;
    const totalAmount = qty * unitPrice; // 420,000 XOF
    const paidAmount = 300000;

    const sale = await prisma.sale.create({
      data: {
        workspaceId: workspace.id,
        plantId: plant.id,
        customerId: customers[0].id,
        invoiceNumber: `FAC-DEMO-${new Date().getFullYear()}-001`,
        saleDate,
        totalAmount,
        status: RecordStatus.POSTED,
        notes: 'Commande Chantier Immeuble R+3 - Livraison par camion benne 1',
        createdById: admin.id,
        items: {
          create: {
            brickSizeId: brickSizes['Brique Creuse 15'].id,
            quantity: qty,
            unitPrice,
            lineTotal: totalAmount,
          },
        },
        payments: {
          create: {
            amount: paidAmount,
            method: PaymentMethod.CASH,
            cashAccountId: cashAccount.id,
            note: 'Acompte 70% reçu en espèces à la commande',
            receivedById: admin.id,
          },
        },
      },
    });

    // Mouvement de stock de sortie pour la vente
    await prisma.inventoryMovement.create({
      data: {
        workspaceId: workspace.id,
        plantId: plant.id,
        brickSizeId: brickSizes['Brique Creuse 15'].id,
        type: InventoryMovementType.SALE,
        quantity: -qty,
        reason: `Vente ${sale.invoiceNumber}`,
        referenceType: 'SALE',
        referenceId: sale.id,
        createdById: admin.id,
      },
    });

    console.log('✅ Vente de démonstration avec acompte créée:', sale.invoiceNumber);
  }

  console.log('🎉 Seed de démonstration terminé avec succès !');
}

main()
  .catch((e) => {
    console.error('❌ Erreur lors du seed :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
