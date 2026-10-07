/**
 * `deploy()` as a library call, and `gkm deploy` as the terminal around it,
 * against the stand-in Dokploy. Docker is the one thing not run: `run`
 * records the argv instead.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { storeDokployCredentials } from '../../auth/credentials';
import { ConfigObjectNotSerializable } from '../../config';
import { run, runOutput } from '../../run';
import { LocalSandbox } from '../../sandbox/local';
import type { Sandbox } from '../../sandbox/sandbox';
import { deployCli } from '../cli';
import { type CredentialProvider, MissingCredential } from '../credentials';
import { type DeployInput, deploy } from '../deploy';
import type { DeployEvent } from '../events';
import { deployCommand } from '../index';
import {
	type Dokploy,
	ENDPOINT,
	emptyDokploy,
	serveDokploy,
	writeShopWorkspace,
} from './__helpers__/dokployStandIn';

vi.mock('../../run', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../run')>()),
	run: vi.fn(),
	runOutput: vi.fn(),
}));

const STAGE = 'production';
/** What `gkm deploy` printed for this deploy before it was made headless. */
const GOLDEN = './__snapshots__/gkm-deploy-first-deploy.txt';

let dokploy: Dokploy;
const server = setupServer();

/** Every request the deploy made of Dokploy, as `METHOD /api/<procedure>`. */
let requests: string[] = [];
server.events.on('request:start', ({ request }) => {
	requests.push(`${request.method} ${new URL(request.url).pathname}`);
});

