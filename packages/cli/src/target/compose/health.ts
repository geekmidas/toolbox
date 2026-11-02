/**
 * Asking each app of a stack whether it answers — through Caddy, over HTTPS,
 * the way a browser reaches it.
 *
 * `docker compose up --wait` already knows each container passed its own
 * health check, asked on 127.0.0.1 inside it. What that cannot say is whether
 * the stack is reachable: whether the edge routes the host to the app, and
 * whether the certificate it presents is one a client accepts. So the check
 * goes through the edge, by hostname, and verifies the certificate.
 */

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { EDGE_PROJECT } from '../../compose/traefik';
import { GkmError } from '../../errors';

/** One request to the edge. */
export interface HealthRequest {
	/** The app's public URL plus its health path. */
	url: string;
	/**
	 * The certificate authority to verify against, PEM — gkm's local CA on
	 * the local stage. The system's when absent.
	 */
	ca?: string;
	/**
	 * Connect here instead of resolving the URL's host — the local edge, at
	 * 127.0.0.1. The host is still sent as SNI and `Host`, so nothing depends
	 * on how this machine resolves `*.localhost`.
	 */
	connectTo?: string;
	/**
	 * With `connectTo`, the port to connect to, where it is not the URL's —
	 * the shared edge's published port, asked for a deployed host.
	 */
	connectPort?: number;
	/**
	 * The `Authorization` header to send — a site the stage puts behind a
	 * password is asked with its login, which proves the login works too.
	 */
	authorization?: string;
	timeoutMs: number;
	signal?: AbortSignal;
}

/** Asks once, resolving with the HTTP status. Rejects when nothing answers. */
export type HealthProbe = (request: HealthRequest) => Promise<number>;

/** A request that got no answer in time. */
export class HealthRequestTimedOut extends GkmError {
	constructor(
		readonly url: string,
		readonly timeoutMs: number,
	) {
		super(
			`${url} did not answer within ${timeoutMs}ms. Check the stack is up with \`docker compose ps\`.`,
		);
		this.name = 'HealthRequestTimedOut';
	}
}

/** What the edge answered: its status, and the body where it was asked for. */
export interface EdgeResponse {
	status: number;
	/** The body, as text — empty unless the request asked to `read` it. */
	body: string;
	/** The response's headers, by lower-case name. */
	headers?: Readonly<Record<string, string | string[] | undefined>>;
}

/** A request to the edge, and whether its body is wanted. */
export interface EdgeRequest extends HealthRequest {
	/** Read the body, up to {@link EDGE_BODY_LIMIT} bytes; drained otherwise. */
	read?: boolean;
	/** Headers sent besides `Host` and `Authorization`. */
	headers?: Readonly<Record<string, string>>;
}

/** Asks once. Rejects when nothing answers. */
export type EdgeFetch = (request: EdgeRequest) => Promise<EdgeResponse>;

/** The most of a body read — a sitemap may be 50 MB, and none needs to be. */
export const EDGE_BODY_LIMIT = 10 * 1024 * 1024;

/** A body larger than {@link EDGE_BODY_LIMIT}. */
export class EdgeResponseTooLarge extends GkmError {
	constructor(
		readonly url: string,
		readonly limit: number,
	) {
		super(
			`${url} answered with more than ${limit} bytes, which is more than gkm reads. Split it — a sitemap index can list several sitemaps.`,
		);
		this.name = 'EdgeResponseTooLarge';
	}
}

/**
 * The real request: one GET to the edge — over HTTPS, the certificate
 * verified, for an `https:` URL, and plain HTTP for an `http:` one — with
 * the URL's host as SNI and `Host` wherever it connects.
 */
