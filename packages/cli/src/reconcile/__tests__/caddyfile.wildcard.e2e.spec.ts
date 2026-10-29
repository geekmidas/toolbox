/**
 * A wildcard site behind the real dev edge: the Caddyfile reconcile writes,
 * served by the Caddy image `gkm dev` runs, in front of two processes on this
 * machine — an API whose `hosts` route knows one tenant, and the site.
 *
 * Gated behind GKM_E2E=1: it pulls and starts a container. Removed whatever
 * happens.
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { request } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caddyfileRoot, sitesFor, toCaddyfile } from '../caddyfile';
import { DEFAULT_IMAGES } from '../containers';
import { planFor } from '../plan';

const run = promisify(execFile);
const e2e = process.env.GKM_E2E === '1';

const manifest = {
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: 'apps/api',
		endpoints: [
			{
				method: 'GET',
				path: '/tenants/hosts',
				handler: 'src/hosts.ts#hosts',
				dependencies: [],
			},
		],
		provides: ['API_URL'],
	},
	App: {
		kind: 'site',
		id: 'App',
		variant: 'next',
		subdomain: '*',
		hosts: { surface: 'Api', path: '/tenants/hosts' },
		app: { path: 'apps/app' },
		dependencies: [{ target: 'Api', kind: 'rest-api' }],
		provides: ['APP_URL'],
	},
} as const satisfies ConstructManifest;

/** A process on this machine, on a port the system picked. */
async function serve(
	handler: Parameters<typeof createServer>[1],
): Promise<{ server: Server; port: number }> {
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
	return { server, port: (server.address() as AddressInfo).port };
}

describe.skipIf(!e2e)('a wildcard site behind the dev edge', () => {
	const container = `gkm-wildcard-${randomBytes(4).toString('hex')}`;
	const asked: string[] = [];
	let dir: string;
	let api: Server;
	let app: Server;
	let edge: number;

	/** GET `/` on `host` through the edge: its status and body. */
	function get(host: string): Promise<{ status: number; body: string }> {
		return new Promise((resolve, reject) => {
			const req = request(
				{
					host: '127.0.0.1',
					port: edge,
					servername: host,
					headers: { host },
					path: '/',
					// Caddy's own CA, which this process has no reason to trust.
					rejectUnauthorized: false,
				},
				(res) => {
					let body = '';
					res.on('data', (chunk) => {
						body += chunk;
					});
					res.on('end', () => resolve({ status: res.statusCode!, body }));
				},
			);
			req.on('error', reject);
			req.end();
		});
	}

	beforeAll(async () => {
		const apiProcess = await serve((req, res) => {
			const url = new URL(req.url!, 'http://api');
			if (url.pathname === '/tenants/hosts') {
				const domain = url.searchParams.get('domain') ?? '';
				asked.push(domain);
				res.statusCode = domain === 'acme.shop.localhost' ? 200 : 404;
				res.end(res.statusCode === 200 ? '' : 'no such tenant');
				return;
			}
			res.end('api');
		});
		const appProcess = await serve((req, res) => {
			res.end(`app on ${req.headers.host}`);
		});
		api = apiProcess.server;
		app = appProcess.server;

		const plan = planFor(manifest, 'dev', provisionOrder(manifest), {
			localStage: 'dev',
			protectedSubdomains: ['www'],
		});
		const sites = sitesFor(plan, 'shop', {
			Api: `http://localhost:${apiProcess.port}`,
			App: `http://localhost:${appProcess.port}`,
		});

		dir = await mkdtemp(join(tmpdir(), 'gkm-wildcard-'));
		await writeFile(join(dir, 'Caddyfile'), caddyfileRoot());
		await run('mkdir', ['-p', join(dir, 'sites')]);
		await writeFile(join(dir, 'sites', 'dev.caddy'), toCaddyfile(sites));

		await run('docker', [
			'run',
			'-d',
			'--rm',
			'--name',
			container,
			'--add-host',
			'host.docker.internal:host-gateway',
			'-p',
			'127.0.0.1::443',
			'-v',
			`${dir}:/etc/caddy:ro`,
			DEFAULT_IMAGES.caddy!,
		]);
		const { stdout } = await run('docker', ['port', container, '443/tcp']);
		edge = Number(stdout.trim().split(':').pop());

		// Ready once it answers a TLS handshake for a host it serves.
		for (let attempt = 0; ; attempt++) {
			try {
				await get('api.shop.localhost');
				break;
			} catch (error) {
				if (attempt > 50) throw error;
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
		}
	}, 120_000);

	afterAll(async () => {
		await run('docker', ['rm', '-f', container]).catch(() => {});
		api?.close();
		app?.close();
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	it('serves a tenant its hosts route knows', async () => {
		expect(await get('acme.shop.localhost')).toEqual({
			status: 200,
			body: 'app on acme.shop.localhost',
		});
	});

	it('returns the hosts route answer for a slug that is no tenant', async () => {
		expect(await get('nope.shop.localhost')).toEqual({
			status: 404,
			body: 'no such tenant',
		});
		expect(asked).toContain('nope.shop.localhost');
	});

	it('keeps a named host for its own app', async () => {
		expect(await get('api.shop.localhost')).toEqual({
			status: 200,
			body: 'api',
		});
	});

	it('refuses a protected label without asking the app', async () => {
		expect((await get('www.shop.localhost')).status).toBe(404);
		expect(asked).not.toContain('www.shop.localhost');
	});
});
