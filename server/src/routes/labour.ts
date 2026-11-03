import { PaymentMethod, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, audit, contextOf, financeRoles, parseBody, parseDateBound, pagination, recordCashMovement, allowRoles } from '../http';
import { requirePlant } from '../scope';

export const labourRouter = Router();
labourRouter.use(requirePlant);

labourRouter.get('/labour-entries', allowRoles(...financeRoles), async (request, response, next) => {
  try {
    const c = contextOf(request);
    const from = parseDateBound(request.query.from);
    const to = parseDateBound(request.query.to, true);
    if (from && to && from > to) throw new ApiError(400, 'INVALID_DATE_RANGE', 'La date from doit être antérieure ou égale à to.');
    const workerId = typeof request.query.workerId === 'string' ? request.query.workerId : undefined;
    const rows = await prisma.labourEntry.findMany({
      where: {
        workspaceId: c.workspaceId,
        plantId: c.plantId!,
        ...(workerId ? { workerId } : {}),
        ...((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))
          ? { workDate: { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}) } }
          : {}),
      },
      include: { worker: true, production: true, payments: true },
      orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
      ...pagination(request),
    });
    response.json({ data: rows });
  } catch (error) { next(error); }
});

const labourEntryInput = z.object({
  workerId: z.string().uuid().optional().nullable(),
  teamName: z.string().trim().min(1).max(120).optional().nullable(),
  workDate: z.coerce.date(),
  amount: z.coerce.number().positive().max(999999999999.99),
  quantity: z.coerce.number().positive().max(99999999999.999).optional().nullable(),
  productionId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
}).refine((value) => Boolean(value.workerId) !== Boolean(value.teamName), {
  message: 'Indiquez soit un travailleur, soit un nom d’équipe.',
  path: ['workerId'],
});

labourRouter.post('/labour-entries', allowRoles(...financeRoles), async (request, response, next) => {
  const input = parseBody(request, response, labourEntryInput);
  if (!input) return;
  try {
    const c = contextOf(request);
    const [worker, production] = await Promise.all([
      input.workerId
        ? prisma.worker.findFirst({ where: { id: input.workerId, workspaceId: c.workspaceId, plantId: c.plantId!, active: true } })
        : Promise.resolve(null),
      input.productionId
        ? prisma.productionEntry.findFirst({ where: { id: input.productionId, workspaceId: c.workspaceId, plantId: c.plantId! } })
        : Promise.resolve(null),
    ]);
    if (input.workerId && !worker) throw new ApiError(404, 'WORKER_NOT_FOUND', 'Travailleur introuvable ou inactif dans cette usine.');
    if (input.productionId && !production) throw new ApiError(404, 'PRODUCTION_NOT_FOUND', 'Production introuvable dans cette usine.');

    const created = await prisma.$transaction(async (tx) => {
      const entry = await tx.labourEntry.create({ data: {
        workspaceId: c.workspaceId,
        plantId: c.plantId!,
        workerId: worker?.id,
        teamName: input.teamName || undefined,
        productionId: production?.id,
        workDate: input.workDate,
        amount: new Prisma.Decimal(input.amount),
        quantity: input.quantity == null ? undefined : new Prisma.Decimal(input.quantity),
        notes: input.notes,
        createdById: c.userId,
        status: 'POSTED',
      }, include: { worker: true, production: true } });
      await audit(tx, c, 'labour.created', 'LabourEntry', entry.id, {
        workerId: entry.workerId,
        teamName: entry.teamName,
        productionId: entry.productionId,
        amount: input.amount,
      });
      return entry;
    });
    response.status(201).json({ data: created });
  } catch (error) { next(error); }
});

const labourPaymentInput = z.object({
  workerId: z.string().uuid().optional().nullable(),
  labourEntryId: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive().max(999999999999.99),
  method: z.nativeEnum(PaymentMethod),
  paidAt: z.coerce.date(),
  cashAccountId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
}).refine((value) => Boolean(value.workerId) || Boolean(value.labourEntryId), {
  message: 'Indiquez un travailleur et/ou une entrée de main-d’œuvre.',
  path: ['workerId'],
});

