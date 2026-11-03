import { Prisma, ProductionStatus, InventoryMovementType } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { audit, contextOf, currentBrickBalance, currentMaterialBalance, operationalRoles, parseBody, parseDateBound, pagination, allowRoles } from '../http';
import { requirePlant } from '../scope';
import { ApiError } from '../http';

export const productionRouter = Router();
productionRouter.use(requirePlant);

productionRouter.get('/production-entries', async (request, response, next) => {
  try {
    const c = contextOf(request);
    const from = parseDateBound(request.query.from);
    const to = parseDateBound(request.query.to, true);
    if (from && to && from > to) throw new ApiError(400, 'INVALID_DATE_RANGE', 'La date from doit être antérieure ou égale à to.');
    const rows = await prisma.productionEntry.findMany({
      where: { workspaceId: c.workspaceId, plantId: c.plantId!, ...(from && !Number.isNaN(from.getTime()) ? { productionDate: { gte: from } } : {}), ...(to && !Number.isNaN(to.getTime()) ? { productionDate: { lte: to } } : {}) },
      include: { brickSize: true, recipe: true }, orderBy: [{ productionDate: 'desc' }, { createdAt: 'desc' }], ...pagination(request),
    });
    const visibleRows = c.role === 'STAFF' ? rows.map((row) => { const { labourCost, ...safe } = row; void labourCost; return safe; }) : rows;
    response.json({ data: visibleRows });
  } catch (error) { next(error); }
});

const productionInput = z.object({
  productionDate: z.coerce.date(),
  brickSizeId: z.string().uuid(),
  quantityProduced: z.coerce.number().int().positive().max(10000000),
  quantityDamaged: z.coerce.number().int().min(0).default(0),
  recipeId: z.string().uuid().optional().nullable(),
  labourCost: z.coerce.number().min(0).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
}).refine((value) => value.quantityDamaged <= value.quantityProduced, { path: ['quantityDamaged'], message: 'La quantité endommagée ne peut dépasser la quantité produite.' });

