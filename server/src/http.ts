import type { Prisma, Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { ScopedRequest, RequestContext } from './scope';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message = code, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}


export function parseDateBound(value: unknown, endOfDay = false): Date | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = value.trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const date = new Date(isDateOnly ? `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : text);
  if (Number.isNaN(date.getTime()) || (isDateOnly && date.toISOString().slice(0, 10) !== text)) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', 'La date fournie est invalide.');
  }
  return date;
}

export function contextOf(request: Request): RequestContext {
  const context = (request as ScopedRequest).context;
  if (!context) throw new Error('REQUEST_CONTEXT_MISSING');
  return context;
}

export function routeParam(request: Request, key: string): string {
  const value = request.params[key];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export function userIdOf(request: Request): string {
  const user = (request as ScopedRequest).user;
  if (!user) throw new Error('AUTH_CONTEXT_MISSING');
  return user.id;
}

export function parseBody<T extends z.ZodTypeAny>(request: Request, response: Response, schema: T): z.infer<T> | null {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    return null;
  }
  return parsed.data;
}

export function allowRoles(...roles: Role[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const req = request as ScopedRequest;
    if (!req.context || !roles.includes(req.context.role)) {
      response.status(403).json({ error: 'ROLE_FORBIDDEN', message: 'Votre rôle ne permet pas cette action.' });
      return;
    }
    next();
  };
}

export async function audit(
  tx: Prisma.TransactionClient,
  context: RequestContext,
  action: string,
  entity: string,
  entityId?: string,
  metadata?: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({ data: { workspaceId: context.workspaceId, userId: context.userId, action, entity, entityId, metadata } });
}

export function pagination(request: Request) {
  const page = Math.max(1, Number.parseInt(String(request.query.page ?? '1'), 10) || 1);
  const take = Math.min(100, Math.max(1, Number.parseInt(String(request.query.limit ?? '50'), 10) || 50));
  return { skip: (page - 1) * take, take };
}

export function dateFilter(request: Request, key = 'date') {
  const validFrom = parseDateBound(request.query.from);
  const validTo = parseDateBound(request.query.to, true);
  if (validFrom && validTo && validFrom > validTo) throw new ApiError(400, 'INVALID_DATE_RANGE', 'La date from doit être antérieure ou égale à to.');
  if (!validFrom && !validTo) return {};
  return { [key]: { ...(validFrom ? { gte: validFrom } : {}), ...(validTo ? { lte: validTo } : {}) } };
}

export const managementRoles: Role[] = ['OWNER', 'MANAGER'];
export const operationalRoles: Role[] = ['OWNER', 'MANAGER', 'STAFF'];
export const financeRoles: Role[] = ['OWNER', 'MANAGER', 'CASHIER'];

export async function currentMaterialBalance(tx: Prisma.TransactionClient, workspaceId: string, plantId: string, materialId: string) {
  const result = await tx.inventoryMovement.aggregate({ where: { workspaceId, plantId, materialId }, _sum: { quantity: true } });
  return Number(result._sum.quantity ?? 0);
}

export async function currentBrickBalance(tx: Prisma.TransactionClient, workspaceId: string, plantId: string, brickSizeId: string) {
  const result = await tx.inventoryMovement.aggregate({ where: { workspaceId, plantId, brickSizeId }, _sum: { quantity: true } });
  return Number(result._sum.quantity ?? 0);
}

export async function recordCashMovement(
  tx: Prisma.TransactionClient,
  input: { accountId?: string | null; type: 'IN' | 'OUT'; amount: Prisma.Decimal | string | number; referenceType: string; referenceId: string; reason: string; createdById: string },
) {
  if (!input.accountId) return;
  await tx.cashTransaction.create({ data: {
    accountId: input.accountId,
    type: input.type,
    amount: input.amount,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    reason: input.reason,
    createdById: input.createdById,
  } });
}
