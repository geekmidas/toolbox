import { realpathSync } from 'node:fs';
import { createConnection, createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { ownerRole } from '@geekmidas/db/pg/roles';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from 'vitest';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	SERVER_IPV4,
	WARM_TIMEOUT,
	warmComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import {
	type Call,
	fakeDocker,
} from '../../compose/__tests__/__helpers__/fakeDocker';
import { deployedStackSecrets } from '../../compose/secrets';
import type { ServerAccess } from '../../compose/server';
import { composeStack } from '../../compose/stack';
import { loadWorkspaceSettings } from '../../config';
import { deployIdentity } from '../../deploy/identity';
import { secretsStoreFor } from '../../secrets/store';
import {
	DatabaseNotInStage,
	DatabaseNotPublished,
	type DbTunnelDeps,
	dbTunnel,
	loginFields,
} from '../dbTunnel';
import { appEnvironment, ExecNotConfirmed } from '../stage';

/**
 * `gkm db:tunnel --stage production`: the compose fixture's stage, its
 * secrets in a real store, and a real tunnel — to the suite's Postgres,
 * standing in for SSH's. Only the server's Docker is a recorder.
 */

let dir: string;

beforeAll(warmComposeApp, WARM_TIMEOUT);

beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-db-tunnel-'));
	vi.stubEnv('GKM_HOME', join(dir, '.home'));
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await cleanupDir(dir);
});

/** The fixture, deployed: its secrets as its first deploy left them. */
async function deployed(
	options: Parameters<typeof writeComposeApp>[1] = {},
): Promise<void> {
	writeComposeApp(dir, { target: 'compose', ...options });
	const { workspace, manifest } = await loadComposeApp(dir);
	const { secrets } = deployedStackSecrets(workspace, 'production', null, {
		...manifest,
	});
	const store = await secretsStoreFor(
		await loadWorkspaceSettings(dir),
		'production',
	);
	await store.write('production', {
		...secrets,
		custom: {
			...secrets.custom,
			AUTH_SECRET: 'the-production-signing-secret',
			BACKUPS_URL: 's3://K:S@backups?region=eu-west-1',
			GKM_SERVER_IPV4: SERVER_IPV4,
		},
	});
}

/** A TCP forward on this machine's loopback, to the suite's Postgres. */
function realServer(calls: Call[]): ServerAccess {
	return {
		async check() {},
		async tunnel(server, remotePort) {
			calls.push({
				op: 'tunnel',
				args: [`${server.user}@${server.host}`, remotePort],
			});
			const forward: Server = createServer((socket) => {
				const upstream = createConnection({
					host: '127.0.0.1',
					port: POSTGRES_PORT,
				});
				socket.pipe(upstream).pipe(socket);
				socket.on('error', () => upstream.destroy());
				upstream.on('error', () => socket.destroy());
			});
			await new Promise<void>((resolve) =>
				forward.listen(0, '127.0.0.1', resolve),
			);
			const address = forward.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			return {
				port,
				close: async () => {
					calls.push({ op: 'tunnel-closed', args: remotePort });
					forward.closeAllConnections?.();
					await new Promise((resolve) => forward.close(resolve));
				},
			};
		},
	};
}

function connects(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: '127.0.0.1', port });
		socket.once('connect', () => {
			socket.destroy();
			resolve(true);
		});
		socket.once('error', () => resolve(false));
	});
}

function deps(
	calls: Call[],
	overrides: Partial<DbTunnelDeps> = {},
): DbTunnelDeps {
	const { docker } = fakeDocker({ published: { postgres: 54_321 } });
	return {
		docker: {
			...docker,
			published: async (engine, project, service, inside) => {
				calls.push({
					op: 'published',
					args: [project, service, inside],
					...(engine.host ? { host: engine.host } : {}),
				});
				return docker.published(engine, project, service, inside);
			},
		},
		server: realServer(calls),
		confirm: async () => true,
		env: {},
		held: async () => {},
		...overrides,
	};
}

function said(): string {
	return (console.log as unknown as MockInstance).mock.calls.flat().join('\n');
}

/** The api's own login on the stage, as its container has it. */
async function appLogin(): Promise<URL> {
	const { workspace, manifest, background } = await loadComposeApp(dir);
	const store = await secretsStoreFor(workspace, 'production');
	const stack = composeStack({
		workspace,
		manifest,
		background,
		stage: 'production',
		identity: deployIdentity(workspace, 'production'),
		images: { mode: 'build', tag: 'exec' },
		secrets: await store.read('production'),
	});
	return new URL(appEnvironment(stack, 'api').DATABASE_URL!);
}

