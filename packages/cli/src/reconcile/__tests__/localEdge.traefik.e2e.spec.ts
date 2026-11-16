/**
 * `gkm dev`'s routes behind the real shared edge: the file reconcile
 * registers, read by the Traefik image `gkm compose` runs, in front of
 * processes on this machine — reached through the host's gateway, with gkm's
 * local certificate, and a changed file picked up without a restart.
 *
 * Gated behind GKM_E2E=1: it pulls and starts a container. Removed whatever
 * happens. Its own container on a port the system picks, never this
 * machine's edge on 443.
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { request } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
	ensureLocalAuthority,
	issueLocalCertificate,
	localAuthorityPaths,
	localCertificateNames,
} from '@geekmidas/edge/certificates/local';
import {
	edgeCertificatePaths,
	TRAEFIK_IMAGE,
	traefikDynamicFile,
	traefikStaticFile,
} from '@geekmidas/edge/proxy/traefik';
import { routeHosts } from '@geekmidas/edge/routes';
import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planFor } from '../plan';
import { localRoutes } from '../routes';

const run = promisify(execFile);
const e2e = process.env.GKM_E2E === '1';

const manifest = {
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: 'apps/api',
		aliases: ['rest'],
		endpoints: [],
		provides: ['API_URL'],
	},
	App: {
		kind: 'site',
		id: 'App',
		variant: 'next',
		subdomain: '*',
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

describe.skipIf(!e2e)('gkm dev behind the shared Traefik edge', () => {
	const container = `gkm-dev-traefik-${randomBytes(4).toString('hex')}`;
	const project = 'shop-dev';
	let dir: string;
	let api: Server;
	let app: Server;
	let edge: number;
	let ca: string;
	let plan: ReturnType<typeof planFor>;
	let addresses: Record<string, string>;

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
					// gkm's root, which issued the certificate: verified, not waved
					// through.
					ca,
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

	/** `host`'s answer once it is `status`, or its last when it never is. */
	async function until(host: string, status: number) {
		let answer: Awaited<ReturnType<typeof get>> | undefined;
		for (let attempt = 0; attempt < 75; attempt++) {
			answer = await get(host).catch(() => undefined);
			if (answer?.status === status) return answer;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		return answer;
	}

	/** What reconcile registers for the stage, written where the edge reads it. */
	async function register(routes: ReturnType<typeof localRoutes>) {
		const authority = await ensureLocalAuthority(
			localAuthorityPaths(join(dir, 'home')),
		);
		ca = authority.cert;
		const certificate = issueLocalCertificate(
			authority,
			localCertificateNames('shop', routes.flatMap(routeHosts)),
		);
		await writeFile(
			join(dir, 'edge', 'certs', `${project}.crt`),
			certificate.cert,
		);
		await writeFile(
			join(dir, 'edge', 'certs', `${project}.key`),
			certificate.key,
		);
		await writeFile(
			join(dir, 'edge', 'dynamic', `${project}.yml`),
			traefikDynamicFile(routes, {
				project,
				tls: { kind: 'files', ...edgeCertificatePaths(project) },
				edgeToken: 'stack-token',
			}),
		);
	}

	beforeAll(async () => {
		const apiProcess = await serve((req, res) => {
			res.end(
				`api on ${req.headers.host} over ${req.headers['x-forwarded-proto']}`,
			);
		});
		const appProcess = await serve((req, res) => {
			res.end(`app on ${req.headers.host}`);
		});
		api = apiProcess.server;
		app = appProcess.server;
		addresses = {
			Api: `http://localhost:${apiProcess.port}`,
			App: `http://localhost:${appProcess.port}`,
		};

		plan = planFor(manifest, 'dev', provisionOrder(manifest), {
			localStage: 'dev',
			protectedSubdomains: ['www'],
			edge: {
				proxy: 'traefik',
				ports: { https: 443, http: 80 },
				project,
			},
		});

		dir = await mkdtemp(join(tmpdir(), 'gkm-dev-traefik-'));
		await mkdir(join(dir, 'edge', 'dynamic'), { recursive: true });
		await mkdir(join(dir, 'edge', 'certs'), { recursive: true });
		await writeFile(
			join(dir, 'traefik.yml'),
			traefikStaticFile({ https: 443, http: 80 }),
		);
		// The API alone first: the site is added while the edge runs.
		await register(
			localRoutes(plan, 'shop', { addresses: { Api: addresses.Api! } }),
		);

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
			`${join(dir, 'traefik.yml')}:/etc/traefik/traefik.yml:ro`,
			'-v',
			`${join(dir, 'edge')}:/etc/gkm-edge`,
			TRAEFIK_IMAGE,
		]);
		const { stdout } = await run('docker', ['port', container, '443/tcp']);
		edge = Number(stdout.trim().split(':').pop());

		await until('api.shop.localhost', 200);
	}, 120_000);

	afterAll(async () => {
		await run('docker', ['rm', '-f', '-v', container]).catch(() => {});
		api?.close();
		app?.close();
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	it('serves a surface from the process on this machine, with the host and scheme a caller used', async () => {
		expect(await get('api.shop.localhost')).toEqual({
			status: 200,
			body: 'api on api.shop.localhost over https',
		});
	});

	it('answers its aliases as its own host', async () => {
		expect(await get('rest.shop.localhost')).toEqual({
			status: 200,
			body: 'api on rest.shop.localhost over https',
		});
	});

	it('picks up a route added while it runs, without a restart', async () => {
		await register(localRoutes(plan, 'shop', { addresses }));

		expect(await until('acme.shop.localhost', 200)).toEqual({
			status: 200,
			body: 'app on acme.shop.localhost',
		});
		// A named host still wins over the wildcard, and a protected label
		// never reaches the site.
		expect((await get('api.shop.localhost')).body).toContain('api on');
		expect((await get('www.shop.localhost')).status).toBe(404);
	});
});
