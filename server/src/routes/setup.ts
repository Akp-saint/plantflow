import { Router } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { allowRoles, financeRoles, managementRoles, parseBody, userIdOf, contextOf, pagination, audit, routeParam } from '../http';
import { requirePlant, requireWorkspace, type ScopedRequest } from '../scope';

export const workspaceRouter = Router();

workspaceRouter.get('/', async (request, response, next) => {
  try {
    const userId = userIdOf(request);
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: { include: { plants: { orderBy: { createdAt: 'asc' } } } }, plantAccess: { select: { plantId: true } } },
      orderBy: { workspace: { createdAt: 'asc' } },
    });
    response.json({ data: memberships.map((item) => {
      const allowedPlantIds = item.role === 'OWNER' || item.role === 'MANAGER'
        ? item.workspace.plants.map((plant) => plant.id)
        : item.plantAccess.map((access) => access.plantId);
      return { id: item.workspace.id, name: item.workspace.name, role: item.role, plants: item.workspace.plants.filter((plant) => allowedPlantIds.includes(plant.id)), allowedPlantIds };
    }) });
  } catch (error) { next(error); }
});

workspaceRouter.post('/', async (request, response, next) => {
  const input = parseBody(request, response, z.object({
    name: z.string().trim().min(2).max(120),
    plantName: z.string().trim().min(2).max(120),
    city: z.string().trim().max(120).optional().nullable(),
    address: z.string().trim().max(300).optional().nullable(),
    currency: z.string().trim().length(3).default('XOF'),
    brickSizeName: z.string().trim().min(2).max(80).default('Brique standard'),
    brickDimensions: z.string().trim().min(3).max(80).default('230 × 110 × 75 mm'),
  }));
  if (!input) return;
  try {
    const userId = userIdOf(request);
    const result = await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({ data: { name: input.name } });
      const membership = await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId, role: 'OWNER' } });
      const plant = await tx.plant.create({ data: {
        workspaceId: workspace.id,
        name: input.plantName,
        city: input.city || undefined,
        address: input.address || undefined,
        currency: input.currency.toUpperCase(),
      } });
      await tx.brickSize.create({ data: { workspaceId: workspace.id, name: input.brickSizeName, dimensions: input.brickDimensions, unit: 'u' } });
      await tx.cashAccount.create({ data: { workspaceId: workspace.id, plantId: plant.id, name: 'Caisse principale' } });
      await tx.expenseCategory.createMany({ data: ['Personnel', 'Maintenance', 'Transport', 'Énergie', 'Autre'].map((name) => ({ workspaceId: workspace.id, name })) });
      await tx.auditLog.create({ data: { workspaceId: workspace.id, userId, action: 'workspace.created', entity: 'Workspace', entityId: workspace.id } });
      return { workspace, plant, membership };
    });
    response.status(201).json({ data: { ...result.workspace, plants: [result.plant], role: result.membership.role } });
  } catch (error) { next(error); }
});

export const setupRouter = Router();
setupRouter.use(requireWorkspace);

setupRouter.get('/plants', async (request, response, next) => {
  try {
    const context = contextOf(request);
    const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: context.workspaceId, userId: context.userId } } });
    const allowed = context.role === 'OWNER' || context.role === 'MANAGER'
      ? undefined
      : { members: { some: { memberId: member?.id } } };
    const plants = await prisma.plant.findMany({ where: { workspaceId: context.workspaceId, ...allowed }, orderBy: { name: 'asc' } });
    response.json({ data: plants });
  } catch (error) { next(error); }
});

