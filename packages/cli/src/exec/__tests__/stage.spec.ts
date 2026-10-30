import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from 'node:fs';
import { createConnection, createServer, type Server } from 'node:net';
import { join } from 'node:path';
import {
	afterEach,
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
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import {
	type Call,
	fakeDocker,
} from '../../compose/__tests__/__helpers__/fakeDocker';
import { deployedStackSecrets } from '../../compose/secrets';
import {
	ComposeServerUnreachable,
	type ServerAccess,
} from '../../compose/server';
import { composeStack } from '../../compose/stack';
import { loadWorkspaceSettings } from '../../config';
import { deployIdentity } from '../../deploy/identity';
import { secretsStoreFor } from '../../secrets/store';
import type { StageSecrets } from '../../secrets/types';
import { UndeclaredStage } from '../../workspace/stages';
import { execCommand } from '../index';
import {
	appEnvironment,
	ExecAppNotInStack,
	ExecNotConfirmed,
	ExecStageNotComposed,
	ExecStageNotDeployed,
	execOnStage,
	type StageExecDeps,
	stackAddresses,
	throughTunnels,
} from '../stage';

/**
 * `gkm exec --stage production`: the compose fixture's stage, its secrets in
 * a real store, a real command — and a real tunnel, to the suite's Postgres,
 * standing in for SSH's. Only the server's Docker is a recorder.
 */

const SIGNING_SECRET = 'the-production-signing-secret';

let dir: string;

beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-exec-stage-'));
	vi.stubEnv('GKM_HOME', join(dir, '.home'));
	vi.stubEnv('NODE_OPTIONS', '');
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await cleanupDir(dir);
});

/**
 * The fixture, deployed: its secrets as its first deploy left them, the
 * server's address beside them.
 */
async function deployed(
	options: Parameters<typeof writeComposeApp>[1] = {},
): Promise<StageSecrets> {
	writeComposeApp(dir, { target: 'compose', ...options });
	const { workspace, manifest } = await loadComposeApp(dir);
	const { secrets } = deployedStackSecrets(workspace, 'production', null, {
		...manifest,
	});
	const kept: StageSecrets = {
		...secrets,
		custom: {
			...secrets.custom,
			AUTH_SECRET: SIGNING_SECRET,
			BACKUPS_URL: 's3://K:S@backups?region=eu-west-1',
			GKM_SERVER_IPV4: SERVER_IPV4,
		},
	};
	const store = await secretsStoreFor(
		await loadWorkspaceSettings(dir),
		'production',
	);
	await store.write('production', kept);
	return kept;
}

async function productionStack() {
	const { workspace, manifest, background } = await loadComposeApp(dir);
	const store = await secretsStoreFor(workspace, 'production');
	return composeStack({
		workspace,
		manifest,
		background,
		stage: 'production',
		identity: deployIdentity(workspace, 'production'),
		images: { mode: 'build', tag: 'exec' },
		secrets: await store.read('production'),
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

function deps(
	calls: Call[],
	overrides: Partial<StageExecDeps> = {},
): StageExecDeps {
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
		...overrides,
	};
}

function refuses(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: '127.0.0.1', port });
		socket.once('connect', () => {
			socket.destroy();
			resolve(false);
		});
		socket.once('error', () => resolve(true));
	});
}

/**
 * A node process that connects to its DATABASE URL's host and port, and
 * writes down what it was given and whether the connection was accepted.
 */
const RECORDER = `
const net = require('net');
const fs = require('fs');
const url = new URL(process.env.DATABASE_URL);
const socket = net.connect(Number(url.port), url.hostname);
const done = (connected) => {
  fs.writeFileSync('seen.json', JSON.stringify({
    connected,
    env: { DATABASE_URL: process.env.DATABASE_URL, AUTH_URL: process.env.AUTH_URL },
    credentials: globalThis.__gkm_credentials__,
  }));
  socket.destroy();
  process.exit(Number(process.env.EXIT_WITH ?? 0));
};
socket.on('connect', () => done(true));
socket.on('error', () => done(false));
`;

