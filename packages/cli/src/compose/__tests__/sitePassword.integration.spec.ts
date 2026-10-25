/**
 * A site behind a password, through the proxies that serve it: the Caddyfile
 * and the Traefik dynamic config gkm renders, run by the images a stack runs,
 * asked with no login, the wrong one and the stage's.
 *
 * What a unit test of the renderers cannot say is whether either proxy
 * accepts the hash — a bcrypt salt it cannot read is a site nobody can open.
 */

import { execFile } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RandomPassword } from '@geekmidas/constructs/random-password';
import { drawSecret, type SecretDeclaration } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { DEFAULT_IMAGES } from '../../reconcile/containers';
import { edgeCaddyfile } from '../caddyfile';
import type { EdgeRoute } from '../routes';
import { siteAuth } from '../sitePassword';
import { TRAEFIK_IMAGE, traefikDynamic } from '../traefik';

const run = promisify(execFile);
const docker = async (...args: string[]) =>
	(await run('docker', args, { maxBuffer: 16 * 1024 * 1024 })).stdout.trim();

const id = randomBytes(4).toString('hex');
const HOST = 'web.shop.localhost';
const SITE = 'the site';
/** A first run pulls both images. */
const SETUP_TIMEOUT = 180_000;
/** A password drawn as a deploy draws a `RandomPassword`'s. */
const auth = siteAuth('staging', 'SITE_PASSWORD', {
	SITE_PASSWORD: drawSecret(
		randomInt,
		new RandomPassword('SitePassword').declare()[0] as SecretDeclaration,
	),
});

/** One GET through the proxy on `port`, as a browser would send it. */
function get(
	port: number,
	login?: { user: string; password: string },
): Promise<{ status: number; body: string; challenge?: string }> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: '127.0.0.1',
				port,
				servername: HOST,
				path: '/',
				headers: {
					host: HOST,
					...(login
						? {
								authorization: `Basic ${Buffer.from(`${login.user}:${login.password}`).toString('base64')}`,
							}
						: {}),
				},
				// Caddy's internal CA and Traefik's default certificate.
				rejectUnauthorized: false,
				timeout: 5_000,
			},
			(res) => {
				let body = '';
				res.on('data', (chunk: Buffer) => {
					body += chunk.toString();
				});
				res.on('end', () =>
					resolve({
						status: res.statusCode ?? 0,
						body,
						...(res.headers['www-authenticate']
							? { challenge: String(res.headers['www-authenticate']) }
							: {}),
					}),
				);
			},
		);
		req.on('timeout', () => req.destroy(new Error('timed out')));
		req.on('error', reject);
		req.end();
	});
}

/** The host port Docker published `443` on. */
async function publishedPort(container: string): Promise<number> {
	const out = await docker('port', container, '443/tcp');
	return Number(out.split('\n')[0]!.split(':').pop());
}

/** Asks until the proxy routes the host — any answer but a refused one. */
async function ready(port: number): Promise<void> {
	let last: unknown;
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			const { status } = await get(port);
			// Traefik answers 404 until it has read the dynamic file.
			if (status !== 404 && status !== 502) return;
			last = `HTTP ${status}`;
		} catch (error) {
			last = error;
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`the proxy on ${port} never routed ${HOST}: ${last}`);
}

/** The three answers a protected site must give. */
function itAsksForTheLogin(port: () => number) {
	it('asks for a login, and serves nothing without one', async () => {
		const answer = await get(port());

		expect(answer.status).toBe(401);
		expect(answer.challenge).toMatch(/^Basic/);
		expect(answer.body).not.toContain(SITE);
	});

	it('refuses the wrong password', async () => {
		const answer = await get(port(), { user: auth.user, password: 'nope' });

		expect(answer.status).toBe(401);
		expect(answer.body).not.toContain(SITE);
	});

	it("serves the site to the stage's login", async () => {
		const answer = await get(port(), auth);

		expect(answer.status).toBe(200);
		expect(answer.body).toBe(SITE);
	});
}

describe(
	'a site behind a password, served by Caddy',
	{ timeout: 30_000 },
	() => {
		const container = `gkm-site-password-caddy-${id}`;
		let port = 0;

		beforeAll(async () => {
			// The site, in the same container: what is under test is the edge.
			const route: EdgeRoute = {
				name: 'web',
				host: HOST,
				upstreams: [{ service: '127.0.0.1', port: 8080 }],
				streaming: true,
				auth: { user: auth.user, hash: auth.hash },
			};
			const caddyfile = `${edgeCaddyfile([route], { tls: { kind: 'internal' } })}
:8080 {
	respond "${SITE}"
}
`;
			const dir = await createTempDir('gkm-site-password-caddy-');
			try {
				const file = join(dir, 'Caddyfile');
				writeFileSync(file, caddyfile);
				await docker(
					'create',
					'--name',
					container,
					'-p',
					'127.0.0.1::443',
					DEFAULT_IMAGES.caddy!,
				);
				await docker('cp', file, `${container}:/etc/caddy/Caddyfile`);
			} finally {
				await cleanupDir(dir);
			}
			await docker('start', container);
			port = await publishedPort(container);
			await ready(port);
		}, SETUP_TIMEOUT);

		afterAll(async () => {
			await docker('rm', '-f', container).catch(() => {});
		});

		itAsksForTheLogin(() => port);
	},
);

describe(
	'a site behind a password, served by Traefik',
	{ timeout: 30_000 },
	() => {
		const project = `gkm-site-password-${id}`;
		const network = `${project}-net`;
		const site = `${project}-web`;
		const edge = `${project}-traefik`;
		let port = 0;

		beforeAll(async () => {
			const route: EdgeRoute = {
				name: 'web',
				host: HOST,
				upstreams: [{ service: 'web', port: 3002 }],
				streaming: true,
				auth: { user: auth.user, hash: auth.hash },
				health: '/',
			};
			// The stage's own certificate is left out: Traefik's default one is
			// served instead, which is all a test of the login needs.
			const { tls: _, ...dynamic } = traefikDynamic([route], {
				project,
				tls: { kind: 'files', certFile: '/x.pem', keyFile: '/x.key' },
			});

			await docker('network', 'create', network);
			// The site, on the shared network by the alias the edge routes to.
			await docker(
				'run',
				'-d',
				'--name',
				site,
				'--network',
				network,
				'--network-alias',
				site,
				DEFAULT_IMAGES.caddy!,
				'caddy',
				'respond',
				'--listen',
				':3002',
				'--body',
				SITE,
			);

			const dir = await createTempDir('gkm-site-password-traefik-');
			try {
				const file = join(dir, 'dynamic.yml');
				writeFileSync(file, stringify(dynamic));
				await docker(
					'create',
					'--name',
					edge,
					'--network',
					network,
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
			await ready(port);
		}, SETUP_TIMEOUT);

		afterAll(async () => {
			await docker('rm', '-f', edge, site).catch(() => {});
			await docker('network', 'rm', network).catch(() => {});
		});

		itAsksForTheLogin(() => port);
	},
);
