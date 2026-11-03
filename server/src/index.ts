import { Prisma } from '@prisma/client';
import dotenv from 'dotenv';
import express, { type ErrorRequestHandler } from 'express';
import path from 'node:path';
import { prisma } from './db';
import { authRouter, requireAuth, requireCsrf, type AuthRequest } from './auth';
import { ApiError } from './http';
import { requireWorkspace } from './scope';
import { workspaceRouter, setupRouter } from './routes/setup';
import { productionRouter } from './routes/production';
import { salesRouter } from './routes/sales';
import { purchasesRouter } from './routes/purchases';
import { labourRouter } from './routes/labour';
import { financeRouter } from './routes/finance';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 5000);
const clientDist = path.resolve(process.cwd(), 'dist');
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/api/health', async (_request, response) => {
  if (!process.env.POSTGRES_DATABASE_URL) {
    response.status(503).json({ service: 'plantflow-api', status: 'degraded', database: 'POSTGRES_DATABASE_URL is not configured' });
    return;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ service: 'plantflow-api', status: 'ok', database: 'postgres-ready' });
  } catch {
    response.status(503).json({ service: 'plantflow-api', status: 'degraded', database: 'unavailable' });
  }
});

const api = express.Router();
api.use('/auth', authRouter);
api.use(requireAuth);
api.use(requireCsrf);

api.get('/me', async (request, response, next) => {
  try {
    const user = (request as AuthRequest).user!;
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      include: {
        workspace: { include: { plants: { select: { id: true, name: true, city: true, currency: true } } } },
        plantAccess: { select: { plantId: true } },
      },
      orderBy: { workspace: { createdAt: 'asc' } },
    });
    const workspaces = memberships.map((membership) => {
      const allowedPlantIds = membership.role === 'OWNER' || membership.role === 'MANAGER'
        ? membership.workspace.plants.map((plant) => plant.id)
        : membership.plantAccess.map((access) => access.plantId);
      return {
        id: membership.workspace.id,
        name: membership.workspace.name,
        role: membership.role,
        plants: membership.workspace.plants.filter((plant) => allowedPlantIds.includes(plant.id)),
        allowedPlantIds,
      };
    });
    response.json({ data: { user: { id: user.id, email: user.email, name: user.name }, workspaces } });
  } catch (error) { next(error); }
});

api.use('/workspaces', workspaceRouter);
api.use(requireWorkspace);
api.use(setupRouter);
api.use(productionRouter);
api.use(salesRouter);
api.use(purchasesRouter);
api.use(labourRouter);
api.use(financeRouter);
api.use((_request, response) => response.status(404).json({ error: 'NOT_FOUND' }));
app.use('/api/v1', api);
app.use('/api', (_request, response) => response.status(404).json({ error: 'NOT_FOUND' }));

app.use(express.static(clientDist, { index: false, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get(/.*/, (_request, response, next) => {
  response.sendFile(path.join(clientDist, 'index.html'), (error) => {
    if (error && !response.headersSent) next(error);
  });
});

const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      response.status(409).json({ error: 'UNIQUE_CONFLICT', message: 'Un enregistrement avec ces informations existe déjà.' });
      return;
    }
    if (error.code === 'P2025') {
      response.status(404).json({ error: 'RECORD_NOT_FOUND' });
      return;
    }
    if (error.code === 'P2034') {
      response.status(409).json({ error: 'TRANSACTION_CONFLICT', message: 'Une opération simultanée a modifié ces données. Réessayez.' });
      return;
    }
  }
  console.error('PlantFlow request failed', { path: request.path, error });
  response.status(500).json({ error: 'INTERNAL_ERROR', message: 'Une erreur inattendue est survenue.' });
};
app.use(errorHandler);

app.listen(port, '0.0.0.0', () => {
  console.log(`PlantFlow listening on http://0.0.0.0:${port}`);
});
