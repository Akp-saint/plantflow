import { PaymentMethod, Prisma } from '@prisma/client';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { allowRoles, ApiError, audit, contextOf, financeRoles, pagination, parseBody, parseDateBound, recordCashMovement, routeParam } from '../http';
import { requirePlant } from '../scope';

export const financeRouter = Router();
financeRouter.use(requirePlant);

function requireFinanceRole(role: ReturnType<typeof contextOf>['role']) {
  if (!financeRoles.includes(role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Votre rôle ne permet pas cette opération financière.');
  }
}

function queryDates(request: Request, field: string) {
  const from = parseDateBound(request.query.from);
  const to = parseDateBound(request.query.to, true);
  if (from && to && from > to) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', 'La date from doit être antérieure ou égale à to.');
  }
  return {
    ...(from || to ? { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    from,
    to,
  };
}

function pageMeta(request: Request, total: number) {
  const { skip, take } = pagination(request);
  return { page: Math.floor(skip / take) + 1, limit: take, total };
}

function asNumber(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value ?? 0);
}

async function cashAccountRows(workspaceId: string, plantId: string, options?: { skip?: number; take?: number }) {
  const accounts = await prisma.cashAccount.findMany({
    where: { workspaceId, plantId },
    include: { transactions: { select: { type: true, amount: true } }, plant: { select: { currency: true } } },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    ...options,
  });
  return accounts.map(({ transactions, plant, ...account }) => {
    const incoming = transactions.filter((entry) => entry.type === 'IN').reduce((sum, entry) => sum + asNumber(entry.amount), 0);
    const outgoing = transactions.filter((entry) => entry.type === 'OUT').reduce((sum, entry) => sum + asNumber(entry.amount), 0);
    return {
      ...account,
      openingBalance: asNumber(account.openingBalance),
      incoming,
      outgoing,
      balance: asNumber(account.openingBalance) + incoming - outgoing,
      currency: plant.currency,
    };
  });
}

const cashierInput = z.object({
  name: z.string().trim().min(1).max(120),
  openingBalance: z.coerce.number().finite().min(0).default(0),
});

financeRouter.get('/cashiers', allowRoles(...financeRoles), async (request, response, next) => {
  try {
    const context = contextOf(request);
    const { skip, take } = pagination(request);
    const where = { workspaceId: context.workspaceId, plantId: context.plantId! };
    const [total, rows] = await Promise.all([
      prisma.cashAccount.count({ where }),
      cashAccountRows(context.workspaceId, context.plantId!, { skip, take }),
    ]);
    response.json({ data: rows, meta: pageMeta(request, total) });
  } catch (error) { next(error); }
});

financeRouter.post('/cashiers', async (request, response, next) => {
  const input = parseBody(request, response, cashierInput);
  if (!input) return;
  try {
    const context = contextOf(request);
    requireFinanceRole(context.role);
    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.cashAccount.create({
        data: { workspaceId: context.workspaceId, plantId: context.plantId!, name: input.name, openingBalance: input.openingBalance },
      });
      await audit(tx, context, 'cashier.created', 'CashAccount', created.id, { name: created.name, openingBalance: input.openingBalance });
      return created;
    });
    response.status(201).json({ data: { ...account, openingBalance: asNumber(account.openingBalance), incoming: 0, outgoing: 0, balance: asNumber(account.openingBalance) } });
  } catch (error) { next(error); }
});

const transactionInput = z.object({
  type: z.enum(['IN', 'OUT']),
  amount: z.coerce.number().finite().positive().max(99999999999),
  reason: z.string().trim().min(1).max(500),
});

