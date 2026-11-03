import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { plantFlowPrisma?: PrismaClient };

export const prisma = globalForPrisma.plantFlowPrisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.plantFlowPrisma = prisma;
}