describe("the app's environment on a deployed stage", () => {
	it("is the container's, with each published service through a tunnel", async () => {
		await deployed();
		const stack = await productionStack();
		const env = appEnvironment(stack, 'api');

		// The container reaches Postgres and its siblings on the stack's network.
		const db = new URL(env.DATABASE_URL!);
		expect(db.host).toBe('postgres:5432');
		expect(stackAddresses(env, stack)).toContainEqual({
			service: 'postgres',
			port: 5432,
		});

		const here = throughTunnels(
			env,
			stack,
			new Map([['postgres:5432', 61_000]]),
		);
		const tunneled = new URL(here.DATABASE_URL!);
		expect(tunneled.host).toBe('127.0.0.1:61000');
		// The app's own login, untouched.
		expect(tunneled.username).toBe(db.username);
		expect(tunneled.password).toBe(db.password);
		expect(tunneled.pathname).toBe(db.pathname);
		// A sibling is reached at its public address, not the network's.
		const auth = stack.apps.find((app) => app.name === 'auth')!;
		expect(env.AUTH_URL).toMatch(/^http:\/\/auth:\d+$/);
		expect(here.AUTH_URL).toBe(auth.url);
		// Everything else is as the container has it.
		expect(here.AUTH_SECRET ?? SIGNING_SECRET).toBe(SIGNING_SECRET);
		expect(here.STAGE).toBe('production');
	});

	it('is refused for a directory that is no app of the stack', async () => {
		await deployed();
		const stack = await productionStack();
		expect(() => appEnvironment(stack, undefined)).toThrow(ExecAppNotInStack);
		expect(() => appEnvironment(stack, 'mobile')).toThrow(ExecAppNotInStack);
	});
});