describe('deploy()', () => {
	let root: string;
	let home: string;
	let elsewhere: string;
	let cwd: string;
	let out: string[];

	/** What was printed, with what differs between runs made stable. */
	const printed = () =>
		out
			.join('\n')
			.replaceAll(root, '<root>')
			.replace(/\b(proj|env|app|dom|reg|pg)_\d+\b/g, '$1_<id>');

	/** A run of this workspace, with whatever the test adds. */
	const start = (input: Partial<DeployInput> = {}) =>
		deploy({ cwd: root, stage: STAGE, tag: 'v1', ...input });

	/** Every event of a run, in order, once it has ended. */
	const eventsOf = async (input: Partial<DeployInput> = {}) => {
		const run = start(input);
		const events: DeployEvent[] = [];
		for await (const event of run) events.push(event);
		return { events, result: run.result };
	};

	beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
	afterAll(() => server.close());

	beforeEach(async () => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-headless-')));
		home = mkdtempSync(join(tmpdir(), 'gkm-headless-home-'));
		// Somewhere that is not the project: nothing may lean on the process's
		// working directory to find it.
		elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-headless-cwd-')));
		vi.stubEnv('HOME', home);
		vi.stubEnv('GKM_HOME', undefined);
		vi.stubEnv('DOKPLOY_API_TOKEN', undefined);
		vi.stubEnv('DOKPLOY_ENDPOINT', undefined);
		vi.stubEnv('DOCKER_REGISTRY_USERNAME', undefined);
		vi.stubEnv('DOCKER_REGISTRY_PASSWORD', undefined);
		cwd = process.cwd();
		process.chdir(elsewhere);
		dokploy = emptyDokploy(STAGE);
		serveDokploy(server, () => dokploy);
		requests = [];
		out = [];
		for (const level of ['log', 'warn', 'error'] as const) {
			vi.spyOn(console, level).mockImplementation((...a) => {
				out.push(
					`${level === 'log' ? '' : `${level.toUpperCase()} `}${a.join(' ')}`,
				);
			});
		}
		vi.mocked(run).mockReset();
		vi.mocked(run).mockResolvedValue();
		vi.mocked(runOutput).mockReset();
		vi.mocked(runOutput).mockImplementation(async (_, args) => {
			const ref = args.at(-1)!;
			const repository = ref.replace(/:[\w][\w.-]*$/, '');
			return JSON.stringify([`${repository}@sha256:${'0'.repeat(64)}`]);
		});
		await storeDokployCredentials('token', ENDPOINT);
		writeShopWorkspace(root, STAGE);
	});

	afterEach(() => {
		process.chdir(cwd);
		server.resetHandlers();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		for (const dir of [root, home, elsewhere]) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	describe('gkm deploy', () => {
		it('prints what it always printed for a first deploy', async () => {
			const code = await deployCli({
				cwd: root,
				provider: 'dokploy',
				stage: STAGE,
				tag: 'v1',
			});

			expect(code).toBe(0);
			await expect(printed()).toMatchFileSnapshot(GOLDEN);
		});

		it('prints the same through the deprecated deployCommand', async () => {
			process.chdir(root);

			await deployCommand({ provider: 'dokploy', stage: STAGE, tag: 'v1' });

			await expect(printed()).toMatchFileSnapshot(GOLDEN);
		});

		it('writes one JSON object per line with --json, and nothing else to stdout', async () => {
			const written: string[] = [];

			const code = await deployCli(
				{ cwd: root, provider: 'dokploy', stage: STAGE, tag: 'v1', json: true },
				{ stdout: { write: (chunk: string) => written.push(chunk) > 0 } },
			);

			expect(code).toBe(0);
			const lines = written.join('').split('\n');
			expect(lines.pop()).toBe('');
			const events = lines.map((line) => JSON.parse(line) as DeployEvent);
			expect(events[0]).toEqual({ type: 'phase.started', phase: 'validate' });
			expect(events.at(-1)).toMatchObject({
				type: 'deploy.finished',
				result: { successCount: 2, failedCount: 0 },
			});
			// The progress lines travel inside the stream, not beside it.
			expect(events.filter((e) => e.type === 'log').length).toBeGreaterThan(10);
			expect(out.filter((line) => !line.startsWith('WARN '))).toEqual([]);
		});

		it('ends a --json run that fails with the error, and exits 1', async () => {
			rmSync(join(home, '.gkm'), { recursive: true, force: true });
			const written: string[] = [];

			const code = await deployCli(
				{ cwd: root, provider: 'dokploy', stage: STAGE, json: true },
				{ stdout: { write: (chunk: string) => written.push(chunk) > 0 } },
			);

			expect(code).toBe(1);
			const last = JSON.parse(written.at(-1)!) as DeployEvent;
			expect(last).toMatchObject({
				type: 'deploy.failed',
				error: { name: 'MissingCredential' },
			});
		});

		it('creates, changes, builds and pushes nothing with --dry-run', async () => {
			const code = await deployCli({
				cwd: root,
				provider: 'dokploy',
				stage: STAGE,
				tag: 'v1',
				dryRun: true,
			});

			expect(code).toBe(0);
			// Every Dokploy call was a read; no registry was pushed to.
			expect(requests.length).toBeGreaterThan(0);
			expect(requests.filter((r) => !r.startsWith('GET '))).toEqual([]);
			expect(dokploy.created).toEqual([]);
			expect(run).not.toHaveBeenCalled();
			// No state, no lock, no generated secrets.
			expect(existsSync(join(root, '.gkm'))).toBe(false);
			expect(printed()).toContain(
				'Dry run: nothing will be created, changed, built or pushed.',
			);
			expect(printed()).toContain('+ create application:api');
		});

		it('refuses a provider other than Dokploy, and exits 1', async () => {
			const code = await deployCli({
				cwd: root,
				provider: 'docker',
				stage: STAGE,
			});

			expect(code).toBe(1);
			expect(printed()).toContain(
				'Workspace deployment only supports Dokploy. Got: docker',
			);
			expect(requests).toEqual([]);
		});
	});

	it('deploys the project it is pointed at, building each app in its own directory', async () => {
		const result = await start().result;

		expect(result).toMatchObject({
			stage: STAGE,
			identity: 'shop/shop',
			tag: 'v1',
			dryRun: false,
			successCount: 2,
			failedCount: 0,
			urls: {
				api: 'https://api.shop.example.com',
				web: 'https://shop.example.com',
			},
			skipped: [{ app: 'app', reason: 'deploys via its framework toolchain' }],
		});
		// Each image is built in its app's directory, never the process's.
		const builds = vi
			.mocked(run)
			.mock.calls.filter(([, args]) => args[0] === 'build');
		expect(builds.map(([, , options]) => options?.cwd)).toEqual([
			join(root, 'apps', 'api'),
			join(root, 'apps', 'web'),
		]);
		expect(readdirSync(elsewhere)).toEqual([]);
		// Headless: nothing was printed.
		expect(out.filter((line) => !line.startsWith('WARN '))).toEqual([]);
	});

	it('reports a run as events, in order', async () => {
		const { events, result } = await eventsOf();
		await result;

		// Everything but the progress lines, compactly.
		const sequence = events
			.filter((e) => e.type !== 'log')
			.map((e) => {
				switch (e.type) {
					case 'phase.started':
					case 'phase.finished':
						return `${e.type} ${e.phase}`;
					case 'resource.applied':
						return `${e.type} ${e.key} ${e.via}`;
					case 'artifact.built':
					case 'app.deployed':
					case 'app.skipped':
						return `${e.type} ${e.app}`;
					default:
						return e.type;
				}
			});
		expect(sequence).toMatchSnapshot();
		// Plain data all the way down.
		expect(JSON.parse(JSON.stringify(events))).toEqual(events);
	});

	it('hands its progress lines to the logger it was given', async () => {
		const logger = { info: vi.fn(), warn: vi.fn() };

		await start({ logger }).result;

		expect(logger.info).toHaveBeenCalledWith(
			'\n🚀 Deploying workspace "shop" to Dokploy...',
		);
		expect(logger.info).toHaveBeenCalledWith(
			'      ✓ api deployed successfully',
		);
	});

	describe('with no terminal to ask at', () => {
		const stdin = process.stdin as NodeJS.ReadStream & {
			setRawMode?: (mode: boolean) => NodeJS.ReadStream;
		};
		const tty = stdin.isTTY;

		afterEach(() => {
			stdin.isTTY = tty;
		});

		it.each([
			['closed', false],
			['looking like a terminal', true],
		])('never prompts or exits, with stdin %s', async (_, isTTY) => {
			rmSync(join(home, '.gkm'), { recursive: true, force: true });
			stdin.isTTY = isTTY;
			const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
				throw new Error(`process.exit(${code}) below the CLI`);
			});
			const read = vi.spyOn(process.stdin, 'on');
			const resume = vi.spyOn(process.stdin, 'resume');
			const write = vi.spyOn(process.stdout, 'write');

			const { events, result } = await eventsOf();

			await expect(result).rejects.toBeInstanceOf(MissingCredential);
			expect(exit).not.toHaveBeenCalled();
			expect(read).not.toHaveBeenCalled();
			expect(resume).not.toHaveBeenCalled();
			expect(write).not.toHaveBeenCalled();
			expect(events.at(-1)).toMatchObject({
				type: 'deploy.failed',
				error: { name: 'MissingCredential' },
			});
		});
	});

	describe('MissingCredential', () => {
		it('names the Dokploy login and how to supply it', async () => {
			rmSync(join(home, '.gkm'), { recursive: true, force: true });

			const error = await start().result.catch((e: unknown) => e);

			expect(error).toBeInstanceOf(MissingCredential);
			expect(error).toMatchObject({ kind: 'dokploy', target: ENDPOINT });
			expect((error as Error).message).toContain('DOKPLOY_API_TOKEN');
			expect((error as Error).message).toContain('gkm login');
			// Stopped before anything was created, and the stage is free again.
			expect(dokploy.created).toEqual([]);
			expect(existsSync(join(root, '.gkm', `deploy-${STAGE}.lock`))).toBe(
				false,
			);
		});

		it('names the registry login Dokploy would need, and creates nothing', async () => {
			dokploy.registries = [];

			const error = await start().result.catch((e: unknown) => e);

			expect(error).toMatchObject({
				name: 'MissingCredential',
				kind: 'registry',
				target: 'ghcr.io/acme',
			});
			expect(dokploy.registries).toEqual([]);
			expect(run).not.toHaveBeenCalled();
		});
	});

	it('uses the credentials it was handed, and nothing stored', async () => {
		rmSync(join(home, '.gkm'), { recursive: true, force: true });
		dokploy.registries = [];
		const asked: unknown[] = [];
		const credentials: CredentialProvider = {
			async get(request) {
				asked.push(request);
				return (
					request.kind === 'dokploy'
						? { endpoint: ENDPOINT, token: 'from-the-host' }
						: { username: 'bot', password: 'pat' }
				) as never;
			},
		};

		const result = await start({ credentials }).result;

		expect(result.successCount).toBe(2);
		expect(asked).toEqual([
			{ kind: 'dokploy', endpoint: ENDPOINT },
			{ kind: 'registry', url: 'ghcr.io/acme' },
		]);
		expect(dokploy.registries).toEqual([
			expect.objectContaining({ registryUrl: 'ghcr.io/acme', username: 'bot' }),
		]);
		// Nothing was stored on the host's behalf.
		expect(existsSync(join(home, '.gkm', 'credentials.json'))).toBe(false);
	});

	describe('its sandbox', () => {
		/** Every command the run started in its sandbox, with its whole env. */
		let execs: { script: string; env: Record<string, string> }[];
		let sandbox: Sandbox;

		beforeEach(() => {
			execs = [];
			const local = new LocalSandbox({ root });
			sandbox = {
				root: local.root,
				isolating: false,
				env: local.env,
				exec: (command, args, options) => {
					execs.push({
						script:
							args.find((a) => /[\\/][\w-]+-worker\.[cm]?[tj]s$/.test(a)) ??
							command,
						env: { ...options.env },
					});
					return local.exec(command, args, options);
				},
			};
			// An API with an entry, so its environment is sniffed by running it.
			writeShopWorkspace(root, STAGE, {
				apps: `{
    api: { type: 'backend', path: 'apps/api', port: 3000, entry: './src/index.ts' },
  }`,
			});
			mkdirSync(join(root, 'apps', 'api', 'src'), { recursive: true });
			writeFileSync(
				join(root, 'apps', 'api', 'src', 'index.ts'),
				`import { writeFileSync } from 'node:fs';
writeFileSync(new URL('../seen.json', import.meta.url), JSON.stringify(process.env));`,
			);
		});

		it('runs the project’s code there, where no credential reaches', async () => {
			vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'aws-key-of-the-deploy');
			const credentials: CredentialProvider = {
				async get(request) {
					return (
						request.kind === 'dokploy'
							? { endpoint: ENDPOINT, token: 'dokploy-token-of-the-host' }
							: { username: 'bot', password: 'registry-password-of-the-host' }
					) as never;
				},
			};

			const result = await start({ credentials, sandbox }).result;

			expect(result.successCount).toBe(1);
			const scripts = execs.map(({ script }) =>
				script.replace(/^.*[\\/]([\w-]+)\.[cm]?[tj]s$/, '$1'),
			);
			// Loading the config, discovering its constructs (as often as the
			// engine asks) and sniffing the API all ran in it.
			expect(scripts[0]).toBe('config-worker');
			// The engine's own reload, for the Dockerfiles, ran there too.
			expect(
				scripts.filter((s) => s === 'config-worker').length,
			).toBeGreaterThan(1);
			expect(scripts).toContain('discover-worker');
			expect(scripts).toContain('sniffer-worker');

			const handed = execs.flatMap(({ env }) => Object.entries(env));
			expect(handed.map(([key]) => key)).not.toContain('AWS_SECRET_ACCESS_KEY');
			expect(handed.map(([, value]) => value).join('\n')).not.toMatch(
				/aws-key-of-the-deploy|dokploy-token-of-the-host|registry-password-of-the-host/,
			);

			// And what the API's own code saw, from inside.
			const seen = JSON.parse(
				readFileSync(join(root, 'apps', 'api', 'seen.json'), 'utf8'),
			);
			expect(seen).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
			expect(seen).not.toHaveProperty('DOKPLOY_API_TOKEN');
		});

		it('refuses a config holding live objects when the sandbox isolates', async () => {
			writeFileSync(
				join(root, 'gkm.config.ts'),
				`${readFileSync(join(root, 'gkm.config.ts'), 'utf8').replace(
					"name: 'shop',",
					"name: 'shop',\n  state: { provider: { read: async () => null, write: async () => {} } },",
				)}`,
			);

			const { events, result } = await eventsOf({
				sandbox: { ...sandbox, isolating: true },
			});

			await expect(result).rejects.toBeInstanceOf(ConfigObjectNotSerializable);
			expect(events.at(-1)).toMatchObject({
				type: 'deploy.failed',
				error: { name: 'ConfigObjectNotSerializable' },
			});
			// Nothing was asked of Dokploy for a project it could not read.
			expect(requests).toEqual([]);
		});
	});

	describe('a dry run', () => {
		it('plans what a first deploy would create, and touches nothing', async () => {
			const { events, result } = await eventsOf({ dryRun: true });
			const planned = await result;

			expect(planned).toMatchObject({ dryRun: true, projectId: '' });
			expect(
				events
					.filter((e) => e.type === 'resource.planned')
					.map((e) => `${e.action} ${e.key}`),
			).toEqual([
				'create project',
				'create environment',
				'reuse registry',
				'create application:api',
				'build image:api',
				'create domain:api.shop.example.com',
				'create application:web',
				'build image:web',
				'create domain:shop.example.com',
			]);
			expect(requests.filter((r) => !r.startsWith('GET '))).toEqual([]);
			expect(run).not.toHaveBeenCalled();
			expect(existsSync(join(root, '.gkm'))).toBe(false);
		});

		it('reuses what an earlier deploy made', async () => {
			const deployed = await start().result;
			requests = [];
			vi.mocked(run).mockClear();

			const planned = await start({ dryRun: true, tag: 'v2' }).result;

			expect(planned.projectId).toBe(deployed.projectId);
			expect(
				planned.changes
					.filter((c) => c.action !== 'build')
					.map((c) => c.action),
			).toEqual(Array(7).fill('reuse'));
			expect(planned.apps.map((a) => a.applicationId)).toEqual(
				deployed.apps.map((a) => a.applicationId),
			);
			expect(requests.filter((r) => !r.startsWith('GET '))).toEqual([]);
			expect(run).not.toHaveBeenCalled();
		});
	});

	describe('stopped through its signal', () => {
		it('starts nothing when the signal has already fired', async () => {
			const controller = new AbortController();
			controller.abort(new Error('not now'));

			await expect(start({ signal: controller.signal }).result).rejects.toThrow(
				'not now',
			);
			expect(requests).toEqual([]);
		});

		it('stops part way, with the reason, and releases the stage', async () => {
			const controller = new AbortController();
			const reason = new Error('the operator stopped it');
			vi.mocked(run).mockImplementation(async (_, args) => {
				if (args[0] === 'build') controller.abort(reason);
			});

			const { events, result } = await eventsOf({ signal: controller.signal });

			await expect(result).rejects.toBe(reason);
			expect(events.at(-1)).toEqual({
				type: 'deploy.failed',
				error: { name: 'Error', message: 'the operator stopped it' },
			});
			// The site after the API was never started.
			expect(
				vi.mocked(run).mock.calls.filter(([, args]) => args[0] === 'build'),
			).toHaveLength(1);
			expect(existsSync(join(root, '.gkm', `deploy-${STAGE}.lock`))).toBe(
				false,
			);
		});
	});
});