financeRouter.post('/cashiers/:id/transactions', async (request, response, next) => {
  const input = parseBody(request, response, transactionInput);
  if (!input) return;
  try {
    const context = contextOf(request);
    requireFinanceRole(context.role);
    const account = await prisma.cashAccount.findFirst({ where: { id: routeParam(request, 'id'), workspaceId: context.workspaceId, plantId: context.plantId!, active: true } });
    if (!account) throw new ApiError(404, 'CASH_ACCOUNT_NOT_FOUND', 'Compte caisse introuvable ou inactif pour cette usine.');
    const result = await prisma.$transaction(async (tx) => {
      const movement = await tx.cashTransaction.create({
        data: { accountId: account.id, type: input.type, amount: input.amount, reason: input.reason, referenceType: 'MANUAL', createdById: context.userId },
      });
      await audit(tx, context, 'cash_transaction.created', 'CashTransaction', movement.id, { accountId: account.id, type: input.type, amount: input.amount, reason: input.reason });
      return movement;
    });
    response.status(201).json({ data: { ...result, amount: asNumber(result.amount) } });
  } catch (error) { next(error); }
});

const expenseInput = z.object({
  categoryId: z.string().uuid(),
  cashAccountId: z.string().uuid(),
  description: z.string().trim().min(1).max(240),
  amount: z.coerce.number().finite().positive().max(99999999999),
  paymentMethod: z.nativeEnum(PaymentMethod).default('CASH'),
  expenseDate: z.coerce.date(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

financeRouter.get('/expenses', allowRoles(...financeRoles), async (request, response, next) => {
  try {
    const context = contextOf(request);
    const dates = queryDates(request, 'expenseDate');
    const where = { workspaceId: context.workspaceId, plantId: context.plantId!, ...datesWhere(dates, 'expenseDate') };
    const { skip, take } = pagination(request);
    const [total, rows] = await Promise.all([
      prisma.expense.count({ where }),
      prisma.expense.findMany({ where, include: { category: true, cashAccount: true }, orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }], skip, take }),
    ]);
    response.json({ data: rows.map((row) => ({ ...row, amount: asNumber(row.amount) })), meta: pageMeta(request, total) });
  } catch (error) { next(error); }
});

financeRouter.post('/expenses', async (request, response, next) => {
  const input = parseBody(request, response, expenseInput);
  if (!input) return;
  try {
    const context = contextOf(request);
    requireFinanceRole(context.role);
    const [category, account] = await Promise.all([
      prisma.expenseCategory.findFirst({ where: { id: input.categoryId, workspaceId: context.workspaceId, active: true } }),
      prisma.cashAccount.findFirst({ where: { id: input.cashAccountId, workspaceId: context.workspaceId, plantId: context.plantId!, active: true } }),
    ]);
    if (!category) throw new ApiError(404, 'EXPENSE_CATEGORY_NOT_FOUND', 'Catégorie de dépense introuvable ou inactive.');
    if (!account) throw new ApiError(404, 'CASH_ACCOUNT_NOT_FOUND', 'Compte caisse introuvable ou inactif pour cette usine.');
    const created = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          workspaceId: context.workspaceId,
          plantId: context.plantId!,
          categoryId: category.id,
          cashAccountId: account.id,
          description: input.description,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          expenseDate: input.expenseDate,
          notes: input.notes,
          createdById: context.userId,
        },
        include: { category: true, cashAccount: true },
      });
      await recordCashMovement(tx, {
        accountId: account.id,
        type: 'OUT',
        amount: input.amount,
        referenceType: 'Expense',
        referenceId: expense.id,
        reason: input.description,
        createdById: context.userId,
      });
      await audit(tx, context, 'expense.created', 'Expense', expense.id, { categoryId: category.id, cashAccountId: account.id, amount: input.amount, paymentMethod: input.paymentMethod });
      return expense;
    });
    response.status(201).json({ data: { ...created, amount: asNumber(created.amount) } });
  } catch (error) { next(error); }
});

function datesWhere(dates: ReturnType<typeof queryDates>, field: string) {
  const { from, to } = dates;
  return from || to ? { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};
}

