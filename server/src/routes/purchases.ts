import { CashTransactionType, InventoryMovementType, PaymentMethod, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { allowRoles, ApiError, audit, contextOf, financeRoles, pagination, parseBody, parseDateBound, recordCashMovement, routeParam } from '../http';
import { requirePlant } from '../scope';

export const purchasesRouter = Router();
purchasesRouter.use(requirePlant);

const decimalPlacesAtMost = (value: number, places: number) => new Prisma.Decimal(value).decimalPlaces() <= places;

const paymentInput = z.object({
  amount: z.coerce.number().finite().positive().refine((value) => decimalPlacesAtMost(value, 2), 'Maximum deux décimales.'),
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  cashAccountId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

const purchaseInput = z.object({
  vendorId: z.string().uuid(),
  reference: z.string().trim().min(1).max(100),
  purchaseDate: z.coerce.date().default(() => new Date()),
  notes: z.string().trim().max(1000).optional().nullable(),
  items: z.array(z.object({
    materialId: z.string().uuid(),
    quantity: z.coerce.number().finite().positive().refine((value) => decimalPlacesAtMost(value, 3), 'Maximum trois décimales.'),
    unitCost: z.coerce.number().finite().min(0).refine((value) => decimalPlacesAtMost(value, 2), 'Maximum deux décimales.'),
  })).min(1),
  initialPayment: paymentInput.optional(),
});

type PurchaseRecord = {
  totalAmount: Prisma.Decimal;
  payments: Array<{ amount: Prisma.Decimal }>;
};

function withPaymentTotals<T extends PurchaseRecord>(purchase: T) {
  const paid = purchase.payments.reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));
  const total = new Prisma.Decimal(purchase.totalAmount);
  return {
    ...purchase,
    paidAmount: paid.toNumber(),
    balanceDue: total.sub(paid).toDecimalPlaces(2).toNumber(),
  };
}

function pageInfo(request: Parameters<typeof pagination>[0]) {
  const { skip, take } = pagination(request);
  return { skip, take, page: Math.floor(skip / take) + 1, limit: take };
}

async function requireCashAccount(
  tx: Prisma.TransactionClient,
  cashAccountId: string | null | undefined,
  workspaceId: string,
  plantId: string,
) {
  if (!cashAccountId) return null;
  const account = await tx.cashAccount.findFirst({
    where: { id: cashAccountId, workspaceId, plantId, active: true },
    select: { id: true },
  });
  if (!account) throw new ApiError(404, 'CASH_ACCOUNT_NOT_FOUND', 'Compte de caisse introuvable ou inactif pour cette usine.');
  return account;
}

function forwardError(error: unknown, next: (error?: unknown) => void) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    next(new ApiError(409, 'PURCHASE_REFERENCE_CONFLICT', 'Cette référence d’achat existe déjà.'));
    return;
  }
  next(error);
}

purchasesRouter.get('/purchases', allowRoles(...financeRoles), async (request, response, next) => {
  try {
    const context = contextOf(request);
    const { skip, take, page, limit } = pageInfo(request);
    const vendorId = typeof request.query.vendorId === 'string' ? request.query.vendorId : undefined;
    const from = parseDateBound(request.query.from);
    const to = parseDateBound(request.query.to, true);
    if (from && to && from > to) throw new ApiError(400, 'INVALID_DATE_RANGE', 'La date from doit être antérieure ou égale à to.');
    const where: Prisma.PurchaseWhereInput = {
      workspaceId: context.workspaceId,
      plantId: context.plantId!,
      ...(vendorId ? { vendorId } : {}),
      ...(from && !Number.isNaN(from.getTime()) || to && !Number.isNaN(to.getTime())
        ? { purchaseDate: {
          ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
          ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
        } }
        : {}),
    };
    const [records, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
        include: { vendor: true, items: { include: { material: true } }, payments: { orderBy: { paidAt: 'asc' } } },
        orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }], skip, take,
      }),
      prisma.purchase.count({ where }),
    ]);
    response.json({ data: { items: records.map(withPaymentTotals), total, page, limit } });
  } catch (error) { next(error); }
});

