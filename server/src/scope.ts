import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from './db';
import type { AuthRequest } from './auth';

export type RequestContext = {
  userId: string;
  workspaceId: string;
  plantId: string | null;
  role: Role;
};

export type ScopedRequest = AuthRequest & { context?: RequestContext };

export async function requireWorkspace(request: Request, response: Response, next: NextFunction) {
  const req = request as ScopedRequest;
  if (!req.user) {
    response.status(401).json({ error: 'AUTH_REQUIRED' });
    return;
  }
  try {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: req.user.id },
      include: { workspace: { include: { plants: { select: { id: true } } } }, plantAccess: { select: { plantId: true } } },
      orderBy: { workspace: { createdAt: 'asc' } },
    });
    if (!memberships.length) {
      response.status(409).json({ error: 'WORKSPACE_REQUIRED', message: 'Créez un workspace pour commencer.' });
      return;
    }
    const requestedWorkspaceId = request.get('x-workspace-id') || (typeof request.query.workspaceId === 'string' ? request.query.workspaceId : undefined);
    if (!requestedWorkspaceId && memberships.length > 1) {
      response.status(409).json({ error: 'WORKSPACE_CONTEXT_REQUIRED', message: 'Choisissez un workspace dans PlantFlow.' });
      return;
    }
    const membership = requestedWorkspaceId
      ? memberships.find((item) => item.workspaceId === requestedWorkspaceId)
      : memberships[0];
    if (!membership) {
      response.status(403).json({ error: 'WORKSPACE_ACCESS_DENIED' });
      return;
    }
    const plantIds = membership.role === 'OWNER' || membership.role === 'MANAGER'
      ? membership.workspace.plants.map((plant) => plant.id)
      : membership.plantAccess.map((access) => access.plantId);
    const requestedPlantId = request.get('x-plant-id') || (typeof request.query.plantId === 'string' ? request.query.plantId : undefined);
    if (requestedPlantId && !plantIds.includes(requestedPlantId)) {
      response.status(403).json({ error: 'PLANT_ACCESS_DENIED', message: 'Vous n’avez pas accès à cette usine.' });
      return;
    }
    req.context = {
      userId: req.user.id,
      workspaceId: membership.workspaceId,
      plantId: requestedPlantId ?? (plantIds.length === 1 ? plantIds[0] : null),
      role: membership.role,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePlant(request: Request, response: Response, next: NextFunction) {
  const req = request as ScopedRequest;
  if (!req.context?.plantId) {
    response.status(409).json({ error: 'PLANT_CONTEXT_REQUIRED', message: 'Choisissez une usine accessible avant de saisir ou consulter ces opérations.' });
    return;
  }
  next();
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
