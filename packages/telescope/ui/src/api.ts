import type {
  ExceptionEntry,
  LogEntry,
  RequestEntry,
  TelescopeStats,
} from './types';

const BASE_URL = '/__telescope/api';

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export async function getRequests(options?: {
  limit?: number;
  offset?: number;
}): Promise<RequestEntry[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  const query = params.toString();
  return fetchJson(`/requests${query ? `?${query}` : ''}`);
}

export async function getRequest(id: string): Promise<RequestEntry | null> {
  try {
    return await fetchJson(`/requests/${id}`);
  } catch {
    return null;
  }
}

export async function getExceptions(options?: {
  limit?: number;
  offset?: number;
}): Promise<ExceptionEntry[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  const query = params.toString();
  return fetchJson(`/exceptions${query ? `?${query}` : ''}`);
}

export async function getException(id: string): Promise<ExceptionEntry | null> {
  try {
    return await fetchJson(`/exceptions/${id}`);
  } catch {
    return null;
  }
}

export async function getLogs(options?: {
  limit?: number;
  offset?: number;
}): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  const query = params.toString();
  return fetchJson(`/logs${query ? `?${query}` : ''}`);
}

export async function getStats(): Promise<TelescopeStats> {
  return fetchJson('/stats');
}

export function createWebSocket(): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return new WebSocket(`${protocol}//${host}/__telescope/ws`);
}
