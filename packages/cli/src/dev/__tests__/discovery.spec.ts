import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import {
	createServer,
	type IncomingHttpHeaders,
	request,
	type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateLocalCredentials } from '../../reconcile/localCredentials';
import { WorkspaceConfigSchema } from '../../workspace/schema';
import {
	DEFAULT_DISCOVERY_PORT,
	type DiscoveredWorkspace,
	type DiscoveryEvent,
	type DiscoveryResponse,
	type DiscoverySession,
	dataApisOf,
	discoveryPort,
	InvalidDiscoveryPort,
	type JoinDiscoveryOptions,
	joinDiscovery,
	type SessionApp,
	workspaceId,
} from '../discovery';

/**
 * Discovery over real sockets: each session writes to a registry directory of
 * the test's own, and the endpoint is a real HTTP server on 127.0.0.1 — on a
 * port the OS picked, never 4983, which a developer's own `gkm dev` holds.
 */

const CONSOLE = 'https://console.example.com';

let registry: string;
let sessions: DiscoverySession[];
let servers: Server[];

beforeEach(() => {
	registry = mkdtempSync(join(tmpdir(), 'gkm-discovery-'));
	sessions = [];
	servers = [];
});

afterEach(async () => {
	for (const session of sessions) await session.leave();
	for (const server of servers) {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
	rmSync(registry, { recursive: true, force: true });
});

async function join_(
	options: Partial<JoinDiscoveryOptions> & {
		name?: string;
		root?: string;
	} = {},
): Promise<DiscoverySession> {
	const { name = 'shop', root = '/work/shop', ...rest } = options;
	const session = await joinDiscovery({
		role: 'app',
		workspace: { name, root, stage: 'dev' },
		apps: [app('api', 3000)],
		port: 0,
		registry,
		pollMs: 25,
		electionMs: 25,
		...rest,
	});
	sessions.push(session);
	return session;
}

function app(name: string, port: number, extra: Partial<SessionApp> = {}) {
	return {
		name,
		type: 'backend' as const,
		port,
		status: 'ready' as const,
		reloads: 0,
		dataApis: [],
		...extra,
	};
}

interface Reply {
	status: number;
	headers: IncomingHttpHeaders;
	body: string;
}

/** A request with exactly these headers — `Host` and `Origin` included. */
function send(
	port: number,
	path: string,
	headers: Record<string, string> = {},
	method = 'GET',
): Promise<Reply> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: '127.0.0.1',
				port,
				path,
				method,
				headers: { host: `127.0.0.1:${port}`, ...headers },
			},
			(res) => {
				let body = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => {
					body += chunk;
				});
				res.on('end', () =>
					resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
				);
			},
		);
		req.on('error', reject);
		req.end();
	});
}

function bearer(session: DiscoverySession) {
	return { authorization: `Bearer ${session.token}` };
}

async function list(
	session: DiscoverySession,
	headers: Record<string, string> = {},
): Promise<DiscoveryResponse> {
	const reply = await send(session.endpointPort, '/__gkm', {
		...bearer(session),
		...headers,
	});
	expect(reply.status).toBe(200);
	return JSON.parse(reply.body);
}

class ConditionNeverHeld extends Error {
	constructor(readonly ms: number) {
		super(`The condition did not hold within ${ms}ms.`);
		this.name = 'ConditionNeverHeld';
	}
}