productionRouter.post('/production-entries', allowRoles(...operationalRoles), async (request, response, next) => {
  const input = parseBody(request, response, productionInput);
  if (!input) return;
  try {
    const c = contextOf(request);
    if (c.role === 'STAFF' && input.labourCost !== undefined) throw new ApiError(403, 'ROLE_FORBIDDEN', 'Votre rôle ne permet pas d’enregistrer un coût de main-d’œuvre.');
    const [brickSize, recipe] = await Promise.all([
      prisma.brickSize.findFirst({ where: { id: input.brickSizeId, workspaceId: c.workspaceId, active: true } }),
      input.recipeId ? prisma.recipe.findFirst({ where: { id: input.recipeId, workspaceId: c.workspaceId, active: true }, include: { items: { include: { material: true } } } }) : Promise.resolve(null),
    ]);
    if (!brickSize) throw new ApiError(404, 'BRICK_SIZE_NOT_FOUND', 'Format de brique introuvable ou inactif.');
    if (input.recipeId && (!recipe || recipe.brickSizeId !== brickSize.id)) throw new ApiError(400, 'RECIPE_MISMATCH', 'La recette ne correspond pas au format de brique.');

    const created = await prisma.$transaction(async (tx) => {
      if (recipe) {
        for (const item of recipe.items) {
          const required = Number(item.quantity) * input.quantityProduced;
          const available = await currentMaterialBalance(tx, c.workspaceId, c.plantId!, item.materialId);
          if (available < required) throw new ApiError(409, 'INSUFFICIENT_MATERIAL_STOCK', `Stock insuffisant pour ${item.material.name}.`, { required, available, unit: item.material.unit });
        }
      }
      const entry = await tx.productionEntry.create({ data: {
        workspaceId: c.workspaceId,
        plantId: c.plantId!,
        brickSizeId: brickSize.id,
        recipeId: recipe?.id,
        productionDate: input.productionDate,
        quantityProduced: input.quantityProduced,
        quantityDamaged: input.quantityDamaged,
        labourCost: input.labourCost,
        notes: input.notes,
        createdById: c.userId,
        status: ProductionStatus.VALIDATED,
      } });
      const movements: Array<Prisma.InventoryMovementCreateManyInput> = [{
        workspaceId: c.workspaceId, plantId: c.plantId!, brickSizeId: brickSize.id,
        type: InventoryMovementType.PRODUCTION_OUTPUT, quantity: new Prisma.Decimal(input.quantityProduced),
        referenceType: 'ProductionEntry', referenceId: entry.id, productionId: entry.id, createdById: c.userId,
        reason: `Production ${entry.id}`,
      }];
      if (input.quantityDamaged > 0) movements.push({
        workspaceId: c.workspaceId, plantId: c.plantId!, brickSizeId: brickSize.id,
        type: InventoryMovementType.DAMAGE, quantity: new Prisma.Decimal(-input.quantityDamaged),
        referenceType: 'ProductionEntry', referenceId: entry.id, productionId: entry.id, createdById: c.userId,
        reason: 'Briques endommagées à la production',
      });
      if (recipe) for (const item of recipe.items) movements.push({
        workspaceId: c.workspaceId, plantId: c.plantId!, materialId: item.materialId,
        type: InventoryMovementType.PRODUCTION_CONSUMPTION,
        quantity: item.quantity.mul(-input.quantityProduced), referenceType: 'ProductionEntry', referenceId: entry.id,
        productionId: entry.id, createdById: c.userId, reason: `Consommation selon ${recipe.name}`,
      });
      await tx.inventoryMovement.createMany({ data: movements });
      await audit(tx, c, 'production.created', 'ProductionEntry', entry.id, { quantityProduced: input.quantityProduced, quantityDamaged: input.quantityDamaged, recipeId: recipe?.id });
      return { entry, movements };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (c.role === 'STAFF') {
      const { labourCost, ...visibleEntry } = created.entry;
      void labourCost;
      response.status(201).json({ data: { ...created, entry: visibleEntry } });
      return;
    }
    response.status(201).json({ data: created });
  } catch (error) { next(error); }
});

productionRouter.get('/production/ledger', async (request, response, next) => {
  try {
    const c = contextOf(request);
    const rows = await prisma.productionEntry.findMany({ where: { workspaceId: c.workspaceId, plantId: c.plantId! }, include: { brickSize: true, recipe: true }, orderBy: { productionDate: 'desc' }, ...pagination(request) });
    const visibleRows = c.role === 'STAFF' ? rows.map((row) => { const { labourCost, ...safe } = row; void labourCost; return safe; }) : rows;
    response.json({ data: visibleRows });
  } catch (error) { next(error); }
});

productionRouter.get('/inventory/summary', async (request, response, next) => {
  try {
    const c = contextOf(request);
    const [materials, sizes, materialMovements, brickMovements] = await Promise.all([
      prisma.material.findMany({ where: { workspaceId: c.workspaceId, active: true }, orderBy: { name: 'asc' } }),
      prisma.brickSize.findMany({ where: { workspaceId: c.workspaceId, active: true }, orderBy: { name: 'asc' } }),
      prisma.inventoryMovement.groupBy({ by: ['materialId'], where: { workspaceId: c.workspaceId, plantId: c.plantId!, materialId: { not: null } }, _sum: { quantity: true } }),
      prisma.inventoryMovement.groupBy({ by: ['brickSizeId'], where: { workspaceId: c.workspaceId, plantId: c.plantId!, brickSizeId: { not: null } }, _sum: { quantity: true } }),
    ]);
    const materialBalance = new Map(materialMovements.map((row) => [row.materialId!, Number(row._sum.quantity ?? 0)]));
    const brickBalance = new Map(brickMovements.map((row) => [row.brickSizeId!, Number(row._sum.quantity ?? 0)]));
    response.json({ data: {
      materials: materials.map((material) => ({ ...material, onHand: materialBalance.get(material.id) ?? 0, lowStock: (materialBalance.get(material.id) ?? 0) <= Number(material.lowStockAt) })),
      finishedGoods: sizes.map((size) => ({ ...size, onHand: brickBalance.get(size.id) ?? 0 })),
    } });
  } catch (error) { next(error); }
});

productionRouter.get('/inventory/movements', async (request, response, next) => {
  try {
    const c = contextOf(request);
    const materialId = typeof request.query.materialId === 'string' ? request.query.materialId : undefined;
    const brickSizeId = typeof request.query.brickSizeId === 'string' ? request.query.brickSizeId : undefined;
    const rows = await prisma.inventoryMovement.findMany({
      where: { workspaceId: c.workspaceId, plantId: c.plantId!, ...(materialId ? { materialId } : {}), ...(brickSizeId ? { brickSizeId } : {}), ...(request.query.type ? { type: String(request.query.type) as InventoryMovementType } : {}) },
      include: { material: true, brickSize: true }, orderBy: { createdAt: 'desc' }, ...pagination(request),
    });
    response.json({ data: rows });
  } catch (error) { next(error); }
});

productionRouter.post('/inventory/adjustments', allowRoles('OWNER', 'MANAGER'), async (request, response, next) => {
  const input = parseBody(request, response, z.object({ materialId: z.string().uuid().optional(), brickSizeId: z.string().uuid().optional(), quantity: z.coerce.number().refine((n) => n !== 0), reason: z.string().trim().min(4).max(500) }).refine((value) => Boolean(value.materialId) !== Boolean(value.brickSizeId), { message: 'Choisissez soit une matière, soit un format de brique.' }));
  if (!input) return;
  try {
    const c = contextOf(request);
    const result = await prisma.$transaction(async (tx) => {
      if (input.materialId) {
        const material = await tx.material.findFirst({ where: { id: input.materialId, workspaceId: c.workspaceId, active: true } });
        if (!material) throw new ApiError(404, 'MATERIAL_NOT_FOUND');
        const next = await currentMaterialBalance(tx, c.workspaceId, c.plantId!, material.id) + input.quantity;
        if (next < 0) throw new ApiError(409, 'NEGATIVE_STOCK', 'Un ajustement ne peut pas rendre le stock négatif.', { available: next - input.quantity });
      } else {
        const size = await tx.brickSize.findFirst({ where: { id: input.brickSizeId!, workspaceId: c.workspaceId, active: true } });
        if (!size) throw new ApiError(404, 'BRICK_SIZE_NOT_FOUND');
        const next = await currentBrickBalance(tx, c.workspaceId, c.plantId!, size.id) + input.quantity;
        if (next < 0) throw new ApiError(409, 'NEGATIVE_STOCK', 'Un ajustement ne peut pas rendre le stock négatif.', { available: next - input.quantity });
      }
      const movement = await tx.inventoryMovement.create({ data: {
        workspaceId: c.workspaceId, plantId: c.plantId!, materialId: input.materialId, brickSizeId: input.brickSizeId,
        type: InventoryMovementType.ADJUSTMENT, quantity: new Prisma.Decimal(input.quantity), reason: input.reason,
        createdById: c.userId, referenceType: 'InventoryAdjustment',
      } });
      await audit(tx, c, 'inventory.adjusted', 'InventoryMovement', movement.id, { reason: input.reason, quantity: input.quantity });
      return movement;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    response.status(201).json({ data: result });
  } catch (error) { next(error); }
});
