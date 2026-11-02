/**
 * The client's address on a session check, through the proxies a stack runs.
 *
 * An API calls its auth server at the auth server's public address, so the
 * call passes the stack's edge — Caddy, or the shared Traefik — like a
 * browser's. The auth server rate-limits `/get-session` per client, by the
 * address the API forwards in `x-gkm-client-ip`; the edge must keep that
 * header for a service of the stack (proven by the stack's token) and drop it
 * from everyone else, so nobody outside picks the bucket they are counted in.
 *
 * Real proxies, rendered by gkm, in front of a real `BetterAuth` server with
 * Better Auth's own rate limiter; the caller is the construct's client, as
 * an API's `.dependsOn([auth])` builds it.
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BetterAuth } from '@geekmidas/constructs/auth';
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { EnvironmentParser } from '@geekmidas/envkit';
import { serviceContext } from '@geekmidas/services';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { DEFAULT_IMAGES } from '../../reconcile/containers';
import { edgeToken } from '../../reconcile/env';
import {
	ensureLocalAuthority,
	issueLocalCertificate,
	localAuthorityPaths,
} from '../../trust/authority';
import { CADDY_TLS_DIR, edgeCaddyfile } from '../caddyfile';
import type { EdgeRoute } from '../routes';
import { TRAEFIK_IMAGE, traefikDynamic } from '../traefik';

const run = promisify(execFile);
const docker = async (...args: string[]) =>
	(await run('docker', args, { maxBuffer: 16 * 1024 * 1024 })).stdout.trim();

const id = randomBytes(4).toString('hex');
/** A name that resolves to this machine, where the proxy publishes its port. */
const HOST = 'localhost';
const TOKEN = edgeToken('client-ip-spec', randomBytes(16).toString('hex'));
const DATABASE = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
/** A first run pulls both images. */
const SETUP_TIMEOUT = 180_000;

/**
 * The auth server on a real socket, as its generated entry serves it, two
 * session checks per client per minute — with the stack's token.
 */
async function authServer(
	basePath: string,
): Promise<{ server: Server; port: number }> {
	const counts = new Map<string, number>();
	const auth = new BetterAuth('Auth', {
		database: new KyselyDatabase('AuthDb'),
		path: 'apps/auth',
		basePath,
		options: {
			rateLimit: {
				enabled: true,
				window: 60,
				max: 2,
				// Its own count: Better Auth's memory store is one per process.
				customStorage: {
					async consume(key: string, rule: { max: number }) {
						const count = (counts.get(key) ?? 0) + 1;
						counts.set(key, count);
						return count <= rule.max
							? { allowed: true, retryAfter: null }
							: { allowed: false, retryAfter: 60 };
					},
				},
			},
		},
	});
	const { app } = await auth.server({
		envParser: new EnvironmentParser({
			AUTH_DB_URL: DATABASE,
			AUTH_SECRET: 'a-signing-secret-that-is-at-least-32-chars',
			AUTH_URL: `https://${HOST}`,
			GKM_EDGE_TOKEN: TOKEN,
		}),
		context: serviceContext,
	} as never);
	const server = createServer(async (req, res) => {
		const headers = new Headers();
		for (const [name, value] of Object.entries(req.headers)) {
			if (typeof value === 'string') headers.set(name, value);
		}
		const response = await app.fetch(
			new Request(`https://${HOST}${req.url}`, { method: req.method, headers }),
			// What `@hono/node-server` hands the app as `c.env`.
			{ incoming: req },
		);
		res.writeHead(response.status, Object.fromEntries(response.headers));
		res.end(Buffer.from(await response.arrayBuffer()));
	});
	// On every interface: the proxy's container reaches it at the host.
	await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
	return { server, port: (server.address() as AddressInfo).port };
}

/** The API's session check for one client, through the proxy on `port`. */
function apiCheck(port: number, basePath: string, token: string | undefined) {
	const { api } = new BetterAuth('Auth', {
		database: new KyselyDatabase('AuthDb'),
		path: 'apps/auth',
		basePath,
	}).client(
		new EnvironmentParser({
			AUTH_URL: `https://${HOST}:${port}`,
			...(token ? { GKM_EDGE_TOKEN: token } : {}),
		}),
	);
	return (client: string) =>
		sessionCheck(() =>
			api.getSession({ headers: { 'x-forwarded-for': client } }),
		);
}

/** 200, or the status the auth server answered with. */
function sessionCheck(check: () => Promise<unknown>): Promise<number> {
	return check().then(
		() => 200,
		(error: { status?: number }) => error.status ?? 0,
	);
}

/** A request from outside, through the proxy, claiming an address. */
function spoofed(
	port: number,
	basePath: string,
	headers: Record<string, string>,
) {
	return fetch(`https://${HOST}:${port}${basePath}/get-session`, {
		headers,
	}).then((r) => r.status);
}

/** The host port Docker published `443` on. */
async function publishedPort(container: string): Promise<number> {
	const out = await docker('port', container, '443/tcp');
	return Number(out.split('\n')[0]!.split(':').pop());
}

/** Asks until the proxy routes the host to the auth server. */
async function ready(port: number, basePath: string): Promise<void> {
	let last: unknown;
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			const status = await fetch(`https://${HOST}:${port}${basePath}/ok`).then(
				(r) => r.status,
			);
			if (status === 200) return;
			last = `HTTP ${status}`;
		} catch (error) {
			last = error;
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`the proxy on ${port} never routed ${HOST}: ${last}`);
}

