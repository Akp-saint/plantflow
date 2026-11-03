export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type RequestOptions = Omit<RequestInit, 'credentials'>;
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) { csrfToken = token; }

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const method = (options.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) headers.set('x-plantflow-csrf', csrfToken);
  if (options.body && !headers.has('content-type') && !(options.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  const workspaceId = localStorage.getItem('plantflow.workspaceId');
  const plantId = localStorage.getItem('plantflow.plantId');
  if (workspaceId) headers.set('x-workspace-id', workspaceId);
  if (plantId) headers.set('x-plant-id', plantId);

  const response = await fetch(path, { ...options, headers, credentials: 'include' });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string; details?: unknown };
  if (!response.ok) {
    throw new ApiError(response.status, payload.error ?? 'REQUEST_FAILED', payload.message ?? `La requête a échoué (${response.status}).`, payload.details);
  }
  return payload as T;
}

export function payloadData<T>(payload: unknown): T {
  return (payload as { data: T }).data;
}

export function payloadList<T>(payload: unknown): T[] {
  const data = payloadData<unknown>(payload);
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}

export function apiMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.message}${error.code ? ` (${error.code})` : ''}`;
  if (error instanceof Error) return error.message;
  return 'Une erreur inattendue est survenue.';
}
