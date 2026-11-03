import { randomUUID } from 'node:crypto';
import { InventoryMovementType, PaymentMethod, Prisma, RecordStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import {
  ApiError,
  allowRoles,
  audit,
  contextOf,
  currentBrickBalance,
  financeRoles,
  pagination,
  parseBody,
  parseDateBound,
  recordCashMovement,
  routeParam,
} from '../http';
import { requirePlant } from '../scope';

export const salesRouter = Router();
salesRouter.use(requirePlant);

const money = z.coerce.number().finite().min(0).max(999_999_999_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, 'Le montant doit avoir au plus deux décimales.');
const paymentSchema = z.object({
  amount: money,
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  cashAccountId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});
const saleInput = z.object({
  customerId: z.string().uuid(),
  saleDate: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  items: z.array(z.object({
    brickSizeId: z.string().uuid(),
    quantity: z.coerce.number().int().positive().max(100_000_000),
    unitPrice: money,
  })).min(1).max(500),
  initialPayment: paymentSchema.optional(),
});

const cents = (amount: number) => Math.round(amount * 100);
const fromCents = (amount: number) => new Prisma.Decimal(amount).div(100);

async function validatePaymentAccount(
  tx: Prisma.TransactionClient,
  cashAccountId: string | null | undefined,
  workspaceId: string,
  plantId: string,
) {
  if (!cashAccountId) return;
  const account = await tx.cashAccount.findFirst({
    where: { id: cashAccountId, workspaceId, plantId, active: true },
    select: { id: true },
  });
  if (!account) throw new ApiError(400, 'INVALID_CASH_ACCOUNT', 'Le compte de caisse est introuvable, inactif ou ne dépend pas de cette usine.');
}

function invoiceNumber() {
  return `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

salesRouter.get('/sales', allowRoles(...financeRoles), async (request, response, next) => {
  try {
    const c = contextOf(request);
    const page = pagination(request);
    const from = parseDateBound(request.query.from);
    const to = parseDateBound(request.query.to, true);
    if (from && to && from > to) throw new ApiError(400, 'INVALID_DATE_RANGE', 'La date from doit être antérieure ou égale à to.');
    const where: Prisma.SaleWhereInput = {
      workspaceId: c.workspaceId,
      plantId: c.plantId!,
      ...(typeof request.query.customerId === 'string' ? { customerId: request.query.customerId } : {}),
      ...(from && !Number.isNaN(from.getTime()) ? { saleDate: { gte: from } } : {}),
      ...(to && !Number.isNaN(to.getTime()) ? { saleDate: { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), lte: to } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: { customer: true, items: { include: { brickSize: true } }, payments: true },
        orderBy: [{ saleDate: 'desc' }, { createdAt: 'desc' }],
        ...page,
      }),
      prisma.sale.count({ where }),
    ]);
    const pageNumber = Math.floor(page.skip / page.take) + 1;
    response.json({
      data: {
        items: rows.map((sale) => {
          const paidAmount = sale.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
          const totalAmount = Number(sale.totalAmount);
          return { ...sale, totalAmount, paidAmount, balance: Math.max(0, totalAmount - paidAmount) };
        }),
        pagination: { page: pageNumber, limit: page.take, total, pages: Math.ceil(total / page.take) },
      },
    });
  } catch (error) { next(error); }
});

salesRouter.post('/sales', allowRoles(...financeRoles), async (request, response, next) => {
  const input = parseBody(request, response, saleInput);
  if (!input) return;
  try {
    const c = contextOf(request);
    const customer = await prisma.customer.findFirst({
      where: { id: input.customerId, workspaceId: c.workspaceId, plantId: c.plantId!, active: true },
      select: { id: true },
    });
    if (!customer) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Client introuvable ou inactif pour cette usine.');

    const requestedBrickIds = [...new Set(input.items.map((item) => item.brickSizeId))];
    const brickSizes = await prisma.brickSize.findMany({
      where: { id: { in: requestedBrickIds }, workspaceId: c.workspaceId, active: true },
      select: { id: true, name: true },
    });
    const brickById = new Map(brickSizes.map((brick) => [brick.id, brick]));
    const missingBrick = requestedBrickIds.find((id) => !brickById.has(id));
    if (missingBrick) throw new ApiError(404, 'BRICK_SIZE_NOT_FOUND', 'Un format de brique est introuvable ou inactif dans ce workspace.');

    const lineCents = input.items.map((item) => cents(item.unitPrice) * item.quantity);
    const totalCents = lineCents.reduce((sum, amount) => sum + amount, 0);
    if (!Number.isSafeInteger(totalCents) || totalCents > 99_999_999_999_999) {
      throw new ApiError(400, 'SALE_TOTAL_OUT_OF_RANGE', 'Le total de la vente dépasse la limite autorisée.');
    }
    const initialPaymentCents = input.initialPayment ? cents(input.initialPayment.amount) : 0;
    if (initialPaymentCents > totalCents) throw new ApiError(400, 'PAYMENT_EXCEEDS_TOTAL', 'Le paiement initial ne peut pas dépasser le total de la vente.');
    if (input.initialPayment && initialPaymentCents <= 0) throw new ApiError(400, 'INVALID_PAYMENT_AMOUNT', 'Un paiement doit être supérieur à zéro.');

    const created = await prisma.$transaction(async (tx) => {
      const quantitiesByBrick = new Map<string, number>();
      for (const item of input.items) quantitiesByBrick.set(item.brickSizeId, (quantitiesByBrick.get(item.brickSizeId) ?? 0) + item.quantity);
      for (const [brickSizeId, quantity] of quantitiesByBrick) {
        const available = await currentBrickBalance(tx, c.workspaceId, c.plantId!, brickSizeId);
        if (available < quantity) {
          const brick = brickById.get(brickSizeId)!;
          throw new ApiError(409, 'INSUFFICIENT_BRICK_STOCK', `Stock insuffisant pour ${brick.name}.`, { required: quantity, available });
        }
      }
      if (input.initialPayment) await validatePaymentAccount(tx, input.initialPayment.cashAccountId, c.workspaceId, c.plantId!);

      const sale = await tx.sale.create({
        data: {
          workspaceId: c.workspaceId,
          plantId: c.plantId!,
          customerId: customer.id,
          invoiceNumber: invoiceNumber(),
          saleDate: input.saleDate ?? new Date(),
          totalAmount: fromCents(totalCents),
          status: RecordStatus.POSTED,
          notes: input.notes,
          createdById: c.userId,
          items: {
            create: input.items.map((item, index) => ({
              brickSizeId: item.brickSizeId,
              quantity: item.quantity,
              unitPrice: fromCents(cents(item.unitPrice)),
              lineTotal: fromCents(lineCents[index]),
            })),
          },
        },
        include: { customer: true, items: { include: { brickSize: true } }, payments: true },
      });

      await tx.inventoryMovement.createMany({
        data: input.items.map((item) => ({
          workspaceId: c.workspaceId,
          plantId: c.plantId!,
          brickSizeId: item.brickSizeId,
          type: InventoryMovementType.SALE,
          quantity: new Prisma.Decimal(-item.quantity),
          referenceType: 'Sale',
          referenceId: sale.id,
          reason: `Vente ${sale.invoiceNumber}`,
          createdById: c.userId,
        })),
      });

      let payment = null;
      if (input.initialPayment) {
        payment = await tx.salePayment.create({
          data: {
            saleId: sale.id,
            amount: fromCents(initialPaymentCents),
            method: input.initialPayment.method,
            cashAccountId: input.initialPayment.cashAccountId ?? null,
            note: input.initialPayment.note,
            receivedById: c.userId,
          },
        });
        await recordCashMovement(tx, {
          accountId: input.initialPayment.cashAccountId,
          type: 'IN',
          amount: fromCents(initialPaymentCents),
          referenceType: 'SalePayment',
          referenceId: payment.id,
          reason: `Paiement vente ${sale.invoiceNumber}`,
          createdById: c.userId,
        });
      }

      await audit(tx, c, 'sale.created', 'Sale', sale.id, {
        invoiceNumber: sale.invoiceNumber,
        customerId: customer.id,
        totalAmount: fromCents(totalCents).toString(),
        itemCount: input.items.length,
        initialPaymentAmount: payment ? fromCents(initialPaymentCents).toString() : '0',
      });
      return { sale, payment };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const paidAmount = created.payment ? Number(created.payment.amount) : 0;
    response.status(201).json({ data: { ...created.sale, totalAmount: Number(created.sale.totalAmount), paidAmount, balance: Number(created.sale.totalAmount) - paidAmount } });
  } catch (error) { next(error); }
});

salesRouter.post('/sales/:id/payments', allowRoles(...financeRoles), async (request, response, next) => {
  const input = parseBody(request, response, paymentSchema);
  if (!input) return;
  try {
    const c = contextOf(request);
    const saleId = routeParam(request, 'id');
    const payment = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId, workspaceId: c.workspaceId, plantId: c.plantId!, status: RecordStatus.POSTED },
      });
      if (!sale) throw new ApiError(404, 'SALE_NOT_FOUND', 'Vente introuvable.');
      const totalCents = cents(Number(sale.totalAmount));
      const existingPayments = await tx.salePayment.findMany({ where: { saleId: sale.id }, select: { amount: true } });
      const alreadyPaidCents = existingPayments.reduce((sum, row) => sum + cents(Number(row.amount)), 0);
      const amountCents = cents(input.amount);
      if (amountCents <= 0) throw new ApiError(400, 'INVALID_PAYMENT_AMOUNT', 'Un paiement doit être supérieur à zéro.');
      if (alreadyPaidCents + amountCents > totalCents) throw new ApiError(400, 'PAYMENT_EXCEEDS_BALANCE', 'Le paiement dépasse le solde restant.', { balance: fromCents(totalCents - alreadyPaidCents).toString() });
      await validatePaymentAccount(tx, input.cashAccountId, c.workspaceId, c.plantId!);

      const createdPayment = await tx.salePayment.create({
        data: {
          saleId: sale.id,
          amount: fromCents(amountCents),
          method: input.method,
          cashAccountId: input.cashAccountId ?? null,
          note: input.note,
          receivedById: c.userId,
        },
      });
      await recordCashMovement(tx, {
        accountId: input.cashAccountId,
        type: 'IN',
        amount: fromCents(amountCents),
        referenceType: 'SalePayment',
        referenceId: createdPayment.id,
        reason: `Paiement vente ${sale.invoiceNumber}`,
        createdById: c.userId,
      });
      await audit(tx, c, 'sale.payment.created', 'SalePayment', createdPayment.id, {
        saleId: sale.id,
        amount: fromCents(amountCents).toString(),
        method: input.method,
        cashAccountId: input.cashAccountId ?? null,
      });
      return createdPayment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    response.status(201).json({ data: payment });
  } catch (error) { next(error); }
});

salesRouter.get('/customers/:id/statement', allowRoles(...financeRoles), async (request, response, next) => {
  try {
    const c = contextOf(request);
    const customer = await prisma.customer.findFirst({
      where: { id: routeParam(request, 'id'), workspaceId: c.workspaceId, plantId: c.plantId! },
    });
    if (!customer) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Client introuvable pour cette usine.');

    const where: Prisma.SaleWhereInput = {
      workspaceId: c.workspaceId,
      plantId: c.plantId!,
      customerId: customer.id,
      status: RecordStatus.POSTED,
    };
    const page = pagination(request);
    const [sales, count, totals, paymentTotals] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: { items: { include: { brickSize: true } }, payments: true },
        orderBy: [{ saleDate: 'desc' }, { createdAt: 'desc' }],
        ...page,
      }),
      prisma.sale.count({ where }),
      prisma.sale.aggregate({ where, _sum: { totalAmount: true } }),
      prisma.salePayment.aggregate({
        where: { sale: where },
        _sum: { amount: true },
      }),
    ]);
    const pageNumber = Math.floor(page.skip / page.take) + 1;
    response.json({
      data: {
        customer,
        sales: sales.map((sale) => {
          const paidAmount = sale.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
          const totalAmount = Number(sale.totalAmount);
          return { ...sale, totalAmount, paidAmount, balance: Math.max(0, totalAmount - paidAmount) };
        }),
        totals: {
          invoiced: Number(totals._sum.totalAmount ?? 0),
          paid: Number(paymentTotals._sum.amount ?? 0),
          balance: Number(totals._sum.totalAmount ?? 0) - Number(paymentTotals._sum.amount ?? 0),
        },
        pagination: { page: pageNumber, limit: page.take, total: count, pages: Math.ceil(count / page.take) },
      },
    });
  } catch (error) { next(error); }
});
