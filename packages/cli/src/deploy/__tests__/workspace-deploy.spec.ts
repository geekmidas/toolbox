/**
 * `gkm deploy` of a whole workspace, against a stand-in Dokploy.
 *
 * The stand-in keeps state — projects, environments, applications, registries,
 * domains — so a second deploy meets what the first one created, the way a
 * real redeploy does. Docker is the one thing not run: `docker build` and
 * `docker push` go through `run`, which records the argv instead.
 * Everything else is real: the workspace on disk, the Dockerfile generation,
 * the deploy state file, the credentials under a temp HOME.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw';
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
import { loadWorkspaceConfig } from '../../config';
import { run, runOutput } from '../../run';
import { FileSecretsStore } from '../../secrets/file';
import type { NormalizedWorkspace } from '../../workspace/types';
import { deployCommand, workspaceDeployCommand } from '../index';
import { LocalStateStore } from '../LocalStateStore';
import { ProjectNotOwned } from '../ownership';
import { RegistryNotConfigured } from '../registry';
import { StateLocked } from '../StateStore';
import {
	type Dokploy,
	ENDPOINT,
	emptyDokploy,
	type ShopWorkspace,
	serveDokploy,
	writeShopWorkspace,
} from './__helpers__/dokployStandIn';

vi.mock('../../run', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../run')>()),
	run: vi.fn(),
	runOutput: vi.fn(),
}));

const STAGE = 'production';

let dokploy: Dokploy;
const server = setupServer();

const serve = () => serveDokploy(server, () => dokploy);

/** Every `docker …` command the deploy ran, in order. */
const docker = () =>
	vi.mocked(run).mock.calls.map(([command, args]) => [command, ...args]);

/** The digest the stand-in registry gives a pushed ref: stable per ref. */
const digestOf = (ref: string) =>
	`sha256:${Buffer.from(ref).toString('hex').padEnd(64, '0').slice(0, 64)}`;