async function until(check: () => boolean | Promise<boolean>, ms = 5000) {
	const deadline = Date.now() + ms;
	while (!(await check())) {
		if (Date.now() > deadline) throw new ConditionNeverHeld(ms);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

/** A stand-in app: answers its data API paths with what it was asked. */
async function fakeApp(): Promise<{ port: number; seen: string[] }> {
	const seen: string[] = [];
	const server = createServer((req, res) => {
		seen.push(`${req.method} ${req.url} cookie=${req.headers.cookie ?? ''}`);
		res.writeHead(200, {
			'content-type': 'application/json',
			'set-cookie': 'session=app',
		});
		res.end(JSON.stringify({ url: req.url }));
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	return { port: (server.address() as AddressInfo).port, seen };
}

/** A port that was free a moment ago — for the sessions that must share one. */
async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	await new Promise((resolve) => server.close(resolve));
	return port;
}

describe('the discovery endpoint', () => {
	describe('security', () => {
		it("lists a workspace's services and never its logins", async () => {
			// What `gkm dev` registers: the manifest it reconciled and its apps.
			// The logins it generated stay out of both, and so out of every
			// answer and the registry on disk.
			const credentials = generateLocalCredentials('shop');
			const session = await join_({
				manifest: {
					Orders: { kind: 'database', id: 'Orders', provides: ['ORDERS_URL'] },
					Sessions: {
						kind: 'cache',
						id: 'Sessions',
						provides: ['SESSIONS_URL'],
					},
					Uploads: {
						kind: 'objects',
						id: 'Uploads',
						provides: ['UPLOADS_URL'],
					},
				} as JoinDiscoveryOptions['manifest'],
			});

			const reply = await send(session.endpointPort, '/__gkm', bearer(session));
			const onDisk = readdirSync(registry, { recursive: true })
				.map((file) => join(registry, String(file)))
				.filter((path) => statSync(path).isFile())
				.map((path) => readFileSync(path, 'utf8'))
				.join('\n');
			const secrets = [
				credentials.seed,
				credentials.postgres.password,
				credentials.minio.password,
				credentials.redis.password,
				credentials.cacheToken,
				credentials.rabbitmq.password,
				credentials.emulator.secretAccessKey,
				credentials.logs.password,
			];

			expect(reply.status).toBe(200);
			expect(reply.body).toContain('Orders');
			for (const text of [reply.body, onDisk]) {
				for (const secret of secrets) expect(text).not.toContain(secret);
				expect(text).not.toMatch(/postgres:\/\/|redis:\/\/|password/i);
			}
		});

		it('rejects a request without the token, or with the wrong one', async () => {
			const session = await join_();
			const port = session.endpointPort;

			const none = await send(port, '/__gkm');
			expect(none.status).toBe(401);
			expect(JSON.parse(none.body).error).toBe('TokenRequired');

			const wrong = await send(port, '/__gkm', {
				authorization: 'Bearer not-the-token',
			});
			expect(wrong.status).toBe(401);

			// Every route, not only the listing.
			expect((await send(port, '/__gkm/events')).status).toBe(401);
			expect(
				(await send(port, '/__gkm/workspaces/x/apps/api/__gkm/db')).status,
			).toBe(401);

			expect((await send(port, '/__gkm', bearer(session))).status).toBe(200);
			// `EventSource` cannot set headers, so the connect URL carries it.
			const url = new URL(session.connectUrl);
			expect(url.host).toBe(`127.0.0.1:${port}`);
			expect((await send(port, `${url.pathname}${url.search}`)).status).toBe(
				200,
			);
		});

		it('rejects an origin no workspace listed, and does not answer CORS for it', async () => {
			const session = await join_({ allowedOrigins: [CONSOLE] });
			const port = session.endpointPort;

			const unlisted = await send(port, '/__gkm', {
				...bearer(session),
				origin: 'https://evil.example',
			});
			expect(unlisted.status).toBe(403);
			expect(JSON.parse(unlisted.body).error).toBe('OriginNotAllowed');
			expect(unlisted.headers['access-control-allow-origin']).toBeUndefined();

			const preflight = await send(
				port,
				'/__gkm',
				{
					origin: 'https://evil.example',
					'access-control-request-method': 'GET',
				},
				'OPTIONS',
			);
			expect(preflight.status).toBe(403);
			expect(preflight.headers['access-control-allow-origin']).toBeUndefined();

			const listed = await send(port, '/__gkm', {
				...bearer(session),
				origin: CONSOLE,
			});
			expect(listed.status).toBe(200);
			expect(listed.headers['access-control-allow-origin']).toBe(CONSOLE);
		});

		it('rejects every origin when none is configured — the default', async () => {
			const session = await join_();
			const reply = await send(session.endpointPort, '/__gkm', {
				...bearer(session),
				origin: CONSOLE,
			});
			expect(reply.status).toBe(403);
		});

		it('answers a listed origin’s preflight without the token, Chrome’s private network header included', async () => {
			const session = await join_({ allowedOrigins: [CONSOLE] });
			const reply = await send(
				session.endpointPort,
				'/__gkm',
				{
					origin: CONSOLE,
					'access-control-request-method': 'GET',
					'access-control-request-headers': 'authorization',
					'access-control-request-private-network': 'true',
				},
				'OPTIONS',
			);
			expect(reply.status).toBe(204);
			expect(reply.headers['access-control-allow-origin']).toBe(CONSOLE);
			expect(reply.headers['access-control-allow-headers']).toBe(
				'Authorization',
			);
			expect(reply.headers['access-control-allow-methods']).toBe('GET, HEAD');
			expect(reply.headers['access-control-allow-private-network']).toBe(
				'true',
			);
		});

		it('rejects a rebinding-style Host header, even with the token', async () => {
			const session = await join_();
			const port = session.endpointPort;

			// A page on attacker.example whose DNS now answers 127.0.0.1: the
			// browser sends its own hostname, and is same-origin with itself.
			for (const host of [
				`attacker.example:${port}`,
				'attacker.example',
				`127.0.0.1:${port + 1}`,
				`localhost.attacker.example:${port}`,
			]) {
				const reply = await send(port, '/__gkm', {
					...bearer(session),
					host,
				});
				expect(reply.status, host).toBe(403);
				expect(JSON.parse(reply.body).error).toBe('HostNotAllowed');
			}

			expect(
				(
					await send(port, '/__gkm', {
						...bearer(session),
						host: `localhost:${port}`,
					})
				).status,
			).toBe(200);
		});

		it('is read-only', async () => {
			const session = await join_();
			for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
				const reply = await send(
					session.endpointPort,
					'/__gkm',
					bearer(session),
					method,
				);
				expect(reply.status, method).toBe(405);
			}
		});

		it('keeps the registry and the token to this user', async () => {
			const session = await join_();
			const mode = (path: string) => statSync(path).mode & 0o777;
			expect(mode(join(registry, 'token'))).toBe(0o600);
			expect(mode(join(registry, 'sessions'))).toBe(0o700);
			expect(readFileSync(join(registry, 'token'), 'utf8')).toBe(session.token);
		});
	});

	describe('GET /__gkm', () => {
		it('lists two workspaces running at once', async () => {
			const telescope = await fakeApp();
			const host = await join_({
				name: 'shop',
				root: '/work/shop',
				role: 'workspace',
				manifest: {
					Database: { kind: 'database', id: 'Database' },
				} as never,
				apps: [
					app('api', telescope.port, { status: 'starting' }),
					app('web', telescope.port, { type: 'web', status: 'starting' }),
				],
			});
			// The api's own `gkm dev`, with its status and data APIs.
			await join_({
				name: 'shop',
				root: '/work/shop',
				apps: [
					app('api', telescope.port, {
						dataApis: dataApisOf({
							selfServing: false,
							telescopePath: '/__telescope',
							databaseApi: '/__gkm/db',
							openApi: true,
						}),
					}),
				],
			});
			// Another project, in another terminal.
			await join_({
				name: '@acme/billing',
				root: '/work/billing',
				apps: [app('api', 4100, { status: 'reloading', reloads: 2 })],
			});

			const body = await list(host);
			expect(body.version).toBe(1);
			expect(body.host).toEqual({
				pid: process.pid,
				port: host.endpointPort,
			});
			expect(body.events).toBe('/__gkm/events');
			expect(body.workspaces.map((w) => w.name)).toEqual([
				'@acme/billing',
				'shop',
			]);

			const shop = body.workspaces.find(
				(w) => w.name === 'shop',
			) as DiscoveredWorkspace;
			const shopId = workspaceId('shop', '/work/shop');
			expect(shop).toMatchObject({
				id: shopId,
				root: '/work/shop',
				stage: 'dev',
				manifest: { Database: { kind: 'database' } },
			});
			expect(shop.apps).toEqual([
				{
					name: 'api',
					type: 'backend',
					port: telescope.port,
					url: `http://localhost:${telescope.port}`,
					publicUrl: null,
					// Its own session's word, not the workspace's `starting`.
					status: 'ready',
					reloads: 0,
					pid: process.pid,
					dataApis: [
						{
							kind: 'telescope',
							path: '/__telescope/api',
							url: `http://localhost:${telescope.port}/__telescope/api`,
							proxy: `/__gkm/workspaces/${shopId}/apps/api/__telescope/api`,
						},
						{
							kind: 'database',
							path: '/__gkm/db',
							url: `http://localhost:${telescope.port}/__gkm/db`,
							proxy: `/__gkm/workspaces/${shopId}/apps/api/__gkm/db`,
						},
						{
							kind: 'openapi',
							path: '/__docs',
							url: `http://localhost:${telescope.port}/__docs`,
							proxy: `/__gkm/workspaces/${shopId}/apps/api/__docs`,
						},
					],
				},
				// Listed only by the workspace: ready because its port answers.
				expect.objectContaining({
					name: 'web',
					type: 'web',
					status: 'ready',
					pid: null,
					dataApis: [],
				}),
			]);

			const billing = body.workspaces.find((w) => w.name === '@acme/billing');
			expect(billing).toMatchObject({
				id: workspaceId('@acme/billing', '/work/billing'),
				manifest: null,
				apps: [{ name: 'api', port: 4100, status: 'reloading', reloads: 2 }],
			});
			expect(billing?.id).toMatch(/^acme-billing-[0-9a-f]{8}$/);
		});

		it('shows a browser origin only the workspaces that listed it', async () => {
			const session = await join_({
				name: 'shop',
				root: '/work/shop',
				allowedOrigins: [CONSOLE],
			});
			await join_({ name: 'billing', root: '/work/billing' });

			const fromConsole = await list(session, { origin: CONSOLE });
			expect(fromConsole.workspaces.map((w) => w.name)).toEqual(['shop']);

			// A local process sends no Origin, and holds the token: everything.
			const local = await list(session);
			expect(local.workspaces.map((w) => w.name)).toEqual(['billing', 'shop']);
		});

		it('drops a session whose process died without leaving', async () => {
			const session = await join_({ name: 'shop', root: '/work/shop' });
			const dead = spawnSync(process.execPath, ['-e', '']).pid;
			writeFileSync(
				join(registry, 'sessions', `${dead}-deadbeef.json`),
				JSON.stringify({
					id: `${dead}-deadbeef`,
					pid: dead,
					role: 'app',
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					workspace: { name: 'ghost', root: '/work/ghost', stage: 'dev' },
					allowedOrigins: [],
					apps: [app('api', 3999)],
				}),
			);

			const body = await list(session);
			expect(body.workspaces.map((w) => w.name)).toEqual(['shop']);
			expect(readdirSync(join(registry, 'sessions'))).not.toContain(
				`${dead}-deadbeef.json`,
			);
		});
	});

	describe('forwarding to an app’s data APIs', () => {
		it('reads a data API through the one origin, without passing the token or cookies on', async () => {
			const target = await fakeApp();
			const session = await join_({
				allowedOrigins: [CONSOLE],
				apps: [
					app('api', target.port, {
						dataApis: [{ kind: 'database', path: '/__gkm/db' }],
					}),
				],
			});
			const id = workspaceId('shop', '/work/shop');

			const reply = await send(
				session.endpointPort,
				`/__gkm/workspaces/${id}/apps/api/__gkm/db/tables?schema=public&token=${session.token}`,
				{ origin: CONSOLE, cookie: 'console=1' },
			);
			expect(reply.status).toBe(200);
			expect(JSON.parse(reply.body)).toEqual({
				url: '/__gkm/db/tables?schema=public',
			});
			expect(reply.headers['access-control-allow-origin']).toBe(CONSOLE);
			expect(reply.headers['set-cookie']).toBeUndefined();
			expect(target.seen).toEqual([
				'GET /__gkm/db/tables?schema=public cookie=',
			]);
		});

		it('forwards nothing of an app but its data APIs', async () => {
			const target = await fakeApp();
			const session = await join_({
				apps: [
					app('api', target.port, {
						dataApis: dataApisOf({
							selfServing: false,
							telescopePath: '/__telescope',
							openApi: true,
						}),
					}),
				],
			});
			const base = `/__gkm/workspaces/${workspaceId('shop', '/work/shop')}/apps/api`;
			const get = (path: string) =>
				send(session.endpointPort, `${base}${path}`, bearer(session));

			expect((await get('/__telescope/api/requests')).status).toBe(200);
			expect((await get('/__docs')).status).toBe(200);
			for (const path of [
				'/users',
				'/__docs/ui',
				'/__telescope',
				'/__gkm/db',
			]) {
				const reply = await get(path);
				expect(reply.status, path).toBe(404);
				expect(JSON.parse(reply.body).error).toBe('NotADataApi');
			}
			expect(target.seen).toHaveLength(2);

			const unknown = await send(
				session.endpointPort,
				'/__gkm/workspaces/nope-00000000/apps/api/__docs',
				bearer(session),
			);
			expect(unknown.status).toBe(404);
		});

		it('hides another workspace’s apps from an origin it did not list', async () => {
			const target = await fakeApp();
			const session = await join_({
				name: 'shop',
				root: '/work/shop',
				allowedOrigins: [CONSOLE],
			});
			await join_({
				name: 'billing',
				root: '/work/billing',
				apps: [
					app('api', target.port, {
						dataApis: [{ kind: 'database', path: '/__gkm/db' }],
					}),
				],
			});

			const reply = await send(
				session.endpointPort,
				`/__gkm/workspaces/${workspaceId('billing', '/work/billing')}/apps/api/__gkm/db/tables`,
				{ ...bearer(session), origin: CONSOLE },
			);
			expect(reply.status).toBe(404);
			expect(target.seen).toEqual([]);
		});
	});

	describe('GET /__gkm/events', () => {
		it('streams a snapshot, then apps starting, reloading and stopping', async () => {
			const session = await join_({ name: 'shop', root: '/work/shop' });
			const events: DiscoveryEvent[] = [];

			const response = await fetch(
				`http://127.0.0.1:${session.endpointPort}/__gkm/events?token=${session.token}`,
			);
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('text/event-stream');
			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			const reading = (async () => {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) return;
					buffer += decoder.decode(value, { stream: true });
					let end = buffer.indexOf('\n\n');
					while (end !== -1) {
						const data = buffer
							.slice(0, end)
							.split('\n')
							.find((line) => line.startsWith('data: '));
						if (data) events.push(JSON.parse(data.slice(6)));
						buffer = buffer.slice(end + 2);
						end = buffer.indexOf('\n\n');
					}
				}
			})();

			await until(() => events.length > 0);
			expect(events[0]).toMatchObject({
				type: 'snapshot',
				snapshot: { workspaces: [{ name: 'shop' }] },
			});

			const billing = await join_({
				name: 'billing',
				root: '/work/billing',
				apps: [app('worker', 4200)],
			});
			await until(() => events.some((e) => e.type === 'app.started'));
			const billingId = workspaceId('billing', '/work/billing');
			expect(events.slice(1, 3)).toEqual([
				{ type: 'workspace.started', workspace: billingId },
				{
					type: 'app.started',
					workspace: billingId,
					app: expect.objectContaining({ name: 'worker', status: 'ready' }),
				},
			]);

			billing.updateApp('worker', (a) => ({ ...a, status: 'reloading' }));
			await until(() => events.some((e) => e.type === 'app.status'));
			billing.updateApp('worker', (a) => ({
				...a,
				status: 'ready',
				reloads: a.reloads + 1,
			}));
			await until(() => events.some((e) => e.type === 'app.reloaded'));
			expect(events.find((e) => e.type === 'app.reloaded')).toMatchObject({
				app: { name: 'worker', reloads: 1, status: 'ready' },
			});

			await billing.leave();
			await until(() => events.some((e) => e.type === 'workspace.stopped'));
			expect(events.slice(-2)).toEqual([
				{
					type: 'app.stopped',
					workspace: billingId,
					app: expect.objectContaining({ name: 'worker' }),
				},
				{ type: 'workspace.stopped', workspace: billingId },
			]);

			await reader.cancel();
			await reading.catch(() => {});
		});
	});

	describe('many sessions, one endpoint', () => {
		it('hands the endpoint to another session when its host exits', async () => {
			const port = await freePort();
			const first = await join_({ name: 'shop', root: '/work/shop', port });
			const second = await join_({
				name: 'billing',
				root: '/work/billing',
				port,
			});

			expect(first.hosting).toBe(true);
			expect(second.hosting).toBe(false);
			// One token for the machine: the URL either printed opens either host.
			expect(second.token).toBe(first.token);
			expect(second.connectUrl).toBe(first.connectUrl);
			expect((await list(second)).workspaces.map((w) => w.name).sort()).toEqual(
				['billing', 'shop'],
			);

			await first.leave();
			await until(() => second.hosting);

			const body = await list(second);
			expect(body.host.port).toBe(port);
			expect(body.workspaces.map((w) => w.name)).toEqual(['billing']);
		});

		it('ends the token with the last session, so an old connect URL stops working', async () => {
			const first = await join_();
			const old = first.token;
			await first.leave();
			expect(existsSync(join(registry, 'token'))).toBe(false);

			const next = await join_();
			expect(next.token).not.toBe(old);
			const reply = await send(next.endpointPort, '/__gkm', {
				authorization: `Bearer ${old}`,
			});
			expect(reply.status).toBe(401);
		});

		it('replaces a token a crashed session left behind', async () => {
			writeFileSync(join(registry, 'token'), 'left-behind');
			const session = await join_();
			expect(session.token).not.toBe('left-behind');
		});
	});
});