setupRouter.post('/plants', allowRoles(...managementRoles), async (request, response, next) => {
  const input = parseBody(request, response, z.object({ name: z.string().trim().min(2).max(120), city: z.string().trim().max(120).optional(), address: z.string().trim().max(300).optional(), currency: z.string().length(3).default('XOF') }));
  if (!input) return;
  try {
    const context = contextOf(request);
    const result = await prisma.$transaction(async (tx) => {
      const plant = await tx.plant.create({ data: { ...input, workspaceId: context.workspaceId, currency: input.currency.toUpperCase() } });
      await tx.cashAccount.create({ data: { workspaceId: context.workspaceId, plantId: plant.id, name: 'Caisse principale' } });
      await audit(tx, context, 'plant.created', 'Plant', plant.id, { name: plant.name });
      return plant;
    });
    response.status(201).json({ data: result });
  } catch (error) { next(error); }
});

setupRouter.patch('/plants/:id', allowRoles(...managementRoles), async (request, response, next) => {
  const input = parseBody(request, response, z.object({ name: z.string().trim().min(2).max(120).optional(), city: z.string().trim().max(120).nullable().optional(), address: z.string().trim().max(300).nullable().optional(), currency: z.string().length(3).optional() }));
  if (!input) return;
  try {
    const context = contextOf(request);
    const found = await prisma.plant.findFirst({ where: { id: routeParam(request, 'id'), workspaceId: context.workspaceId } });
    if (!found) { response.status(404).json({ error: 'PLANT_NOT_FOUND' }); return; }
    const plant = await prisma.plant.update({ where: { id: found.id }, data: { ...input, currency: input.currency?.toUpperCase() } });
    await prisma.auditLog.create({ data: { workspaceId: context.workspaceId, userId: context.userId, action: 'plant.updated', entity: 'Plant', entityId: plant.id, metadata: input } });
    response.json({ data: plant });
  } catch (error) { next(error); }
});

setupRouter.get('/plants/:id/members', allowRoles(...managementRoles), async (request, response, next) => {
  try {
    const context = contextOf(request);
    const plant = await prisma.plant.findFirst({ where: { id: routeParam(request, 'id'), workspaceId: context.workspaceId } });
    if (!plant) { response.status(404).json({ error: 'PLANT_NOT_FOUND' }); return; }
    const members = await prisma.workspaceMember.findMany({ where: { workspaceId: context.workspaceId, plantAccess: { some: { plantId: plant.id } } }, include: { user: { select: { id: true, email: true, name: true } } } });
    response.json({ data: members });
  } catch (error) { next(error); }
});

setupRouter.post('/plants/:id/members', allowRoles(...managementRoles), async (request, response, next) => {
  const input = parseBody(request, response, z.object({ email: z.string().email(), role: z.nativeEnum(Role).default('STAFF') }));
  if (!input) return;
  try {
    const context = contextOf(request);
    const plant = await prisma.plant.findFirst({ where: { id: routeParam(request, 'id'), workspaceId: context.workspaceId } });
    if (!plant) { response.status(404).json({ error: 'PLANT_NOT_FOUND' }); return; }
    if (input.role === 'OWNER' && context.role !== 'OWNER') { response.status(403).json({ error: 'OWNER_ROLE_REQUIRED', message: 'Seul un OWNER peut attribuer le rôle OWNER.' }); return; }
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user) { response.status(404).json({ error: 'USER_NOT_FOUND', message: 'Cette personne doit d’abord se connecter à PlantFlow.' }); return; }
    const result = await prisma.$transaction(async (tx) => {
      const member = await tx.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: context.workspaceId, userId: user.id } }, create: { workspaceId: context.workspaceId, userId: user.id, role: input.role }, update: { role: input.role } });
      const assignment = await tx.plantMember.upsert({ where: { plantId_memberId: { plantId: plant.id, memberId: member.id } }, create: { plantId: plant.id, memberId: member.id }, update: {} });
      await audit(tx, context, 'plant.member_added', 'PlantMember', assignment.id, { email: user.email, role: input.role });
      return { member, user };
    });
    response.status(201).json({ data: { id: result.member.id, role: result.member.role, user: { id: result.user.id, name: result.user.name, email: result.user.email } } });
  } catch (error) { next(error); }
});