describe('gkm db:tunnel --stage', () => {
	it("prints each database's owner login through the tunnel, and closes it after", async () => {
		await deployed();
		const calls: Call[] = [];
		let port = 0;
		let open = false;

		const logins = await dbTunnel(
			{ stage: 'production', cwd: dir },
			deps(calls, {
				// While it is held, the printed address answers.
				held: async () => {
					port = Number(said().match(/127\.0\.0\.1:(\d+)/)![1]);
					open = await connects(port);
				},
			}),
		);

		expect(open).toBe(true);
		expect(logins.map((login) => login.construct).sort()).toEqual([
			'AuthDatabase',
			'Database',
		]);
		const app = await appLogin();
		for (const login of logins) {
			const url = new URL(login.url);
			expect(url.hostname).toBe('localhost');
			expect(url.port).toBe(String(port));
			// An owner, with its password in full — not the app's login.
			expect(url.username).toMatch(/_owner$/);
			expect(url.password.length).toBeGreaterThan(0);
			expect(url.password).not.toBe(app.password);
			expect(said()).toContain(login.url);
			// And field by field, for a client's form: decoded, in full.
			const fields = Object.fromEntries(loginFields(login.url));
			expect(fields).toEqual({
				host: 'localhost',
				port: String(port),
				database: decodeURIComponent(url.pathname.slice(1)),
				user: decodeURIComponent(url.username),
				password: decodeURIComponent(url.password),
			});
			for (const [field, value] of Object.entries(fields)) {
				expect(said()).toMatch(
					new RegExp(`${field}:\\s+${RegExp.escape(value)}$`, 'm'),
				);
			}
		}
		// The api's database's owner is the owner of the role the api runs as.
		const owner = logins.find((login) => login.construct === 'Database')!;
		expect(new URL(owner.url).username).toBe(ownerRole(app.username));

		// Asked of the server's Docker, over SSH, and tunneled to what it said.
		expect(calls).toContainEqual({
			op: 'published',
			args: ['compose-app-production', 'postgres', 5432],
			host: `ssh://deploy@${SERVER_IPV4}`,
		});
		expect(calls.filter((c) => c.op.startsWith('tunnel'))).toEqual([
			{ op: 'tunnel', args: [`deploy@${SERVER_IPV4}`, 54_321] },
			{ op: 'tunnel-closed', args: 54_321 },
		]);
		expect(await connects(port)).toBe(false);
	});

	it('prints only the construct asked for', async () => {
		await deployed();
		const logins = await dbTunnel(
			{ stage: 'production', cwd: dir, construct: 'Database' },
			deps([]),
		);
		expect(logins.map((login) => login.construct)).toEqual(['Database']);
	});

	it('refuses a construct that is not one of its databases, before SSH', async () => {
		await deployed();
		const calls: Call[] = [];
		await expect(
			dbTunnel(
				{ stage: 'production', cwd: dir, construct: 'Api' },
				deps(calls),
			),
		).rejects.toThrow(DatabaseNotInStage);
		expect(calls).toEqual([]);
	});

	it('refuses a server that publishes no Postgres', async () => {
		await deployed();
		const calls: Call[] = [];
		const { docker } = fakeDocker();
		await expect(
			dbTunnel({ stage: 'production', cwd: dir }, deps(calls, { docker })),
		).rejects.toThrow(DatabaseNotPublished);
	});

	it('asks before opening one on a protected stage, and opens nothing on no', async () => {
		await deployed({ protected: ['production'] });
		const calls: Call[] = [];
		const asked: string[] = [];

		await expect(
			dbTunnel(
				{ stage: 'production', cwd: dir },
				deps(calls, {
					confirm: async (question) => {
						asked.push(question);
						return false;
					},
				}),
			),
		).rejects.toThrow(ExecNotConfirmed);
		expect(asked).toHaveLength(1);
		expect(asked[0]).toContain("'production' is a protected stage");
		expect(calls).toEqual([]);

		// --yes opens it without asking: a no would have refused.
		const logins = await dbTunnel(
			{ stage: 'production', cwd: dir, yes: true },
			deps(calls, { confirm: async () => false }),
		);
		expect(logins.length).toBeGreaterThan(0);
	});
});
