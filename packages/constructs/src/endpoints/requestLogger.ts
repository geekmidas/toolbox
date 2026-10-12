import type { Logger } from '@geekmidas/logger';

/** What an endpoint contributes to every line logged for one of its requests. */
interface LoggingEndpoint {
	logger: Logger;
	fullPath: string;
	route: string;
	method: string;
}

/**
 * The logger for one request to `endpoint`: the surface's, bound with which
 * request it is and what it was for — the request id, the endpoint, its route
 * and method — plus whatever the adaptor knows of the request itself (host,
 * path, the Lambda and API Gateway context).
 *
 * One per request, made once, and the one the request context carries: the
 * handler logs through it, a service reaches it through the context, and
 * identifying the request (`identifyRequest`) derives the signed-in user's
 * logger from it — so a line says whose request it was without losing which
 * route it came from. A field the request does not have is left out rather
 * than logged as `undefined`.
 */
export function requestLogger<TLogger extends Logger>(
	endpoint: LoggingEndpoint,
	fields: { requestId: string } & Record<string, unknown>,
): TLogger {
	const { requestId, ...request } = fields;
	const bindings: Record<string, unknown> = {
		requestId,
		endpoint: endpoint.fullPath,
		route: endpoint.route,
		method: endpoint.method,
	};
	for (const [key, value] of Object.entries(request)) {
		if (value !== undefined) bindings[key] = value;
	}
	return endpoint.logger.child(bindings) as TLogger;
}