describe('discoveryPort', () => {
	it('is 4983 unless configured, and the env wins over the config', () => {
		expect(DEFAULT_DISCOVERY_PORT).toBe(4983);
		expect(discoveryPort(undefined, {})).toBe(4983);
		expect(discoveryPort({ discoveryPort: 5000 }, {})).toBe(5000);
		expect(
			discoveryPort({ discoveryPort: 5000 }, { GKM_DISCOVERY_PORT: '0' }),
		).toBe(0);
	});

	it('refuses an env value that is not a port', () => {
		expect(() =>
			discoveryPort(undefined, { GKM_DISCOVERY_PORT: 'nope' }),
		).toThrow(InvalidDiscoveryPort);
		expect(() =>
			discoveryPort(undefined, { GKM_DISCOVERY_PORT: '70000' }),
		).toThrow(InvalidDiscoveryPort);
	});
});

describe('dev.allowedOrigins', () => {
	const parse = (dev: unknown) =>
		WorkspaceConfigSchema.safeParse({
			stages: { local: 'dev', deployed: ['prod'] },
			dev,
		});

	it('takes origins', () => {
		expect(
			parse({ allowedOrigins: [CONSOLE, 'http://localhost:5173'] }).success,
		).toBe(true);
	});

	it('refuses a URL that is more than an origin', () => {
		expect(parse({ allowedOrigins: [`${CONSOLE}/`] }).success).toBe(false);
		expect(parse({ allowedOrigins: [`${CONSOLE}/app`] }).success).toBe(false);
		expect(parse({ allowedOrigins: ['*'] }).success).toBe(false);
	});
});