setupRouter.get('/brick-sizes', async (request, response, next) => {
  try { const c = contextOf(request); const rows = await prisma.brickSize.findMany({ where: { workspaceId: c.workspaceId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }); response.json({ data: rows }); } catch (error) { next(error); }
});
setupRouter.post('/brick-sizes', allowRoles(...managementRoles), async (request, response, next) => {
  const input = parseBody(request, response, z.object({ name: z.string().trim().min(1).max(80), dimensions: z.string().trim().min(3).max(80), unit: z.string().trim().default('u') }));
  if (!input) return;
  try { const c = contextOf(request); const row = await prisma.brickSize.create({ data: { ...input, workspaceId: c.workspaceId } }); await prisma.auditLog.create({ data: { workspaceId: c.workspaceId, userId: c.userId, action: 'brick_size.created', entity: 'BrickSize', entityId: row.id } }); response.status(201).json({ data: row }); } catch (error) { next(error); }
});
setupRouter.patch('/brick-sizes/:id', allowRoles(...managementRoles), async (request, response, next) => {
  const input = parseBody(request, response, z.object({ name: z.string().trim().min(1).max(80).optional(), dimensions: z.string().trim().min(3).max(80).optional(), unit: z.string().trim().optional(), active: z.boolean().optional() }));
  if (!input) return;
  try { const c = contextOf(request); const exists = await prisma.brickSize.findFirst({ where: { id: routeParam(request, 'id'), workspaceId: c.workspaceId } }); if (!exists) { response.status(404).json({ error: 'BRICK_SIZE_NOT_FOUND' }); return; } const row = await prisma.brickSize.update({ where: { id: exists.id }, data: input }); response.json({ data: row }); } catch (error) { next(error); }
});

setupRouter.get('/materials', async (request, response, next) => {
  try { const c = contextOf(request); const rows = await prisma.material.findMany({ where: { workspaceId: c.workspaceId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }); response.json({ data: rows }); } catch (error) { next(error); }
});
setupRouter.post('/materials', allowRoles(...managementRoles), async (request, response, next) => {
  const input = parseBody(request, response, z.object({ name: z.string().trim().min(1).max(100), category: z.string().trim().min(1).max(80), unit: z.string().trim().min(1).max(24), lowStockAt: z.coerce.number().min(0).default(0) }));
  if (!input) return;
  try { const c = contextOf(request); const row = await prisma.material.create({ data: { ...input, workspaceId: c.workspaceId } }); await prisma.auditLog.create({ data: { workspaceId: c.workspaceId, userId: c.userId, action: 'material.created', entity: 'Material', entityId: row.id } }); response.status(201).json({ data: row }); } catch (error) { next(error); }
});
setupRouter.patch('/materials/:id', allowRoles(...managementRoles), async (request, response, next) => {
  const input = parseBody(request, response, z.object({ name: z.string().trim().min(1).max(100).optional(), category: z.string().trim().min(1).max(80).optional(), unit: z.string().trim().min(1).max(24).optional(), lowStockAt: z.coerce.number().min(0).optional(), active: z.boolean().optional() }));
  if (!input) return;
  try { const c = contextOf(request); const exists = await prisma.material.findFirst({ where: { id: routeParam(request, 'id'), workspaceId: c.workspaceId } }); if (!exists) { response.status(404).json({ error: 'MATERIAL_NOT_FOUND' }); return; } const row = await prisma.material.update({ where: { id: exists.id }, data: input }); response.json({ data: row }); } catch (error) { next(error); }
});

const recipeSchema = z.object({ name: z.string().trim().min(1).max(100), brickSizeId: z.string().uuid(), active: z.boolean().default(true), items: z.array(z.object({ materialId: z.string().uuid(), quantity: z.coerce.number().positive() })).min(1) });
setupRouter.get('/recipes', async (request, response, next) => {
  try { const c = contextOf(request); const rows = await prisma.recipe.findMany({ where: { workspaceId: c.workspaceId }, include: { brickSize: true, items: { include: { material: true } } }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }); response.json({ data: rows }); } catch (error) { next(error); }
});
setupRouter.post('/recipes', allowRoles(...managementRoles), async (request, response, next) => {
  const input = parseBody(request, response, recipeSchema);
  if (!input) return;
  try {
    const c = contextOf(request);
    const [size, materialCount] = await Promise.all([prisma.brickSize.count({ where: { id: input.brickSizeId, workspaceId: c.workspaceId } }), prisma.material.count({ where: { workspaceId: c.workspaceId, id: { in: input.items.map((item) => item.materialId) } } })]);
    if (!size || materialCount !== new Set(input.items.map((item) => item.materialId)).size) { response.status(400).json({ error: 'INVALID_RECIPE_REFERENCE' }); return; }
    const row = await prisma.recipe.create({ data: { name: input.name, active: input.active, brickSizeId: input.brickSizeId, workspaceId: c.workspaceId, items: { create: input.items } }, include: { brickSize: true, items: { include: { material: true } } } });
    await prisma.auditLog.create({ data: { workspaceId: c.workspaceId, userId: c.userId, action: 'recipe.created', entity: 'Recipe', entityId: row.id } });
    response.status(201).json({ data: row });
  } catch (error) { next(error); }
});
setupRouter.patch('/recipes/:id', allowRoles(...managementRoles), async (request, response, next) => {
  const input = parseBody(request, response, recipeSchema.partial());
  if (!input) return;
  try {
    const c = contextOf(request);
    const exists = await prisma.recipe.findFirst({ where: { id: routeParam(request, 'id'), workspaceId: c.workspaceId } });
    if (!exists) { response.status(404).json({ error: 'RECIPE_NOT_FOUND' }); return; }
    if (input.brickSizeId && !await prisma.brickSize.findFirst({ where: { id: input.brickSizeId, workspaceId: c.workspaceId } })) { response.status(400).json({ error: 'INVALID_BRICK_SIZE' }); return; }
    if (input.items && await prisma.material.count({ where: { workspaceId: c.workspaceId, id: { in: input.items.map((item) => item.materialId) } } }) !== new Set(input.items.map((item) => item.materialId)).size) { response.status(400).json({ error: 'INVALID_MATERIAL' }); return; }
    const row = await prisma.$transaction(async (tx) => {
      if (input.items) { await tx.recipeItem.deleteMany({ where: { recipeId: exists.id } }); }
      return tx.recipe.update({ where: { id: exists.id }, data: { name: input.name, active: input.active, brickSizeId: input.brickSizeId, ...(input.items ? { items: { create: input.items } } : {}) }, include: { brickSize: true, items: { include: { material: true } } } });
    });
    await prisma.auditLog.create({ data: { workspaceId: c.workspaceId, userId: c.userId, action: 'recipe.updated', entity: 'Recipe', entityId: row.id } });
    response.json({ data: row });
  } catch (error) { next(error); }
});

setupRouter.get('/expense-categories', async (_request, response, next) => {
  try { const c = contextOf(_request); const rows = await prisma.expenseCategory.findMany({ where: { workspaceId: c.workspaceId, active: true }, orderBy: { name: 'asc' } }); response.json({ data: rows }); } catch (error) { next(error); }
});
setupRouter.post('/expense-categories', allowRoles(...managementRoles), async (request, response, next) => {
  const input = parseBody(request, response, z.object({ name: z.string().trim().min(2).max(80) }));
  if (!input) return;
  try { const c = contextOf(request); const row = await prisma.expenseCategory.create({ data: { ...input, workspaceId: c.workspaceId } }); response.status(201).json({ data: row }); } catch (error) { next(error); }
});

const contactSchema = z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().max(32).optional().nullable(), email: z.string().email().optional().nullable(), address: z.string().trim().max(300).optional().nullable() });
setupRouter.get('/customers', requirePlant, allowRoles(...financeRoles), async (request, response, next) => {
  try { const c = contextOf(request); const rows = await prisma.customer.findMany({ where: { workspaceId: c.workspaceId, plantId: c.plantId ?? undefined, active: true }, orderBy: { name: 'asc' }, ...pagination(request) }); response.json({ data: rows }); } catch (error) { next(error); }
});
setupRouter.post('/customers', requirePlant, allowRoles('OWNER', 'MANAGER', 'CASHIER'), async (request, response, next) => {
  const input = parseBody(request, response, contactSchema);
  if (!input) return;
  try { const c = contextOf(request); if (!c.plantId) { response.status(409).json({ error: 'PLANT_REQUIRED' }); return; } const row = await prisma.customer.create({ data: { ...input, email: input.email?.toLowerCase(), workspaceId: c.workspaceId, plantId: c.plantId } }); await prisma.auditLog.create({ data: { workspaceId: c.workspaceId, userId: c.userId, action: 'customer.created', entity: 'Customer', entityId: row.id } }); response.status(201).json({ data: row }); } catch (error) { next(error); }
});
setupRouter.get('/vendors', requirePlant, allowRoles(...financeRoles), async (request, response, next) => {
  try { const c = contextOf(request); const rows = await prisma.vendor.findMany({ where: { workspaceId: c.workspaceId, plantId: c.plantId ?? undefined, active: true }, orderBy: { name: 'asc' }, ...pagination(request) }); response.json({ data: rows }); } catch (error) { next(error); }
});
setupRouter.post('/vendors', requirePlant, allowRoles(...managementRoles), async (request, response, next) => {
  const input = parseBody(request, response, contactSchema);
  if (!input) return;
  try { const c = contextOf(request); if (!c.plantId) { response.status(409).json({ error: 'PLANT_REQUIRED' }); return; } const row = await prisma.vendor.create({ data: { ...input, email: input.email?.toLowerCase(), workspaceId: c.workspaceId, plantId: c.plantId } }); await prisma.auditLog.create({ data: { workspaceId: c.workspaceId, userId: c.userId, action: 'vendor.created', entity: 'Vendor', entityId: row.id } }); response.status(201).json({ data: row }); } catch (error) { next(error); }
});
setupRouter.get('/workers', requirePlant, allowRoles(...financeRoles), async (request, response, next) => {
  try { const c = contextOf(request); const rows = await prisma.worker.findMany({ where: { workspaceId: c.workspaceId, plantId: c.plantId ?? undefined, active: true }, include: { labourEntries: { select: { amount: true, status: true }, where: { status: 'POSTED' } }, payments: { select: { amount: true } } }, orderBy: { name: 'asc' }, ...pagination(request) }); response.json({ data: rows.map((row) => ({ ...row, outstanding: row.labourEntries.reduce((sum, item) => sum + Number(item.amount), 0) - row.payments.reduce((sum, item) => sum + Number(item.amount), 0) })) }); } catch (error) { next(error); }
});
setupRouter.post('/workers', requirePlant, allowRoles(...managementRoles), async (request, response, next) => {
  const input = parseBody(request, response, z.object({ name: z.string().trim().min(2).max(120), jobTitle: z.string().trim().max(80).optional().nullable(), phone: z.string().trim().max(32).optional().nullable() }));
  if (!input) return;
  try { const c = contextOf(request); if (!c.plantId) { response.status(409).json({ error: 'PLANT_REQUIRED' }); return; } const row = await prisma.worker.create({ data: { ...input, workspaceId: c.workspaceId, plantId: c.plantId } }); await prisma.auditLog.create({ data: { workspaceId: c.workspaceId, userId: c.userId, action: 'worker.created', entity: 'Worker', entityId: row.id } }); response.status(201).json({ data: row }); } catch (error) { next(error); }
});
