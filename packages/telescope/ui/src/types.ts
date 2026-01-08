export interface RequestEntry {
	id: string;
	method: string;
	path: string;
	url: string;
	headers: Record<string, string>;
	body?: unknown;
	query?: Record<string, string>;
	status: number;
	responseHeaders: Record<string, string>;
	responseBody?: unknown;
	duration: number;
	timestamp: string;
	ip?: string;
	userId?: string;
	tags?: string[];
}

export interface ExceptionEntry {
	id: string;
	name: string;
	message: string;
	stack: Array<{
		file?: string;
		line?: number;
		column?: number;
		function?: string;
	}>;
	source?: {
		file?: string;
		line?: number;
		code?: string;
	};
	requestId?: string;
	timestamp: string;
	handled: boolean;
	tags?: string[];
}

export interface LogEntry {
	id: string;
	level: 'debug' | 'info' | 'warn' | 'error';
	message: string;
	context?: Record<string, unknown>;
	requestId?: string;
	timestamp: string;
}

export interface TelescopeStats {
	requests: number;
	exceptions: number;
	logs: number;
	oldestEntry?: string;
	newestEntry?: string;
}

export type Tab = 'requests' | 'exceptions' | 'logs';

export interface WebSocketMessage {
	type: 'request' | 'exception' | 'log' | 'connected';
	payload: unknown;
	timestamp: number;
}
