import type {
	ExceptionEntry,
	LogEntry,
	RequestEntry,
	TelescopeStats,
} from './types';

const BASE_URL = '/__telescope/api';

export interface FilterOptions {
	limit?: number;
	offset?: number;
	search?: string;
	before?: string;
	after?: string;
	tags?: string[];
	method?: string;
	status?: string;
	level?: string;
}

async function fetchJson<T>(path: string): Promise<T> {
	const response = await fetch(`${BASE_URL}${path}`);
	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}
	return response.json();
}

function buildQueryString(options?: FilterOptions): string {
	if (!options) return '';

	const params = new URLSearchParams();
	if (options.limit) params.set('limit', String(options.limit));
	if (options.offset) params.set('offset', String(options.offset));
	if (options.search) params.set('search', options.search);
	if (options.before) params.set('before', options.before);
	if (options.after) params.set('after', options.after);
	if (options.tags?.length) params.set('tags', options.tags.join(','));
	if (options.method) params.set('method', options.method);
	if (options.status) params.set('status', options.status);
	if (options.level) params.set('level', options.level);

	const query = params.toString();
	return query ? `?${query}` : '';
}

export async function getRequests(
	options?: FilterOptions,
): Promise<RequestEntry[]> {
	return fetchJson(`/requests${buildQueryString(options)}`);
}

export async function getRequest(id: string): Promise<RequestEntry | null> {
	try {
		return await fetchJson(`/requests/${id}`);
	} catch {
		return null;
	}
}

export async function getExceptions(
	options?: FilterOptions,
): Promise<ExceptionEntry[]> {
	return fetchJson(`/exceptions${buildQueryString(options)}`);
}

export async function getException(id: string): Promise<ExceptionEntry | null> {
	try {
		return await fetchJson(`/exceptions/${id}`);
	} catch {
		return null;
	}
}

export async function getLogs(options?: FilterOptions): Promise<LogEntry[]> {
	return fetchJson(`/logs${buildQueryString(options)}`);
}

export async function getStats(): Promise<TelescopeStats> {
	return fetchJson('/stats');
}

export function createWebSocket(): WebSocket {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	const host = window.location.host;
	return new WebSocket(`${protocol}//${host}/__telescope/ws`);
}