describe('workspaceDeployCommand', () => {
	let root: string;
	let home: string;
	let cwd: string;
	let out: string[];

	/** A workspace with an API, a Next.js site that calls it, and an Expo app. */
	function workspace(extra: ShopWorkspace = {}) {
		writeShopWorkspace(root, STAGE, extra);
	}

	const deploy = async (
		options: {
			stage?: string;
			apps?: string[];
			tag?: string;
			/** Adjusts the loaded workspace, for what config cannot say. */
			adjust?: (workspace: NormalizedWorkspace) => void;
		} = {},
	) => {
		const { workspace: loaded } = await loadWorkspaceConfig(root);
		options.adjust?.(loaded);
		return workspaceDeployCommand(loaded, {
			provider: 'dokploy',
			stage: options.stage ?? STAGE,
			tag: options.tag ?? 'v1',
			...(options.apps ? { apps: options.apps } : {}),
		});
	};

	/** The stage's state document, as the store wrote it (schema v2). */
	const document = (stage = STAGE) =>
		JSON.parse(
			readFileSync(join(root, '.gkm', `deploy-${stage}.json`), 'utf8'),
		);
	const state = (stage = STAGE) => document(stage).state;
	const resources = (stage = STAGE) => document(stage).resources;

	const said = () => out.join('\n');

	beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
	afterAll(() => server.close());

	beforeEach(async () => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-deploy-ws-')));
		home = mkdtempSync(join(tmpdir(), 'gkm-deploy-home-'));
		vi.stubEnv('HOME', home);
		vi.stubEnv('DOKPLOY_API_TOKEN', undefined);
		vi.stubEnv('DOKPLOY_ENDPOINT', undefined);
		cwd = process.cwd();
		process.chdir(root);
		dokploy = emptyDokploy(STAGE);
		serve();
		out = [];
		vi.spyOn(console, 'log').mockImplementation((...a) => {
			out.push(a.join(' '));
		});
		vi.spyOn(console, 'warn').mockImplementation((...a) => {
			out.push(`WARN ${a.join(' ')}`);
		});
		vi.mocked(run).mockReset();
		vi.mocked(run).mockResolvedValue();
		// What `docker image inspect` says a pushed image's digests are.
		vi.mocked(runOutput).mockReset();
		vi.mocked(runOutput).mockImplementation(async (_, args) => {
			const ref = args.at(-1)!;
			const repository = ref.replace(/:[\w][\w.-]*$/, '');
			return JSON.stringify([`${repository}@${digestOf(ref)}`]);
		});
		await storeDokployCredentials('token', ENDPOINT);
		workspace();
	});

	afterEach(() => {
		process.chdir(cwd);
		server.resetHandlers();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	it('creates everything on a first deploy and records it in state', async () => {
		const result = await deploy();

		expect(result).toMatchObject({ successCount: 2, failedCount: 0 });
		const project = dokploy.projects[0]!;
		expect(project.name).toBe('shop');

		// Backends first, each image built for the server and pushed.
		expect(docker()).toEqual([
			expect.arrayContaining([
				'docker',
				'build',
				'--tag=ghcr.io/acme/shop/shop-api:v1',
			]),
			['docker', 'push', 'ghcr.io/acme/shop/shop-api:v1'],
			expect.arrayContaining([
				'docker',
				'build',
				'--tag=ghcr.io/acme/shop/shop-web:v1',
			]),
			['docker', 'push', 'ghcr.io/acme/shop/shop-web:v1'],
		]);
		expect(docker()[0]).toContain('--platform=linux/amd64');

		// The site's build knows where the API answers, before it is built.
		expect(docker()[2]).toContain(
			'--build-arg=NEXT_PUBLIC_API_URL=https://api.shop.example.com',
		);

		const [api, web] = project.environments[0]!.applications;
		expect(dokploy.env[api!.applicationId]).toContain('STAGE=production');
		expect(dokploy.env[web!.applicationId]).toContain(
			'NEXT_PUBLIC_API_URL=https://api.shop.example.com',
		);
		expect(dokploy.deployed).toEqual([api!.applicationId, web!.applicationId]);

		// The site holds the base domain; the API its own name under it.
		expect(dokploy.domains.map((d) => d.host)).toEqual([
			'api.shop.example.com',
			'shop.example.com',
		]);

		expect(state()).toMatchObject({
			projectId: project.projectId,
			applications: {
				api: api!.applicationId,
				web: web!.applicationId,
			},
			identity: 'shop/shop',
			// The registry Dokploy has for the configured URL, kept with the
			// stage for the next deploy.
			registryId: 'reg_1',
			// Each image with the digest the registry gave it.
			images: {
				api: {
					ref: 'ghcr.io/acme/shop/shop-api:v1',
					digest: digestOf('ghcr.io/acme/shop/shop-api:v1'),
				},
				web: {
					ref: 'ghcr.io/acme/shop/shop-web:v1',
					digest: digestOf('ghcr.io/acme/shop/shop-web:v1'),
				},
			},
		});
		// The project says who made it, so nobody else's deploy adopts it.
		expect(project.description).toContain('gkm:shop/shop');
		// Applications are scoped by stage and identity.
		expect(api!.name).toBe('production-shop-api');
		// The mobile app ships through its own toolchain.
		expect(said()).toContain('Skipping 1 mobile app(s)');
	});

	it('reuses what the first deploy made', async () => {
		await deploy();
		const applications = { ...state().applications };
		const domains = dokploy.domains.length;

		const result = await deploy({ tag: 'v2' });

		expect(result.successCount).toBe(2);
		expect(dokploy.projects).toHaveLength(1);
		expect(state().applications).toEqual(applications);
		expect(dokploy.domains).toHaveLength(domains);
		expect(said()).toContain('Found existing project: shop');
		expect(said()).toContain(`Using environment: ${STAGE}`);
		expect(said()).toContain('Using registry: GHCR');
		expect(said()).toContain(`Using cached ID: ${applications.api}`);
		expect(said()).toContain('(existing)');
		expect(dokploy.images[applications.api]).toBe(
			'ghcr.io/acme/shop/shop-api:v2',
		);
	});

	it('adds the stage as an environment of an existing project', async () => {
		await deploy();

		await deploy({ stage: 'staging' });

		const environments = dokploy.projects[0]!.environments.map((e) => e.name);
		expect(environments).toEqual([STAGE, 'staging']);
		expect(said()).toContain('Creating "staging" environment...');
		expect(dokploy.domains.map((d) => d.host)).toContain(
			'api.staging.shop.example.com',
		);
	});

	it('creates the stage environment when a new project starts with another', async () => {
		dokploy.defaultEnvironment = 'production';

		await deploy({ stage: 'staging' });

		expect(dokploy.projects[0]!.environments.map((e) => e.name)).toEqual([
			'production',
			'staging',
		]);
		expect(state('staging').environmentId).toBe(
			dokploy.projects[0]!.environments[1]!.environmentId,
		);
	});

	it('corrects state that names a project and environment that moved', async () => {
		mkdirSync(join(root, '.gkm'), { recursive: true });
		writeFileSync(
			join(root, '.gkm', `deploy-${STAGE}.json`),
			JSON.stringify({
				provider: 'dokploy',
				stage: STAGE,
				projectId: 'proj_gone',
				environmentId: 'env_gone',
				applications: { api: 'app_gone' },
				services: {},
				lastDeployedAt: '2026-01-01T00:00:00.000Z',
			}),
		);

		await deploy();

		expect(said()).toContain('Project ID changed, updating state');
		expect(said()).toContain('Environment ID changed, updating state');
		expect(said()).toContain('Cached ID invalid, will create new');
		expect(state().projectId).toBe(dokploy.projects[0]!.projectId);
		expect(state().applications.api).not.toBe('app_gone');
	});

	it('forgets a stage registry Dokploy no longer has', async () => {
		await deploy();
		const stale = { ...state(), registryId: 'reg_gone' };
		writeFileSync(
			join(root, '.gkm', `deploy-${STAGE}.json`),
			JSON.stringify(stale),
		);

		await deploy({ tag: 'v2' });

		expect(said()).toContain(
			"The stage's registry reg_gone no longer exists in Dokploy",
		);
		expect(state().registryId).toBe('reg_1');
	});

	it('never pushes through a registry nobody configured', async () => {
		// Dokploy has one, and it used to be taken because it was first.
		workspace({ registry: false });

		await expect(deploy()).rejects.toBeInstanceOf(RegistryNotConfigured);
		expect(docker()).toEqual([]);
		expect(dokploy.images).toEqual({});
	});

	it('picks the registry for the configured URL, not the first one listed', async () => {
		dokploy.registries = [
			{ registryId: 'reg_hub', registryName: 'Hub', registryUrl: 'docker.io' },
			{
				registryId: 'reg_gh',
				registryName: 'GHCR',
				registryUrl: 'https://ghcr.io/',
			},
		];

		await deploy();

		expect(state().registryId).toBe('reg_gh');
		expect(said()).toContain('Using registry: GHCR');
	});

	it('asks for registry credentials it cannot prompt for without a terminal', async () => {
		dokploy.registries = [];

		await expect(deploy()).rejects.toThrow('Interactive input required');
	});

	it('keeps going when a domain cannot be created', async () => {
		dokploy.failDomains = ['api.shop.example.com', 'shop.example.com'];

		const result = await deploy();

		expect(result.successCount).toBe(2);
		expect(said()).toContain(
			'Domain creation failed: Dokploy API error: Domain already in use',
		);
	});

	it('aborts when a backend fails, before any site is built', async () => {
		vi.mocked(run).mockImplementation(async (_, args) => {
			if (args.some((a) => a.includes('shop-api'))) throw new Error('no space');
		});

		await expect(deploy()).rejects.toThrow(
			'Backend deployment failed for api. Aborting to prevent partial deployment.',
		);
		expect(docker().some((c) => c.some((a) => a.includes('shop-web')))).toBe(
			false,
		);
	});

	it('reports a site that fails and still saves state', async () => {
		vi.mocked(run).mockImplementation(async (_, args) => {
			if (args.some((a) => a.includes('shop-web'))) throw new Error('OOM');
		});

		const result = await deploy();

		expect(result).toMatchObject({ successCount: 1, failedCount: 1 });
		expect(result.apps.find((a) => a.appName === 'web')).toMatchObject({
			success: false,
			error: expect.stringContaining('Failed to build Docker image: OOM'),
		});
		expect(said()).toContain('Failed: 1');
		expect(state().applications.web).toBeDefined();
	});

	it('deploys only the apps asked for', async () => {
		const result = await deploy({ apps: ['api'] });

		expect(result.apps.map((a) => a.appName)).toEqual(['api']);
		expect(said()).toContain('Deploying apps: api');
	});

	it('refuses an app the workspace does not have', async () => {
		await expect(deploy({ apps: ['admin'] })).rejects.toThrow(
			'Unknown apps: admin',
		);
	});

	it('skips an app that deploys somewhere else, and refuses when all do', async () => {
		// The config refuses a non-Dokploy target outright, so this is the
		// workspace a programmatic caller could still hand over.
		const elsewhere = (workspace: NormalizedWorkspace) => {
			workspace.apps.web!.resolvedDeployTarget = 'vercel';
		};

		const result = await deploy({ adjust: elsewhere });
		expect(result.apps.map((a) => a.appName)).toEqual(['api']);
		expect(said()).toContain('Skipping web');

		await expect(deploy({ apps: ['web'], adjust: elsewhere })).rejects.toThrow(
			'No apps to deploy. All selected apps have unsupported deploy targets.',
		);
	});

	describe('an API that reads its own configuration', () => {
		/** An API whose entry parses STRIPE_KEY and SENTRY_DSN at load. */
		const readsSecrets = () => {
			mkdirSync(join(root, 'apps', 'api', 'src'), { recursive: true });
			writeFileSync(
				join(root, 'apps', 'api', 'src', 'env.ts'),
				`import { EnvironmentParser } from '@geekmidas/envkit';

export const config = new EnvironmentParser(process.env)
  .create((get) => ({
    stripe: get('STRIPE_KEY').string(),
    sentry: get('SENTRY_DSN').string(),
  }))
  .parse();
`,
			);
			workspace({
				apps: `{
    api: { type: 'backend', path: 'apps/api', port: 3000, entry: './src/env.ts' },
  }`,
			});
		};

		const secrets = (custom: Record<string, string>) =>
			new FileSecretsStore(root).write(STAGE, {
				stage: STAGE,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
				services: {},
				urls: {},
				custom,
			});

		it('bakes the stage secrets it reads into its image, encrypted', async () => {
			readsSecrets();
			await secrets({ STRIPE_KEY: 'sk_live_x', SENTRY_DSN: 'https://s' });

			// What the build was handed, read while it runs: the file is the
			// deploy's to remove once the build is done.
			let secret: { path: string; content: string; mode: number } | undefined;
			vi.mocked(run).mockImplementation(async (_, args) => {
				const flag = args.find((a) => a.startsWith('--secret='));
				if (!flag) return;
				const path = flag.split(',src=')[1]!;
				secret = {
					path,
					content: readFileSync(path, 'utf8'),
					mode: statSync(path).mode & 0o777,
				};
			});

			const result = await deploy();

			expect(result.successCount).toBe(1);
			expect(said()).toContain('Encrypted secrets for: api');

			// A build secret, not build args: those show in `ps` and in
			// `docker history`.
			const build = docker()[0]!;
			expect(build).toContain(
				`--secret=id=gkm_credentials,src=${secret!.path}`,
			);
			expect(build.some((a) => a.includes('GKM_'))).toBe(false);
			// Ciphertext then IV, owner-only, and gone after the build.
			const [encrypted, iv] = secret!.content.trimEnd().split('\n');
			expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
			expect(iv).toMatch(/^[0-9a-f]{24}$/);
			expect(secret!.mode).toBe(0o600);
			expect(existsSync(secret!.path)).toBe(false);
			// The plaintext never reaches the build.
			expect(secret!.content).not.toContain('sk_live_x');
			expect(build.join(' ')).not.toContain('sk_live_x');

			// Nothing key-shaped (32 bytes of hex) in this deploy's output, which
			// ends up in CI logs.
			expect(said()).not.toMatch(/[0-9a-f]{64}/);
		});

		it('names a secret the stage lacks, and refuses to deploy without it', async () => {
			readsSecrets();
			await secrets({ STRIPE_KEY: 'sk_live_x' });

			await expect(deploy()).rejects.toThrow(
				'Backend deployment failed for api',
			);
			expect(said()).toContain('api: Missing secrets: SENTRY_DSN');
			expect(said()).toContain('SENTRY_DSN');
		});
	});

	describe('a workspace that declares a database', () => {
		beforeEach(() => {
			mkdirSync(join(root, 'apps', 'api', 'src', 'constructs'), {
				recursive: true,
			});
			// Discovery is structural: an id and a declaration are a construct.
			writeFileSync(
				join(root, 'apps', 'api', 'src', 'constructs', 'ledger.ts'),
				`export const Ledger = {
  id: 'Ledger',
  declare: () => [
    { kind: 'database', id: 'Ledger', engine: 'postgres', schema: 'app', provides: [] },
  ],
};
`,
			);
			workspace({
				apps: `{
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      constructs: './src/constructs/**/*.ts',
    },
  }`,
			});
		});

		// The role DDL needs the cluster reachable from here, so an unpublished
		// cluster gets a port first — and a deploy that cannot publish one stops
		// before building anything.
		it('tries another port when the conventional one is taken, and says what is in use', async () => {
			await expect(deploy()).rejects.toThrow(
				/Could not publish a port for .+\. In use on this server: none reported/,
			);
			const [cluster] = dokploy.projects[0]!.environments[0]!.postgres;
			expect(cluster?.databaseName).toBe('ledger_production');
			expect(dokploy.savedPorts[0]).toBe(5432);
			expect(dokploy.savedPorts[1]).toBeGreaterThanOrEqual(49152);
			expect(said()).toContain('Port 5432 is taken; trying another...');
			expect(docker()).toEqual([]);
		});

		it('stops on any other refusal to publish', async () => {
			dokploy.portRefusal = () => 'Docker daemon unreachable';

			await expect(deploy()).rejects.toThrow('Docker daemon unreachable');
			expect(dokploy.savedPorts).toEqual([5432]);
		});
	});

	describe('with DNS configured', () => {
		/** A registrar held in memory, recording what it was asked to write. */
		const registrar = () => {
			const written: { domain: string; names: string[] }[] = [];
			const provider = {
				name: 'in-memory',
				getRecords: async () => [],
				upsertRecords: async (domain: string, records: { name: string }[]) => {
					written.push({ domain, names: records.map((r) => r.name) });
					return records.map((record) => ({
						record,
						created: true,
						unchanged: false,
					}));
				},
				deleteRecords: async () => [],
			};
			return { provider, written };
		};

		it('points each host at the server, then asks Dokploy to validate it', async () => {
			// A first deploy, then the hosts marked verified against this server,
			// so the second checks nothing over the network.
			await deploy();
			const verified = state();
			verified.dnsVerified = Object.fromEntries(
				['api.shop.example.com', 'shop.example.com'].map((host) => [
					host,
					{ serverIp: '127.0.0.1', verifiedAt: '2026-01-01T00:00:00.000Z' },
				]),
			);
			writeFileSync(
				join(root, '.gkm', `deploy-${STAGE}.json`),
				JSON.stringify(verified),
			);
			dokploy.validity = { 'api.shop.example.com': true };
			const { provider, written } = registrar();
			out.length = 0;

			await deploy({
				tag: 'v2',
				adjust: (workspace) => {
					workspace.deploy.dns = {
						'shop.example.com': { provider },
					} as never;
				},
			});

			expect(written).toEqual([
				{ domain: 'shop.example.com', names: ['api', '@'] },
			]);
			expect(said()).toContain('api.shop.example.com (previously verified)');
			expect(said()).toContain('✓ api: api.shop.example.com → 127.0.0.1');
			expect(said()).toMatch(
				/⚠ web: validation failed - .*Traefik unreachable/,
			);
		});

		it('says which hosts Dokploy could not validate', async () => {
			await deploy();
			const verified = state();
			verified.dnsVerified = {
				'api.shop.example.com': {
					serverIp: '127.0.0.1',
					verifiedAt: '2026-01-01T00:00:00.000Z',
				},
				'shop.example.com': {
					serverIp: '127.0.0.1',
					verifiedAt: '2026-01-01T00:00:00.000Z',
				},
			};
			writeFileSync(
				join(root, '.gkm', `deploy-${STAGE}.json`),
				JSON.stringify(verified),
			);
			dokploy.validity = {
				'api.shop.example.com': false,
				'shop.example.com': false,
			};

			await deploy({
				tag: 'v2',
				adjust: (workspace) => {
					workspace.deploy.dns = {
						'shop.example.com': { provider: registrar().provider },
					} as never;
				},
			});

			expect(said()).toContain('⚠ api: api.shop.example.com not valid');
			expect(said()).toContain('⚠ web: shop.example.com not valid');
		});
	});

	it('warns when the stage has no secrets', async () => {
		await deploy();

		expect(said()).toContain(`No secrets found for stage "${STAGE}"`);
	});

	it('refuses a provider other than Dokploy', async () => {
		const { workspace: loaded } = await loadWorkspaceConfig(root);

		await expect(
			workspaceDeployCommand(loaded, {
				provider: 'docker',
				stage: STAGE,
			} as never),
		).rejects.toThrow(
			'Workspace deployment only supports Dokploy. Got: docker',
		);
	});

	describe('asking for Dokploy credentials at a terminal', () => {
		const stdin = process.stdin as NodeJS.ReadStream & {
			setRawMode?: (mode: boolean) => NodeJS.ReadStream;
		};
		const tty = stdin.isTTY;
		const rawMode = stdin.setRawMode;

		/**
		 * What the user types: a line at the first prompt, then keystrokes at the
		 * hidden one. Each is sent when its prompt is written — the prompt starts
		 * listening in the same tick it writes — rather than on a timer, which
		 * raced the prompt whenever the suite ran under load.
		 */
		let typed: ({ line: string } | { keys: string[] })[] = [];
		const answer = (line: string, keys: string[] = []) => {
			typed = [{ line }, { keys }];
		};

		beforeEach(() => {
			rmSync(join(home, '.gkm'), { recursive: true, force: true });
			typed = [];
			stdin.isTTY = true;
			stdin.setRawMode = vi.fn(() => stdin);
			vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
				// Every prompt `deploy` asks ends in ': '.
				if (String(chunk).endsWith(': ')) {
					const next = typed.shift();
					if (next) {
						setImmediate(() => {
							if ('line' in next) {
								stdin.emit('data', Buffer.from(`${next.line}\n`));
							} else {
								for (const key of next.keys) {
									stdin.emit('data', Buffer.from(key));
								}
							}
						});
					}
				}
				return true;
			});
		});

		afterEach(() => {
			stdin.isTTY = tty;
			stdin.setRawMode = rawMode;
			stdin.pause();
		});

		it('stores what was typed, then deploys with it', async () => {
			answer(`${ENDPOINT}/`, ['t', 'o', 'x', '\b', 'k', 'e', 'n', '\r']);

			const result = await deploy();

			expect(result.successCount).toBe(2);
			expect(said()).toContain('✓ Credentials saved');
			expect(
				JSON.parse(
					readFileSync(join(home, '.gkm', 'credentials.json'), 'utf8'),
				),
			).toMatchObject({ dokploy: { token: 'token', endpoint: ENDPOINT } });
		});

		it('refuses a URL it cannot parse', async () => {
			answer('dokploy dot test');

			await expect(deploy()).rejects.toThrow('Invalid URL format');
		});

		it('refuses a token Dokploy rejects, and stores nothing', async () => {
			server.use(
				http.get(
					`${ENDPOINT}/api/project.all`,
					() => new HttpResponse(null, { status: 401 }),
				),
			);
			answer(ENDPOINT, ['n', 'o', '\n']);

			await expect(deploy()).rejects.toThrow('Invalid credentials');
			expect(dokploy.projects).toEqual([]);
		});

		it('creates the configured registry from the credentials typed', async () => {
			await storeDokployCredentials('token', ENDPOINT);
			dokploy.registries = [];
			answer('acme-bot', ['p', 'a', 't', '\n']);

			const result = await deploy();

			expect(result.successCount).toBe(2);
			expect(dokploy.registries).toEqual([
				expect.objectContaining({
					registryName: 'Default Registry',
					registryUrl: 'ghcr.io/acme',
					username: 'acme-bot',
				}),
			]);
			expect(state().registryId).toBe(dokploy.registries[0]!.registryId);
		});

		it('exits on Ctrl+C at the token prompt', async () => {
			const exited = new Promise<unknown>((resolve) => {
				vi.spyOn(process, 'exit').mockImplementation((code) => {
					resolve(code);
					return undefined as never;
				});
			});
			answer(ENDPOINT, ['a', '\u0003']);

			void deploy().catch(() => {});

			expect(await exited).toBe(1);
		});
	});

	it('asks for Dokploy credentials when none are stored, and needs a terminal', async () => {
		rmSync(join(home, '.gkm'), { recursive: true, force: true });

		await expect(deploy()).rejects.toThrow('Interactive input required');
	});

	describe('on a server other workspaces deploy to', () => {
		const inNamespace = (namespace: string) => (ws: NormalizedWorkspace) => {
			ws.deploy.namespace = namespace;
		};
		/** Another checkout: the same config, none of this one's state. */
		const elsewhere = () =>
			rmSync(join(root, '.gkm'), { recursive: true, force: true });

		it('keeps two workspaces with one name in different namespaces apart', async () => {
			await deploy({ adjust: inNamespace('acme') });
			const acme = { ...state() };
			elsewhere();

			await deploy({ adjust: inNamespace('globex') });
			const globex = state();

			expect(dokploy.projects.map((p) => p.name)).toEqual([
				'acme-shop',
				'globex-shop',
			]);
			expect(globex.projectId).not.toBe(acme.projectId);
			expect(dokploy.projects.map((p) => p.description)).toEqual([
				expect.stringContaining('gkm:acme/shop'),
				expect.stringContaining('gkm:globex/shop'),
			]);

			// Their own images, never pushed over each other.
			expect(acme.images.api.ref).toBe('ghcr.io/acme/acme/shop-api:v1');
			expect(globex.images.api.ref).toBe('ghcr.io/acme/globex/shop-api:v1');
			expect(dokploy.images[acme.applications.api]).toBe(
				'ghcr.io/acme/acme/shop-api:v1',
			);
			expect(dokploy.images[globex.applications.api]).toBe(
				'ghcr.io/acme/globex/shop-api:v1',
			);

			// And their own applications, whose names are server-wide.
			const names = dokploy.projects.flatMap((p) =>
				p.environments.flatMap((e) => e.applications.map((a) => a.appName)),
			);
			expect(names).toEqual([
				'production-acme-shop-api',
				'production-acme-shop-web',
				'production-globex-shop-api',
				'production-globex-shop-web',
			]);
		});

		it('refuses a project with its name in another case that it did not create', async () => {
			dokploy.projects.push({
				projectId: 'proj_theirs',
				name: 'Shop',
				description: 'Their storefront',
				environments: [],
			});

			const error = await deploy().catch((e: unknown) => e);

			expect(error).toBeInstanceOf(ProjectNotOwned);
			expect(error).toMatchObject({
				projectName: 'Shop',
				projectId: 'proj_theirs',
				identity: 'shop/shop',
			});
			// Nothing of theirs touched, nothing of ours built.
			expect(dokploy.projects).toHaveLength(1);
			expect(dokploy.projects[0]!.description).toBe('Their storefront');
			expect(docker()).toEqual([]);
		});

		it('refuses a project another identity marked, even through its own state', async () => {
			await deploy({ adjust: inNamespace('acme') });

			// Same checkout, namespace changed: the state still names acme's.
			await expect(
				deploy({ adjust: inNamespace('globex') }),
			).rejects.toMatchObject({
				name: 'ProjectNotOwned',
				ownedBy: 'gkm:acme/shop',
			});
			expect(dokploy.projects).toHaveLength(1);
		});

		it('trusts the project a pre-identity state names, and claims it', async () => {
			// Deployed before identities: no marker, named by the raw workspace
			// name, and a v1 state file holding its id.
			dokploy.projects.push({
				projectId: 'proj_legacy',
				name: 'Shop',
				description: 'Created by gkm CLI',
				environments: [
					{
						environmentId: 'env_legacy',
						name: STAGE,
						applications: [
							{
								applicationId: 'app_legacy',
								name: 'production-shop-api',
								appName: 'production-shop-api',
							},
						],
						postgres: [],
					},
				],
			});
			mkdirSync(join(root, '.gkm'), { recursive: true });
			writeFileSync(
				join(root, '.gkm', `deploy-${STAGE}.json`),
				JSON.stringify({
					provider: 'dokploy',
					stage: STAGE,
					projectId: 'proj_legacy',
					environmentId: 'env_legacy',
					applications: { api: 'app_legacy' },
					services: {},
					lastDeployedAt: '2026-01-01T00:00:00.000Z',
				}),
			);

			await deploy();

			const [legacy] = dokploy.projects;
			expect(dokploy.projects).toHaveLength(1);
			expect(legacy!.description).toBe('Created by gkm CLI\ngkm:shop/shop');
			expect(said()).toContain('Claimed project Shop for shop/shop');
			expect(state()).toMatchObject({
				projectId: 'proj_legacy',
				environmentId: 'env_legacy',
				applications: { api: 'app_legacy' },
				identity: 'shop/shop',
			});
			// Migrated to v2 on the way, with the v1 file kept beside it and its
			// ids seeded as records, so the application is used by id.
			expect(document().schemaVersion).toBe(2);
			expect(existsSync(join(root, '.gkm', `deploy-${STAGE}.v1.json`))).toBe(
				true,
			);
			expect(resources()['application:api']).toMatchObject({
				status: 'ready',
				id: 'app_legacy',
			});
			expect(said()).toContain('Using cached ID: app_legacy');

			// Claimed, it is found by its marker once the state is gone.
			elsewhere();
			await deploy({ tag: 'v2' });

			expect(dokploy.projects).toHaveLength(1);
			expect(state().projectId).toBe('proj_legacy');
		});
	});

	describe('a run that dies part way', () => {
		/** Everything on the server, which a re-run must not have added to. */
		const inventory = () => ({
			projects: dokploy.projects.map((p) => p.name),
			environments: dokploy.projects.flatMap((p) =>
				p.environments.map((e) => `${p.name}/${e.name}`),
			),
			applications: dokploy.projects.flatMap((p) =>
				p.environments.flatMap((e) => e.applications.map((a) => a.name)),
			),
			domains: dokploy.domains.map((d) => d.host),
		});

		// A first deploy creates five things: the project (with the stage as
		// its first environment), then each app's application and domain.
		it.each([
			1, 2, 3, 4, 5,
		])('creates nothing twice when the run dies after create %i', async (fatal) => {
			dokploy.dieAfterCreate = fatal;
			await deploy().catch(() => {});
			dokploy.dieAfterCreate = undefined;

			const result = await deploy({ tag: 'v2' });

			expect(result).toMatchObject({ successCount: 2, failedCount: 0 });
			expect(inventory()).toEqual({
				projects: ['shop'],
				environments: [`shop/${STAGE}`],
				applications: ['production-shop-api', 'production-shop-web'],
				domains: ['api.shop.example.com', 'shop.example.com'],
			});
			// Across both runs, nothing was created twice.
			expect(new Set(dokploy.created).size).toBe(dokploy.created.length);
			// Everything it knows of is recorded, and nothing is left pending.
			expect(
				Object.values(resources()).map((r) => (r as { status: string }).status),
			).not.toContain('pending');
			expect(state().applications).toEqual({
				api: dokploy.projects[0]!.environments[0]!.applications[0]!
					.applicationId,
				web: dokploy.projects[0]!.environments[0]!.applications[1]!
					.applicationId,
			});
		});

		it('leaves a pending record that the next run resolves by looking it up', async () => {
			// Dies after Dokploy created the API's application.
			dokploy.dieAfterCreate = 2;
			await expect(deploy()).rejects.toThrow(
				'Backend deployment failed for api',
			);
			expect(resources()['application:api']).toMatchObject({
				type: 'application',
				status: 'pending',
				data: { name: 'production-shop-api' },
			});
			// The project it had finished is recorded with its id.
			expect(resources().project).toMatchObject({
				status: 'ready',
				id: dokploy.projects[0]!.projectId,
			});
			dokploy.dieAfterCreate = undefined;
			out.length = 0;

			await deploy({ tag: 'v2' });

			const [api] = dokploy.projects[0]!.environments[0]!.applications;
			expect(said()).toContain(
				'A previous run stopped while creating: application:api',
			);
			expect(said()).toContain(
				`Resumed application a stopped run created: ${api!.applicationId}`,
			);
			expect(resources()['application:api']).toMatchObject({
				status: 'ready',
				id: api!.applicationId,
			});
		});

		it('keeps the ids it created before it died', async () => {
			dokploy.dieAfterCreate = 4; // the site's application

			const result = await deploy();

			// A site failing does not abort, so the run ends and says so.
			expect(result).toMatchObject({ successCount: 1, failedCount: 1 });
			expect(state().applications.api).toBe(
				dokploy.projects[0]!.environments[0]!.applications[0]!.applicationId,
			);
			expect(state().images.api.ref).toBe('ghcr.io/acme/shop/shop-api:v1');
			expect(resources()['application:web'].status).toBe('pending');
		});
	});

	describe('the stage lock', () => {
		const lockFile = () => join(root, '.gkm', `deploy-${STAGE}.lock`);

		it('refuses to deploy a stage another run holds, and touches nothing', async () => {
			const store = new LocalStateStore(root);
			const held = await store.lock(STAGE, { operation: 'deploy' });

			const error = await deploy().catch((e: unknown) => e);

			expect(error).toBeInstanceOf(StateLocked);
			expect((error as StateLocked).holder?.id).toBe(held.holder.id);
			expect(dokploy.projects).toEqual([]);
			expect(docker()).toEqual([]);
			// Still the other run's.
			expect(existsSync(lockFile())).toBe(true);
			await held.release();
		});

		it('lets exactly one of two concurrent deploys of a stage run', async () => {
			const results = await Promise.allSettled([deploy(), deploy()]);

			const failed = results.filter((r) => r.status === 'rejected');
			expect(failed).toHaveLength(1);
			expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(
				StateLocked,
			);
			expect(dokploy.projects).toHaveLength(1);
		});

		it('releases the lock when the run ends, and when it fails', async () => {
			await deploy();
			expect(existsSync(lockFile())).toBe(false);

			vi.mocked(run).mockRejectedValue(new Error('no space'));
			await expect(deploy({ tag: 'v2' })).rejects.toThrow();
			expect(existsSync(lockFile())).toBe(false);
		});
	});

	describe('deployCommand', () => {
		it('deploys the workspace in the current directory', async () => {
			const result = await deployCommand({
				provider: 'dokploy',
				stage: STAGE,
				tag: 'v1',
			});

			expect(result).toMatchObject({ successCount: 2 });
		});

		it('refuses a stage the workspace does not deploy to', async () => {
			await expect(
				deployCommand({ provider: 'dokploy', stage: 'qa' }),
			).rejects.toThrow('"qa" is not a deployed stage');
			expect(dokploy.projects).toEqual([]);
		});
	});
});
