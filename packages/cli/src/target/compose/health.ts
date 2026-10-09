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

import { request } from 'node:https';
import { GkmError } from '../../errors';

/** One request to the edge. */
export interface HealthRequest {
	/** The app's public URL plus its health path. */
	url: string;
	/**
	 * The certificate authority to verify against, PEM — Caddy's internal CA
	 * on the local stage. The system's when absent.
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

/** The real probe: one HTTPS GET, the certificate verified. */
export const httpsProbe: HealthProbe = ({
	url,
	ca,
	connectTo,
	connectPort,
	timeoutMs,
	signal,
}) => {
	const target = new URL(url);
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: connectTo ?? target.hostname,
				port: connectPort ?? (target.port || 443),
				servername: target.hostname,
				path: `${target.pathname}${target.search}`,
				method: 'GET',
				headers: { host: target.host },
				...(ca ? { ca } : {}),
				...(signal ? { signal } : {}),
				timeout: timeoutMs,
			},
			(res) => {
				// The status is the answer; the body is drained so the socket closes.
				res.resume();
				res.on('end', () => resolve(res.statusCode ?? 0));
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

/** Whether a status means the app answered as it should. */
export function isHealthy(status: number): boolean {
	return status >= 200 && status < 400;
}

/** Apps that did not answer through the edge. */
export class ComposeAppsUnhealthy extends GkmError {
	constructor(
		readonly project: string,
		/** Each app, and the last thing its check got: a status or an error. */
		readonly apps: readonly { app: string; url: string; last: string }[],
		/** The proxy they were asked through. */
		readonly proxy: 'caddy' | 'traefik' = 'caddy',
	) {
		const names = apps.map((a) => a.app).join(' ');
		super(
			`${project} started, but ${apps.length === 1 ? 'this app does' : 'these apps do'} not answer through ${proxy === 'caddy' ? 'Caddy' : 'the shared Traefik edge'}:\n` +
				apps.map(({ url, last }) => `  - ${url}: ${last}`).join('\n') +
				(proxy === 'caddy'
					? `\nSee why with \`docker compose -p ${project} logs caddy ${names}\`.`
					: `\nSee why with \`docker compose -p gkm-edge logs traefik\` and \`docker compose -p ${project} logs ${names}\`.`),
		);
		this.name = 'ComposeAppsUnhealthy';
	}
}