/** What both proxies must do. */
function itKeepsTheStacksClientAddressOnly(
	port: () => number,
	basePath: string,
) {
	it("rate-limits each client of the API by its own address, through the edge, on the stack's token", async () => {
		const check = apiCheck(port(), basePath, TOKEN);
		const ada = '203.0.113.7';
		const grace = '198.51.100.23';

		expect([await check(ada), await check(ada)]).toEqual([200, 200]);
		expect(await check(ada)).toBe(429);
		// Another client of the same API is in a bucket of its own.
		expect(await check(grace)).toBe(200);
	});

	it('drops the header from a request without the token, or with a wrong one', async () => {
		// Each claims an address of its own: believed, none would be limited.
		const claim = () => `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
		const outside = () =>
			spoofed(port(), basePath, { 'x-gkm-client-ip': claim() });
		const guessed = () =>
			spoofed(port(), basePath, {
				'x-gkm-client-ip': claim(),
				'x-gkm-edge-token': 'guessed',
			});

		// All counted as the one peer the proxy saw.
		expect([await outside(), await guessed()]).toEqual([200, 200]);
		expect(await outside()).toBe(429);
	});
}

beforeAll(() => {
	// The proxies' certificate is gkm's local CA's, which this process does
	// not trust; what is under test is the edge, not the chain.
	vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
});

afterAll(() => {
	vi.unstubAllEnvs();
});

describe(
	'a stack calling its own auth server through Caddy',
	{
		timeout: 30_000,
	},
	() => {
		const container = `gkm-client-ip-caddy-${id}`;
		let port = 0;
		let server: { server: Server; port: number };

		beforeAll(async () => {
			server = await authServer('/caddy-auth');
			const route: EdgeRoute = {
				name: 'auth',
				host: HOST,
				upstreams: [{ service: 'host.docker.internal', port: server.port }],
				streaming: false,
			};
			const caddyfile = edgeCaddyfile([route], {
				tls: {
					kind: 'files',
					certFile: `${CADDY_TLS_DIR}/cert.pem`,
					keyFile: `${CADDY_TLS_DIR}/key.pem`,
				},
				edgeToken: TOKEN,
			});
			const dir = await createTempDir('gkm-client-ip-caddy-');
			try {
				const file = join(dir, 'Caddyfile');
				writeFileSync(file, caddyfile);
				const tls = join(dir, 'tls');
				mkdirSync(tls);
				const { cert, key } = issueLocalCertificate(
					await ensureLocalAuthority(localAuthorityPaths(join(dir, 'home'))),
					[HOST],
				);
				writeFileSync(join(tls, 'cert.pem'), cert);
				writeFileSync(join(tls, 'key.pem'), key, { mode: 0o644 });
				await docker(
					'create',
					'--name',
					container,
					'--add-host',
					'host.docker.internal:host-gateway',
					'-p',
					'127.0.0.1::443',
					DEFAULT_IMAGES.caddy!,
				);
				await docker('cp', file, `${container}:/etc/caddy/Caddyfile`);
				await docker('cp', tls, `${container}:${CADDY_TLS_DIR}`);
			} finally {
				await cleanupDir(dir);
			}
			await docker('start', container);
			port = await publishedPort(container);
			await ready(port, '/caddy-auth');
		}, SETUP_TIMEOUT);

		afterAll(async () => {
			await docker('rm', '-f', '-v', container).catch(() => {});
			await new Promise((resolve) => server.server.close(resolve));
		});

		itKeepsTheStacksClientAddressOnly(() => port, '/caddy-auth');
	},
);

describe(
	'a stack calling its own auth server through Traefik',
	{
		timeout: 30_000,
	},
	() => {
		const project = `gkm-client-ip-${id}`;
		const edge = `${project}-traefik`;
		let port = 0;
		let server: { server: Server; port: number };

		beforeAll(async () => {
			server = await authServer('/traefik-auth');
			const route: EdgeRoute = {
				name: 'auth',
				host: HOST,
				upstreams: [{ service: 'auth', port: server.port }],
				streaming: false,
			};
			const { tls: _, ...dynamic } = traefikDynamic([route], {
				project,
				tls: { kind: 'files', certFile: '/x.pem', keyFile: '/x.key' },
				edgeToken: TOKEN,
			});
			// The upstream is this machine, not a container on the edge's network.
			const services = (
				dynamic as { http: { services: Record<string, unknown> } }
			).http.services;
			services[`${project}-auth`] = {
				loadBalancer: {
					servers: [{ url: `http://host.docker.internal:${server.port}` }],
				},
			};

			const dir = await createTempDir('gkm-client-ip-traefik-');
			try {
				const file = join(dir, 'dynamic.yml');
				writeFileSync(file, stringify(dynamic));
				await docker(
					'create',
					'--name',
					edge,
					'--add-host',
					'host.docker.internal:host-gateway',
					'-p',
					'127.0.0.1::443',
					TRAEFIK_IMAGE,
					'--entryPoints.websecure.address=:443',
					'--providers.file.filename=/dynamic.yml',
				);
				await docker('cp', file, `${edge}:/dynamic.yml`);
			} finally {
				await cleanupDir(dir);
			}
			await docker('start', edge);
			port = await publishedPort(edge);
			await ready(port, '/traefik-auth');
		}, SETUP_TIMEOUT);

		afterAll(async () => {
			await docker('rm', '-f', '-v', edge).catch(() => {});
			await new Promise((resolve) => server.server.close(resolve));
		});

		itKeepsTheStacksClientAddressOnly(() => port, '/traefik-auth');
	},
);