describe('gkm exec --stage', () => {
	it('runs the command through a tunnel, and closes it once it exits', async () => {
		await deployed();
		const api = join(dir, 'apps', 'api');
		const calls: Call[] = [];
		const before = files(dir);

		const code = await execOnStage(
			[process.execPath, '-e', RECORDER],
			{ stage: 'production', cwd: api },
			deps(calls),
		);

		expect(code).toBe(0);
		const seen = JSON.parse(readFileSync(join(api, 'seen.json'), 'utf-8'));
		expect(seen.connected).toBe(true);
		const url = new URL(seen.env.DATABASE_URL);
		expect(url.hostname).toBe('127.0.0.1');
		// Credentials hold the same values the environment does.
		expect(seen.credentials.DATABASE_URL).toBe(seen.env.DATABASE_URL);
		expect(seen.credentials.STAGE).toBe('production');

		// Asked of the server's Docker, over SSH, and tunneled to what it said.
		expect(calls).toContainEqual({
			op: 'published',
			args: ['compose-app-production', 'postgres', 5432],
			host: `ssh://deploy@${SERVER_IPV4}`,
		});
		// Postgres alone is published; one tunnel, closed last.
		expect(tunnelOps(calls)).toEqual(['tunnel', 'tunnel-closed']);
		expect(calls.find((call) => call.op === 'tunnel')!.args).toEqual([
			`deploy@${SERVER_IPV4}`,
			54_321,
		]);
		expect(await refuses(Number(url.port))).toBe(true);

		// Nothing written here but what the command wrote.
		expect(files(dir).filter((file) => !before.includes(file))).toEqual([
			'apps/api/seen.json',
		]);
	});

	it("closes the tunnel when the command fails, and returns the command's code", async () => {
		await deployed();
		vi.stubEnv('EXIT_WITH', '3');
		const api = join(dir, 'apps', 'api');
		const calls: Call[] = [];

		const code = await execOnStage(
			[process.execPath, '-e', RECORDER],
			{ stage: 'production', cwd: api },
			deps(calls),
		);

		expect(code).toBe(3);
		expect(calls.map((call) => call.op)).toContain('tunnel-closed');
		const seen = JSON.parse(readFileSync(join(api, 'seen.json'), 'utf-8'));
		expect(await refuses(Number(new URL(seen.env.DATABASE_URL).port))).toBe(
			true,
		);
	});

	it('closes the tunnel when the command is interrupted', async () => {
		await deployed();
		const calls: Call[] = [];

		const code = await execOnStage(
			[process.execPath, '-e', "process.kill(process.pid, 'SIGINT')"],
			{ stage: 'production', cwd: join(dir, 'apps', 'api') },
			deps(calls),
		);

		expect(code).toBe(130);
		expect(tunnelOps(calls)).toEqual(['tunnel', 'tunnel-closed']);
	});

	it('leaves an address the server does not publish as it is, and says so', async () => {
		await deployed();
		const calls: Call[] = [];
		const { docker } = fakeDocker();

		const code = await execOnStage(
			[process.execPath, '-e', RECORDER],
			{ stage: 'production', cwd: join(dir, 'apps', 'api') },
			deps(calls, { docker }),
		);

		expect(code).toBe(0);
		const said = (console.log as unknown as MockInstance).mock.calls
			.flat()
			.join('\n');
		expect(said).toContain('postgres is not published on the server');
		const seen = JSON.parse(
			readFileSync(join(dir, 'apps', 'api', 'seen.json'), 'utf-8'),
		);
		expect(new URL(seen.env.DATABASE_URL).host).toBe('postgres:5432');
	});

	it('asks before running against a protected stage, and runs nothing on no', async () => {
		await deployed({ protected: ['production'] });
		const calls: Call[] = [];
		const asked: string[] = [];

		await expect(
			execOnStage(
				[process.execPath, '-e', ''],
				{ stage: 'production', cwd: join(dir, 'apps', 'api') },
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

		// --yes runs without asking: a no would have refused.
		const code = await execOnStage(
			[process.execPath, '-e', ''],
			{ stage: 'production', cwd: join(dir, 'apps', 'api'), yes: true },
			deps(calls, { confirm: async () => false }),
		);
		expect(code).toBe(0);
	});

	it('reaches the server as the --ssh-user login, over the configured one', async () => {
		await deployed();
		const calls: Call[] = [];

		const code = await execOnStage(
			[process.execPath, '-e', RECORDER],
			{
				stage: 'production',
				cwd: join(dir, 'apps', 'api'),
				sshUser: 'midas',
			},
			deps(calls),
		);

		expect(code).toBe(0);
		expect(calls).toContainEqual(
			expect.objectContaining({
				op: 'published',
				host: `ssh://midas@${SERVER_IPV4}`,
			}),
		);
		expect(calls.find((call) => call.op === 'tunnel')!.args).toEqual([
			`midas@${SERVER_IPV4}`,
			54_321,
		]);
	});

	it('is what gkm exec --stage runs, with every option it was given', async () => {
		await deployed();
		const calls: Call[] = [];

		await execCommand(
			[process.execPath, '-e', RECORDER],
			{
				stage: 'production',
				cwd: join(dir, 'apps', 'api'),
				sshUser: 'midas',
			},
			deps(calls),
		);

		const seen = JSON.parse(
			readFileSync(join(dir, 'apps', 'api', 'seen.json'), 'utf-8'),
		);
		expect(seen.connected).toBe(true);
		expect(calls.find((call) => call.op === 'tunnel')!.args).toEqual([
			`midas@${SERVER_IPV4}`,
			54_321,
		]);
	});

	it('says SSH refused the login, and runs nothing', async () => {
		await deployed();
		const calls: Call[] = [];
		const refused = new ComposeServerUnreachable(
			`deploy@${SERVER_IPV4}`,
			'Permission denied (publickey).',
		);
		const server = realServer(calls);

		await expect(
			execOnStage(
				[process.execPath, '-e', RECORDER],
				{ stage: 'production', cwd: join(dir, 'apps', 'api') },
				deps(calls, {
					server: {
						...server,
						check: async () => {
							throw refused;
						},
					},
				}),
			),
		).rejects.toThrow(refused);
		expect(calls).toEqual([]);
		expect(existsSync(join(dir, 'apps', 'api', 'seen.json'))).toBe(false);
	});

	it('refuses a stage that was never deployed', async () => {
		writeComposeApp(dir, { target: 'compose' });

		await expect(
			execOnStage(
				[process.execPath, '-e', ''],
				{ stage: 'production', cwd: join(dir, 'apps', 'api') },
				deps([]),
			),
		).rejects.toThrow(ExecStageNotDeployed);
	});

	it('refuses a stage the project does not deploy, or not with compose', async () => {
		await deployed({ target: 'dokploy' });
		const api = join(dir, 'apps', 'api');

		await expect(
			execOnStage(
				[process.execPath],
				{ stage: 'production', cwd: api },
				deps([]),
			),
		).rejects.toThrow(ExecStageNotComposed);
		await expect(
			execOnStage([process.execPath], { stage: 'staging', cwd: api }, deps([])),
		).rejects.toThrow(UndeclaredStage);
	});

	it('refuses the workspace root, which is no app', async () => {
		await deployed();
		mkdirSync(join(dir, 'scripts'), { recursive: true });

		await expect(
			execOnStage(
				[process.execPath],
				{ stage: 'production', cwd: join(dir, 'scripts') },
				deps([]),
			),
		).rejects.toThrow(ExecAppNotInStack);
	});
});

/** The tunnels opened and closed, in order. */
function tunnelOps(calls: readonly Call[]): string[] {
	return calls.map((call) => call.op).filter((op) => op.startsWith('tunnel'));
}

/** Every file under `root`, relative, skipping dependencies. */
function files(root: string, prefix = ''): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(join(root, prefix))) {
		if (entry === 'node_modules') continue;
		const path = prefix ? `${prefix}/${entry}` : entry;
		if (statSync(join(root, path)).isDirectory())
			out.push(...files(root, path));
		else out.push(path);
	}
	return out;
}