export const edgeFetch: EdgeFetch = ({
	url,
	ca,
	connectTo,
	connectPort,
	authorization,
	timeoutMs,
	signal,
	read,
	headers,
}) => {
	const target = new URL(url);
	const secure = target.protocol === 'https:';
	const request = secure ? httpsRequest : httpRequest;
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: connectTo ?? target.hostname,
				port: connectPort ?? (target.port || (secure ? 443 : 80)),
				...(secure ? { servername: target.hostname } : {}),
				path: `${target.pathname}${target.search}`,
				method: 'GET',
				headers: {
					...headers,
					host: target.host,
					...(authorization ? { authorization } : {}),
				},
				...(secure && ca ? { ca } : {}),
				...(signal ? { signal } : {}),
				timeout: timeoutMs,
			},
			(res) => {
				const status = res.statusCode ?? 0;
				const answered = { status, headers: res.headers };
				if (!read) {
					// The status is the answer; the body is drained so the socket closes.
					res.resume();
					res.on('end', () => resolve({ ...answered, body: '' }));
					res.on('error', reject);
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				res.on('data', (chunk: Buffer) => {
					size += chunk.length;
					if (size > EDGE_BODY_LIMIT) {
						req.destroy(new EdgeResponseTooLarge(url, EDGE_BODY_LIMIT));
						return;
					}
					chunks.push(chunk);
				});
				res.on('end', () =>
					resolve({
						...answered,
						body: Buffer.concat(chunks).toString('utf-8'),
					}),
				);
				res.on('error', reject);
			},
		);
		req.on('timeout', () =>
			req.destroy(new HealthRequestTimedOut(url, timeoutMs)),
		);
		req.on('error', reject);
		req.end();
	});
};

/** The real probe: one GET through the edge, answered by its status. */
export const httpsProbe: HealthProbe = (request) =>
	edgeFetch(request).then(({ status }) => status);

/** Whether a status means the app answered as it should. */
export function isHealthy(status: number): boolean {
	return status >= 200 && status < 400;
}

/**
 * Apps that are not healthy. `via` says which check said so:
 * - `edge`: verify asked each app through the edge, by its host, and it did
 *   not answer as it should (a worker, with no route, by its container's
 *   health);
 * - `docker`: `up --wait` failed, and these containers' own health checks
 *   had not passed — the rest of the stack was released and routed first.
 * One class either way, so a caller matches one failure: apps not healthy.
 */
export class ComposeAppsUnhealthy extends GkmError {
	constructor(
		readonly project: string,
		/**
		 * Each app, and the last thing its check got: a status or an error —
		 * for `docker`, the container's health as Docker reports it.
		 */
		readonly apps: readonly { app: string; url: string; last: string }[],
		/** The proxy the stack is served through. */
		readonly proxy: 'caddy' | 'traefik' = 'caddy',
		/** Which check failed: through the edge, or Docker's own. */
		readonly via: 'edge' | 'docker' = 'edge',
	) {
		const names = apps.map((a) => a.app).join(' ');
		super(
			via === 'docker'
				? `${project} started, but ${apps.length === 1 ? "this container's health check has" : "these containers' health checks have"} not passed. The rest of the stack is up and routed:\n` +
						apps
							.map(({ app, last }) => `  - ${app}: Docker reports it ${last}`)
							.join('\n') +
						`\nSee why with \`docker compose -p ${project} ps ${names}\` and \`docker compose -p ${project} logs ${names}\`, fix the app, and deploy again.`
				: `${project} started, but ${apps.length === 1 ? 'this app does' : 'these apps do'} not answer through ${proxy === 'caddy' ? 'Caddy' : 'the shared Traefik edge'}:\n` +
						apps.map(({ url, last }) => `  - ${url}: ${last}`).join('\n') +
						(proxy === 'caddy'
							? `\nSee why with \`docker compose -p ${project} logs caddy ${names}\`.`
							: `\nSee why with \`docker compose -p ${EDGE_PROJECT} logs traefik\` and \`docker compose -p ${project} logs ${names}\`.`),
		);
		this.name = 'ComposeAppsUnhealthy';
	}
}