async function inventorySummary(workspaceId: string, plantId: string, through?: Date) {
  const movementWhere = { workspaceId, plantId, ...(through ? { createdAt: { lte: through } } : {}) };
  const [materials, sizes, materialSums, brickSums] = await Promise.all([
    prisma.material.findMany({ where: { workspaceId, active: true }, orderBy: { name: 'asc' } }),
    prisma.brickSize.findMany({ where: { workspaceId, active: true }, orderBy: { name: 'asc' } }),
    prisma.inventoryMovement.groupBy({ by: ['materialId'], where: { ...movementWhere, materialId: { not: null } }, _sum: { quantity: true } }),
    prisma.inventoryMovement.groupBy({ by: ['brickSizeId'], where: { ...movementWhere, brickSizeId: { not: null } }, _sum: { quantity: true } }),
  ]);
  const materialBalances = new Map(materialSums.map((row) => [row.materialId!, asNumber(row._sum.quantity)]));
  const brickBalances = new Map(brickSums.map((row) => [row.brickSizeId!, asNumber(row._sum.quantity)]));
  return {
    materials: materials.map((material) => {
      const onHand = materialBalances.get(material.id) ?? 0;
      const lowStockAt = asNumber(material.lowStockAt);
      return { id: material.id, name: material.name, category: material.category, unit: material.unit, onHand, lowStockAt, lowStock: onHand <= lowStockAt };
    }),
    finishedGoods: sizes.map((size) => ({ id: size.id, name: size.name, unit: size.unit, onHand: brickBalances.get(size.id) ?? 0 })),
  };
}

function dateRangeLabel(from?: Date, to?: Date) {
  return { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null };
}

async function productionTotals(workspaceId: string, plantId: string, dates: ReturnType<typeof queryDates>) {
  const where = { workspaceId, plantId, status: 'VALIDATED' as const, ...datesWhere(dates, 'productionDate') };
  const [total, bySize] = await Promise.all([
    prisma.productionEntry.aggregate({ where, _sum: { quantityProduced: true, quantityDamaged: true } }),
    prisma.productionEntry.groupBy({ by: ['brickSizeId'], where, _sum: { quantityProduced: true, quantityDamaged: true } }),
  ]);
  const sizes = await prisma.brickSize.findMany({ where: { workspaceId, id: { in: bySize.map((row) => row.brickSizeId) } }, select: { id: true, name: true, unit: true } });
  const sizeMap = new Map(sizes.map((size) => [size.id, size]));
  return {
    produced: asNumber(total._sum.quantityProduced),
    damaged: asNumber(total._sum.quantityDamaged),
    unit: 'mixed_by_brick_size',
    byBrickSize: bySize.map((row) => ({
      brickSizeId: row.brickSizeId,
      name: sizeMap.get(row.brickSizeId)?.name ?? 'Unknown',
      unit: sizeMap.get(row.brickSizeId)?.unit ?? 'u',
      quantityProduced: asNumber(row._sum.quantityProduced),
      quantityDamaged: asNumber(row._sum.quantityDamaged),
    })),
  };
}