purchasesRouter.post('/purchases', allowRoles(...financeRoles), async (request, response, next) => {
  const input = parseBody(request, response, purchaseInput);
  if (!input) return;
  try {
    const context = contextOf(request);
    const created = await prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.findFirst({
        where: { id: input.vendorId, workspaceId: context.workspaceId, plantId: context.plantId!, active: true },
        select: { id: true },
      });
      if (!vendor) throw new ApiError(404, 'VENDOR_NOT_FOUND', 'Fournisseur introuvable ou inactif pour cette usine.');

      const materialIds = [...new Set(input.items.map((item) => item.materialId))];
      const materials = await tx.material.findMany({
        where: { id: { in: materialIds }, workspaceId: context.workspaceId, active: true },
        select: { id: true },
      });
      if (materials.length !== materialIds.length) {
        throw new ApiError(404, 'MATERIAL_NOT_FOUND', 'Une ou plusieurs matières sont introuvables ou inactives dans ce workspace.');
      }

      const lines = input.items.map((item) => {
        const quantity = new Prisma.Decimal(item.quantity);
        const unitCost = new Prisma.Decimal(item.unitCost);
        const lineTotal = quantity.mul(unitCost).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        return { materialId: item.materialId, quantity, unitCost, lineTotal };
      });
      const totalAmount = lines.reduce((sum, line) => sum.add(line.lineTotal), new Prisma.Decimal(0)).toDecimalPlaces(2);
      const initialPayment = input.initialPayment;
      if (initialPayment && new Prisma.Decimal(initialPayment.amount).greaterThan(totalAmount)) {
        throw new ApiError(409, 'PAYMENT_EXCEEDS_BALANCE', 'Le paiement initial dépasse le montant de l’achat.');
      }
      if (initialPayment?.cashAccountId) {
        await requireCashAccount(tx, initialPayment.cashAccountId, context.workspaceId, context.plantId!);
      }

      const purchase = await tx.purchase.create({
        data: {
          workspaceId: context.workspaceId,
          plantId: context.plantId!,
          vendorId: vendor.id,
          reference: input.reference,
          purchaseDate: input.purchaseDate,
          totalAmount,
          notes: input.notes,
          createdById: context.userId,
          items: { create: lines },
        },
      });

      const movements: Prisma.InventoryMovementCreateManyInput[] = lines.map((line) => ({
        workspaceId: context.workspaceId,
        plantId: context.plantId!,
        materialId: line.materialId,
        type: InventoryMovementType.PURCHASE,
        quantity: line.quantity,
        referenceType: 'Purchase',
        referenceId: purchase.id,
        createdById: context.userId,
        reason: `Achat ${purchase.reference}`,
      }));
      await tx.inventoryMovement.createMany({ data: movements });

      if (initialPayment) {
        const payment = await tx.purchasePayment.create({
          data: {
            purchaseId: purchase.id,
            amount: new Prisma.Decimal(initialPayment.amount),
            method: initialPayment.method,
            cashAccountId: initialPayment.cashAccountId ?? null,
            note: initialPayment.note,
            paidById: context.userId,
          },
        });
        await recordCashMovement(tx, {
          accountId: initialPayment.cashAccountId,
          type: CashTransactionType.OUT,
          amount: payment.amount,
          referenceType: 'PurchasePayment',
          referenceId: payment.id,
          reason: `Paiement de l’achat ${purchase.reference}`,
          createdById: context.userId,
        });
      }

      await audit(tx, context, 'purchase.created', 'Purchase', purchase.id, {
        reference: purchase.reference,
        totalAmount: totalAmount.toNumber(),
        itemCount: lines.length,
        initialPayment: initialPayment?.amount ?? 0,
      });
      return tx.purchase.findUniqueOrThrow({
        where: { id: purchase.id },
        include: { vendor: true, items: { include: { material: true } }, payments: { orderBy: { paidAt: 'asc' } } },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    response.status(201).json({ data: withPaymentTotals(created) });
  } catch (error) { forwardError(error, next); }
});

purchasesRouter.post('/purchases/:id/payments', allowRoles(...financeRoles), async (request, response, next) => {
  const input = parseBody(request, response, paymentInput);
  if (!input) return;
  try {
    const context = contextOf(request);
    const purchaseId = routeParam(request, 'id');
    const result = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({
        where: { id: purchaseId, workspaceId: context.workspaceId, plantId: context.plantId! },
        include: { payments: true },
      });
      if (!purchase) throw new ApiError(404, 'PURCHASE_NOT_FOUND', 'Achat introuvable pour cette usine.');

      const paidSoFar = purchase.payments.reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));
      const balance = new Prisma.Decimal(purchase.totalAmount).sub(paidSoFar).toDecimalPlaces(2);
      const amount = new Prisma.Decimal(input.amount);
      if (amount.greaterThan(balance)) {
        throw new ApiError(409, 'PAYMENT_EXCEEDS_BALANCE', 'Le paiement dépasse le solde restant.', { balanceDue: balance.toNumber() });
      }
      if (input.cashAccountId) await requireCashAccount(tx, input.cashAccountId, context.workspaceId, context.plantId!);

      const payment = await tx.purchasePayment.create({
        data: {
          purchaseId: purchase.id,
          amount,
          method: input.method,
          cashAccountId: input.cashAccountId ?? null,
          note: input.note,
          paidById: context.userId,
        },
      });
      await recordCashMovement(tx, {
        accountId: input.cashAccountId,
        type: CashTransactionType.OUT,
        amount: payment.amount,
        referenceType: 'PurchasePayment',
        referenceId: payment.id,
        reason: `Paiement de l’achat ${purchase.reference}`,
        createdById: context.userId,
      });
      await audit(tx, context, 'purchase.payment_created', 'PurchasePayment', payment.id, {
        purchaseId: purchase.id,
        amount: amount.toNumber(),
        method: input.method,
        cashAccountId: input.cashAccountId ?? null,
      });

      const updated = await tx.purchase.findUniqueOrThrow({
        where: { id: purchase.id },
        include: { vendor: true, items: { include: { material: true } }, payments: { orderBy: { paidAt: 'asc' } } },
      });
      return { payment, purchase: withPaymentTotals(updated) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    response.status(201).json({ data: { ...result, purchase: result.purchase } });
  } catch (error) { forwardError(error, next); }
});

purchasesRouter.get('/vendors/:id/statement', allowRoles(...financeRoles), async (request, response, next) => {
  try {
    const context = contextOf(request);
    const { skip, take, page, limit } = pageInfo(request);
    const vendor = await prisma.vendor.findFirst({
      where: { id: routeParam(request, 'id'), workspaceId: context.workspaceId, plantId: context.plantId! },
    });
    if (!vendor) throw new ApiError(404, 'VENDOR_NOT_FOUND', 'Fournisseur introuvable pour cette usine.');

    const where: Prisma.PurchaseWhereInput = {
      workspaceId: context.workspaceId,
      plantId: context.plantId!,
      vendorId: vendor.id,
    };
    const [records, total, amountTotals, paymentTotals] = await Promise.all([
      prisma.purchase.findMany({
        where,
        include: { items: { include: { material: true } }, payments: { orderBy: { paidAt: 'asc' } } },
        orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }], skip, take,
      }),
      prisma.purchase.count({ where }),
      prisma.purchase.aggregate({ where, _sum: { totalAmount: true } }),
      prisma.purchasePayment.aggregate({ where: { purchase: where }, _sum: { amount: true } }),
    ]);
    const totalPurchased = new Prisma.Decimal(amountTotals._sum.totalAmount ?? 0);
    const totalPaid = new Prisma.Decimal(paymentTotals._sum.amount ?? 0);
    response.json({ data: {
      vendor,
      purchases: { items: records.map(withPaymentTotals), total, page, limit },
      totals: {
        purchased: totalPurchased.toNumber(),
        paid: totalPaid.toNumber(),
        balanceDue: totalPurchased.sub(totalPaid).toDecimalPlaces(2).toNumber(),
      },
    } });
  } catch (error) { next(error); }
});