labourRouter.post('/labour-payments', allowRoles(...financeRoles), async (request, response, next) => {
  const input = parseBody(request, response, labourPaymentInput);
  if (!input) return;
  try {
    const c = contextOf(request);
    const result = await prisma.$transaction(async (tx) => {
      const [worker, entry, cashAccount] = await Promise.all([
        input.workerId
          ? tx.worker.findFirst({ where: { id: input.workerId, workspaceId: c.workspaceId, plantId: c.plantId!, active: true } })
          : Promise.resolve(null),
        input.labourEntryId
          ? tx.labourEntry.findFirst({ where: { id: input.labourEntryId, workspaceId: c.workspaceId, plantId: c.plantId!, status: 'POSTED' } })
          : Promise.resolve(null),
        input.cashAccountId
          ? tx.cashAccount.findFirst({ where: { id: input.cashAccountId, workspaceId: c.workspaceId, plantId: c.plantId!, active: true } })
          : Promise.resolve(null),
      ]);
      if (input.workerId && !worker) throw new ApiError(404, 'WORKER_NOT_FOUND', 'Travailleur introuvable ou inactif dans cette usine.');
      if (input.labourEntryId && !entry) throw new ApiError(404, 'LABOUR_ENTRY_NOT_FOUND', 'Entrée de main-d’œuvre introuvable dans cette usine.');
      if (input.cashAccountId && !cashAccount) throw new ApiError(404, 'CASH_ACCOUNT_NOT_FOUND', 'Compte de caisse introuvable ou inactif dans cette usine.');
      if (entry && worker && entry.workerId !== worker.id) {
        throw new ApiError(400, 'LABOUR_WORKER_MISMATCH', 'L’entrée sélectionnée n’appartient pas à ce travailleur.');
      }

      const resolvedWorkerId = worker?.id ?? entry?.workerId ?? null;
      let outstanding: Prisma.Decimal | null = null;
      if (entry) {
        const [entryPayments, workerEntries, workerPayments] = await Promise.all([
          tx.labourPayment.aggregate({
            where: { workspaceId: c.workspaceId, plantId: c.plantId!, labourEntryId: entry.id },
            _sum: { amount: true },
          }),
          resolvedWorkerId
            ? tx.labourEntry.findMany({
              where: { workspaceId: c.workspaceId, plantId: c.plantId!, workerId: resolvedWorkerId, status: 'POSTED' },
              select: { id: true, amount: true },
            })
            : Promise.resolve([]),
          resolvedWorkerId
            ? tx.labourPayment.aggregate({
              where: { workspaceId: c.workspaceId, plantId: c.plantId!, workerId: resolvedWorkerId },
              _sum: { amount: true },
            })
            : Promise.resolve(null),
        ]);
        const entryDue = new Prisma.Decimal(entry.amount).minus(entryPayments._sum.amount ?? 0);
        outstanding = entryDue;
        if (resolvedWorkerId) {
          const workerEntryIds = workerEntries.map((row) => row.id);
          const linkedEntryPayments = await tx.labourPayment.aggregate({
            where: {
              workspaceId: c.workspaceId,
              plantId: c.plantId!,
              labourEntryId: { in: workerEntryIds },
              workerId: null,
            },
            _sum: { amount: true },
          });
          const totalOwed = workerEntries.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
          const workerDue = totalOwed
            .minus(workerPayments?._sum.amount ?? 0)
            .minus(linkedEntryPayments._sum.amount ?? 0);
          if (workerDue.lessThan(outstanding)) outstanding = workerDue;
        }
      } else if (resolvedWorkerId) {
        const workerEntries = await tx.labourEntry.findMany({
          where: { workspaceId: c.workspaceId, plantId: c.plantId!, workerId: resolvedWorkerId, status: 'POSTED' },
          select: { id: true, amount: true },
        });
        const entryIds = workerEntries.map((row) => row.id);
        const [workerPayments, entryOnlyPayments] = await Promise.all([
          tx.labourPayment.aggregate({
            where: { workspaceId: c.workspaceId, plantId: c.plantId!, workerId: resolvedWorkerId },
            _sum: { amount: true },
          }),
          tx.labourPayment.aggregate({
            where: { workspaceId: c.workspaceId, plantId: c.plantId!, labourEntryId: { in: entryIds }, workerId: null },
            _sum: { amount: true },
          }),
        ]);
        const totalOwed = workerEntries.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
        outstanding = totalOwed.minus(workerPayments._sum.amount ?? 0).minus(entryOnlyPayments._sum.amount ?? 0);
      }

      const amount = new Prisma.Decimal(input.amount);
      if (outstanding === null) throw new ApiError(400, 'PAYMENT_TARGET_REQUIRED');
      if (outstanding.lessThanOrEqualTo(0) || amount.greaterThan(outstanding)) {
        throw new ApiError(409, 'PAYMENT_EXCEEDS_DUE', 'Le paiement dépasse le montant restant dû.', { outstanding: Math.max(0, Number(outstanding.toFixed(2))) });
      }

      const payment = await tx.labourPayment.create({ data: {
        workspaceId: c.workspaceId,
        plantId: c.plantId!,
        workerId: resolvedWorkerId ?? undefined,
        labourEntryId: entry?.id,
        cashAccountId: cashAccount?.id,
        amount,
        method: input.method,
        paidAt: input.paidAt,
        note: input.note,
        paidById: c.userId,
      }, include: { worker: true, labourEntry: true, cashAccount: true } });
      if (cashAccount) {
        await recordCashMovement(tx, {
          accountId: cashAccount.id,
          type: 'OUT',
          amount,
          referenceType: 'LabourPayment',
          referenceId: payment.id,
          reason: input.note || 'Paiement de main-d’œuvre',
          createdById: c.userId,
        });
      }
      await audit(tx, c, 'labour.payment.created', 'LabourPayment', payment.id, {
        workerId: payment.workerId,
        labourEntryId: payment.labourEntryId,
        amount: input.amount,
        method: input.method,
        cashAccountId: payment.cashAccountId,
      });
      return payment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    response.status(201).json({ data: result });
  } catch (error) { next(error); }
});