async function salesTotals(workspaceId: string, plantId: string, dates: ReturnType<typeof queryDates>) {
  const where = { workspaceId, plantId, status: 'POSTED' as const, ...datesWhere(dates, 'saleDate') };
  const [sales, invoices] = await Promise.all([
    prisma.sale.aggregate({ where, _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.sale.findMany({ where, select: { id: true, totalAmount: true, payments: { select: { amount: true } } } }),
  ]);
  const outstanding = invoices.reduce((sum, sale) => sum + asNumber(sale.totalAmount) - sale.payments.reduce((paid, payment) => paid + asNumber(payment.amount), 0), 0);
  return { total: asNumber(sales._sum.totalAmount), outstanding: Math.max(0, outstanding), currencyUnit: 'plant_currency', saleCount: sales._count._all };
}

async function expenseTotals(workspaceId: string, plantId: string, dates: ReturnType<typeof queryDates>) {
  const where = { workspaceId, plantId, ...datesWhere(dates, 'expenseDate') };
  const [aggregate, grouped] = await Promise.all([
    prisma.expense.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.expense.groupBy({ by: ['categoryId'], where, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const categories = await prisma.expenseCategory.findMany({ where: { workspaceId, id: { in: grouped.map((row) => row.categoryId) } }, select: { id: true, name: true } });
  const names = new Map(categories.map((category) => [category.id, category.name]));
  return {
    total: asNumber(aggregate._sum.amount),
    currencyUnit: 'plant_currency',
    expenseCount: aggregate._count._all,
    byCategory: grouped.map((row) => ({ categoryId: row.categoryId, category: names.get(row.categoryId) ?? 'Unknown', amount: asNumber(row._sum.amount), expenseCount: row._count._all })),
  };
}

async function purchaseTotals(workspaceId: string, plantId: string, dates: ReturnType<typeof queryDates>) {
  const where = { workspaceId, plantId, status: 'POSTED' as const, ...datesWhere(dates, 'purchaseDate') };
  const [aggregate, rows] = await Promise.all([
    prisma.purchase.aggregate({ where, _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.purchase.findMany({ where, select: { totalAmount: true, payments: { select: { amount: true } } } }),
  ]);
  const outstanding = rows.reduce((sum, row) => sum + Math.max(0, asNumber(row.totalAmount) - row.payments.reduce((paid, payment) => paid + asNumber(payment.amount), 0)), 0);
  return { total: asNumber(aggregate._sum.totalAmount), outstanding, purchaseCount: aggregate._count._all, currencyUnit: 'plant_currency' };
}

async function recentActivity(workspaceId: string, plantId: string, productionDates: ReturnType<typeof queryDates>, salesDates: ReturnType<typeof queryDates>, purchaseDates: ReturnType<typeof queryDates>, expenseDates: ReturnType<typeof queryDates>) {
  const [productions, sales, purchases, expenses] = await Promise.all([
    prisma.productionEntry.findMany({ where: { workspaceId, plantId, status: 'VALIDATED', ...datesWhere(productionDates, 'productionDate') }, include: { brickSize: { select: { name: true, unit: true } } }, orderBy: { productionDate: 'desc' }, take: 8 }),
    prisma.sale.findMany({ where: { workspaceId, plantId, status: 'POSTED', ...datesWhere(salesDates, 'saleDate') }, include: { customer: { select: { name: true } } }, orderBy: { saleDate: 'desc' }, take: 8 }),
    prisma.purchase.findMany({ where: { workspaceId, plantId, status: 'POSTED', ...datesWhere(purchaseDates, 'purchaseDate') }, include: { vendor: { select: { name: true } } }, orderBy: { purchaseDate: 'desc' }, take: 8 }),
    prisma.expense.findMany({ where: { workspaceId, plantId, ...datesWhere(expenseDates, 'expenseDate') }, include: { category: { select: { name: true } } }, orderBy: { expenseDate: 'desc' }, take: 8 }),
  ]);
  const rows = [
    ...productions.map((row) => ({ sortAt: row.productionDate, id: row.id, kind: 'production', title: 'Production enregistrée', detail: `${row.brickSize.name} · ${row.quantityProduced} produites · ${row.quantityDamaged} endommagées`, date: row.productionDate.toISOString(), amount: null as number | null })),
    ...sales.map((row) => ({ sortAt: row.saleDate, id: row.id, kind: 'sale', title: 'Vente enregistrée', detail: `${row.invoiceNumber} · ${row.customer.name}`, date: row.saleDate.toISOString(), amount: asNumber(row.totalAmount) })),
    ...purchases.map((row) => ({ sortAt: row.purchaseDate, id: row.id, kind: 'purchase', title: 'Achat enregistré', detail: `${row.reference} · ${row.vendor.name}`, date: row.purchaseDate.toISOString(), amount: asNumber(row.totalAmount) })),
    ...expenses.map((row) => ({ sortAt: row.expenseDate, id: row.id, kind: 'expense', title: 'Dépense enregistrée', detail: `${row.category.name} · ${row.description}`, date: row.expenseDate.toISOString(), amount: asNumber(row.amount) })),
  ];
  return rows.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime()).slice(0, 8).map(({ sortAt: _sortAt, ...row }) => row);
}

financeRouter.get('/dashboard', allowRoles(...financeRoles), async (request, response, next) => {
  try {
    const context = contextOf(request);
    const productionDates = queryDates(request, 'productionDate');
    const salesDates = queryDates(request, 'saleDate');
    const purchaseDates = queryDates(request, 'purchaseDate');
    const expenseDates = queryDates(request, 'expenseDate');
    const dateRange = dateRangeLabel(productionDates.from, productionDates.to);
    const allTime = { from: undefined, to: undefined } as ReturnType<typeof queryDates>;
    const [production, inventory, sales, purchases, salesAll, purchasesAll, expenses, cashAccounts, activity] = await Promise.all([
      productionTotals(context.workspaceId, context.plantId!, productionDates),
      inventorySummary(context.workspaceId, context.plantId!, productionDates.to),
      salesTotals(context.workspaceId, context.plantId!, salesDates),
      purchaseTotals(context.workspaceId, context.plantId!, purchaseDates),
      salesTotals(context.workspaceId, context.plantId!, allTime),
      purchaseTotals(context.workspaceId, context.plantId!, allTime),
      expenseTotals(context.workspaceId, context.plantId!, expenseDates),
      cashAccountRows(context.workspaceId, context.plantId!),
      recentActivity(context.workspaceId, context.plantId!, productionDates, salesDates, purchaseDates, expenseDates),
    ]);
    response.json({ data: {
      period: dateRange,
      production,
      inventory: {
        materials: inventory.materials,
        finishedGoods: inventory.finishedGoods,
        lowStockMaterialCount: inventory.materials.filter((material) => material.lowStock).length,
      },
      sales: { ...sales, outstanding: salesAll.outstanding },
      purchases: { ...purchases, outstanding: purchasesAll.outstanding },
      expenses,
      cash: { accounts: cashAccounts.map(({ id, name, currency, balance }) => ({ id, name, currency, balance })), unit: 'plant_currency' },
      recentActivity: activity,
    } });
  } catch (error) { next(error); }
});
financeRouter.get('/reports/production', allowRoles(...financeRoles), async (request, response, next) => {
  try {
    const context = contextOf(request);
    const dates = queryDates(request, 'productionDate');
    response.json({ data: { period: dateRangeLabel(dates.from, dates.to), ...await productionTotals(context.workspaceId, context.plantId!, dates) } });
  } catch (error) { next(error); }
});

financeRouter.get('/reports/inventory', allowRoles(...financeRoles), async (request, response, next) => {
  try {
    const context = contextOf(request);
    const dates = queryDates(request, 'createdAt');
    const inventory = await inventorySummary(context.workspaceId, context.plantId!, dates.to);
    response.json({ data: { period: { asOf: dates.to?.toISOString() ?? 'now', from: dates.from?.toISOString() ?? null }, ...inventory } });
  } catch (error) { next(error); }
});

financeRouter.get('/reports/sales', allowRoles(...financeRoles), async (request, response, next) => {
  try {
    const context = contextOf(request);
    const dates = queryDates(request, 'saleDate');
    response.json({ data: { period: dateRangeLabel(dates.from, dates.to), ...await salesTotals(context.workspaceId, context.plantId!, dates) } });
  } catch (error) { next(error); }
});

financeRouter.get('/reports/expenses', allowRoles(...financeRoles), async (request, response, next) => {
  try {
    const context = contextOf(request);
    const dates = queryDates(request, 'expenseDate');
    response.json({ data: { period: dateRangeLabel(dates.from, dates.to), ...await expenseTotals(context.workspaceId, context.plantId!, dates) } });
  } catch (error) { next(error); }
});

financeRouter.get('/notifications', async (request, response, next) => {
  try {
    const context = contextOf(request);
    const inventory = await inventorySummary(context.workspaceId, context.plantId!);
    const alerts = inventory.materials
      .filter((material) => material.lowStock)
      .map((material) => ({
        type: 'LOW_MATERIAL_STOCK',
        severity: material.onHand <= 0 ? 'critical' : 'warning',
        materialId: material.id,
        material: material.name,
        onHand: material.onHand,
        threshold: material.lowStockAt,
        unit: material.unit,
      }));
    const { skip, take } = pagination(request);
    response.json({ data: alerts.slice(skip, skip + take), meta: pageMeta(request, alerts.length) });
  } catch (error) { next(error); }
});
