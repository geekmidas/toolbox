/**
 * `gkm deploy` of a whole workspace, against a stand-in Dokploy.
 *
 * The stand-in keeps state — projects, environments, applications, registries,
 * domains — so a second deploy meets what the first one created, the way a
 * real redeploy does. Docker is the one thing not run: `docker build` and
 * `docker push` go through `execSync`, which records the commands instead.
 * Everything else is real: the workspace on disk, the Dockerfile generation,
 * the deploy state file, the credentials under a temp HOME.
 */

import { execSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
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
import {
	getDokployRegistryId,
	storeDokployCredentials,
	storeDokployRegistryId,
} from '../../auth/credentials';
import { loadWorkspaceConfig } from '../../config';
import { FileSecretsStore } from '../../secrets/file';
import type { NormalizedWorkspace } from '../../workspace/types';
import { deployCommand, workspaceDeployCommand } from '../index';

vi.mock('node:child_process', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:child_process')>()),
	execSync: vi.fn(),
}));

// Local, so the server's address resolves without a network: DNS records
// point at it.
const ENDPOINT = 'http://localhost:3999';
const STAGE = 'production';

/** The Dokploy this deploy talks to, as data. */
interface Dokploy {
	projects: {
		projectId: string;
		name: string;
		environments: {
			environmentId: string;
			name: string;
			applications: {
				applicationId: string;
				name: string;
				appName: string;
			}[];
			postgres: Postgres[];
		}[];
	}[];
	registries: { registryId: string; registryName: string; username?: string }[];
	domains: { domainId: string; host: string; applicationId: string }[];
	env: Record<string, string>;
	images: Record<string, string>;
	deployed: string[];
	/** Hosts whose domain creation fails. */
	failDomains: string[];
	/** The environment name `project.create` makes, as Dokploy does. */
	defaultEnvironment: string;
	/** How `domain.validateDomain` answers, per host; unlisted hosts fail. */
	validity: Record<string, boolean>;
	/** Why publishing a port is refused. */
	portRefusal: (port: number) => string;
	/** Every external port a publish was attempted on, in order. */
	savedPorts: number[];
}

interface Postgres {
	postgresId: string;
	name: string;
	appName: string;
	databaseName: string;
	databaseUser: string;
	databasePassword: string;
	externalPort: number | null;
}

let dokploy: Dokploy;
let ids = 0;
const id = (prefix: string) => `${prefix}_${++ids}`;
const server = setupServer();

function serve() {
	const body = async (request: Request) =>
		(await request.json()) as Record<string, string>;
	const environments = () => dokploy.projects.flatMap((p) => p.environments);
	const postgres = (postgresId: string) =>
		environments()
			.flatMap((e) => e.postgres)
			.find((p) => p.postgresId === postgresId)!;
	const application = (applicationId: string) =>
		environments()
			.flatMap((e) => e.applications)
			.find((a) => a.applicationId === applicationId);

	server.use(
		http.get(`${ENDPOINT}/api/project.all`, () =>
			HttpResponse.json(
				dokploy.projects.map(({ projectId, name }) => ({ projectId, name })),
			),
		),
		http.get(`${ENDPOINT}/api/project.one`, ({ request }) => {
			const projectId = new URL(request.url).searchParams.get('projectId');
			return HttpResponse.json(
				dokploy.projects.find((p) => p.projectId === projectId),
			);
		}),
		http.post(`${ENDPOINT}/api/project.create`, async ({ request }) => {
			const { name } = await body(request);
			const environment = {
				environmentId: id('env'),
				name: dokploy.defaultEnvironment,
				applications: [],
				postgres: [],
			};
			const project = {
				projectId: id('proj'),
				name: name!,
				environments: [environment],
			};
			dokploy.projects.push(project);
			return HttpResponse.json({ project, environment });
		}),
		http.post(`${ENDPOINT}/api/environment.create`, async ({ request }) => {
			const { projectId, name } = await body(request);
			const environment = {
				environmentId: id('env'),
				name: name!,
				applications: [],
				postgres: [],
			};
			dokploy.projects
				.find((p) => p.projectId === projectId)!
				.environments.push(environment);
			return HttpResponse.json(environment);
		}),
		http.get(`${ENDPOINT}/api/registry.all`, () =>
			HttpResponse.json(dokploy.registries),
		),
		http.post(`${ENDPOINT}/api/registry.create`, async ({ request }) => {
			const { registryName, username } = await body(request);
			const created = {
				registryId: id('reg'),
				registryName: registryName!,
				username: username!,
			};
			dokploy.registries.push(created);
			return HttpResponse.json(created);
		}),
		http.get(`${ENDPOINT}/api/registry.one`, ({ request }) => {
			const registryId = new URL(request.url).searchParams.get('registryId');
			const found = dokploy.registries.find((r) => r.registryId === registryId);
			return found
				? HttpResponse.json(found)
				: HttpResponse.json({ message: 'Registry not found' }, { status: 404 });
		}),
		http.post(`${ENDPOINT}/api/application.create`, async ({ request }) => {
			const { name, environmentId, appName } = await body(request);
			const created = {
				applicationId: id('app'),
				name: name!,
				appName: appName!,
			};
			environments()
				.find((e) => e.environmentId === environmentId)!
				.applications.push(created);
			return HttpResponse.json(created);
		}),
		http.get(`${ENDPOINT}/api/application.one`, ({ request }) => {
			const found = application(
				new URL(request.url).searchParams.get('applicationId')!,
			);
			return found
				? HttpResponse.json(found)
				: HttpResponse.json({ message: 'Not found' }, { status: 404 });
		}),
		http.post(
			`${ENDPOINT}/api/application.saveDockerProvider`,
			async ({ request }) => {
				const { applicationId, dockerImage } = await body(request);
				dokploy.images[applicationId!] = dockerImage!;
				return HttpResponse.json({});
			},
		),
		http.post(
			`${ENDPOINT}/api/application.saveEnvironment`,
			async ({ request }) => {
				const { applicationId, env } = await body(request);
				dokploy.env[applicationId!] = env!;
				return HttpResponse.json({});
			},
		),
		http.post(`${ENDPOINT}/api/application.deploy`, async ({ request }) => {
			dokploy.deployed.push((await body(request)).applicationId!);
			return HttpResponse.json({});
		}),
		http.get(`${ENDPOINT}/api/domain.byApplicationId`, ({ request }) => {
			const applicationId = new URL(request.url).searchParams.get(
				'applicationId',
			);
			return HttpResponse.json(
				dokploy.domains.filter((d) => d.applicationId === applicationId),
			);
		}),
		http.post(`${ENDPOINT}/api/domain.create`, async ({ request }) => {
			const { host, applicationId } = await body(request);
			if (dokploy.failDomains.includes(host!)) {
				return HttpResponse.json(
					{ message: 'Domain already in use' },
					{ status: 409 },
				);
			}
			const domain = {
				domainId: id('dom'),
				host: host!,
				applicationId: applicationId!,
			};
			dokploy.domains.push(domain);
			return HttpResponse.json(domain);
		}),
		http.post(`${ENDPOINT}/api/domain.validateDomain`, async ({ request }) => {
			const { domain } = await body(request);
			const isValid = dokploy.validity[domain!];
			return isValid === undefined
				? HttpResponse.json({ message: 'Traefik unreachable' }, { status: 502 })
				: HttpResponse.json({ isValid, resolvedIp: '127.0.0.1' });
		}),
		http.post(`${ENDPOINT}/api/postgres.create`, async ({ request }) => {
			const { name, appName, databaseName, environmentId } =
				await body(request);
			// Unpublished, as Dokploy creates one.
			const created = {
				postgresId: id('pg'),
				name: name!,
				appName: appName!,
				databaseName: databaseName!,
				databaseUser: 'postgres',
				databasePassword: 'master',
				externalPort: null,
			};
			environments()
				.find((e) => e.environmentId === environmentId)!
				.postgres.push(created);
			return HttpResponse.json(created);
		}),
		http.get(`${ENDPOINT}/api/postgres.one`, ({ request }) =>
			HttpResponse.json(
				postgres(new URL(request.url).searchParams.get('postgresId')!),
			),
		),
		http.post(
			`${ENDPOINT}/api/postgres.saveExternalPort`,
			async ({ request }) => {
				const { externalPort } = (await request.json()) as {
					externalPort: number;
				};
				dokploy.savedPorts.push(externalPort);
				return HttpResponse.json(
					{ message: dokploy.portRefusal(externalPort) },
					{ status: 400 },
				);
			},
		),
	);
}

/** Every `docker …` command the deploy ran, in order. */
const docker = () =>
	vi.mocked(execSync).mock.calls.map(([command]) => String(command));

describe('workspaceDeployCommand', () => {
	let root: string;
	let home: string;
	let cwd: string;
	let out: string[];

	/** A workspace with an API, a Next.js site that calls it, and an Expo app. */
	function workspace(extra: { registry?: string | false; apps?: string } = {}) {
		const registry =
			extra.registry === false
				? ''
				: `registry: '${extra.registry ?? 'ghcr.io/acme'}',`;
		writeFileSync(
			join(root, 'package.json'),
			JSON.stringify({ name: 'shop', private: true, type: 'module' }),
		);
		writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
		for (const app of ['api', 'web', 'app']) {
			mkdirSync(join(root, 'apps', app), { recursive: true });
			writeFileSync(
				join(root, 'apps', app, 'package.json'),
				// ES modules, as every scaffold is: the sniffer swaps envkit in
				// through an import hook, which a CommonJS require never meets.
				JSON.stringify({ name: `@shop/${app}`, type: 'module' }),
			);
		}
		writeFileSync(
			join(root, 'gkm.config.ts'),
			`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  constructs: './src/constructs/**/*.ts',
  stages: { local: 'dev', deployed: ['${STAGE}', 'staging'] },
  apps: ${
		extra.apps ??
		`{
    api: { type: 'backend', path: 'apps/api', port: 3000 },
    web: {
      type: 'web',
      path: 'apps/web',
      port: 3001,
      framework: 'nextjs',
      dependencies: ['api'],
    },
    app: { type: 'mobile', path: 'apps/app', port: 8081, framework: 'expo' },
  }`
	},
  deploy: {
    default: 'dokploy',
    dokploy: {
      endpoint: '${ENDPOINT}',
      ${registry}
      domains: { ${STAGE}: 'shop.example.com', staging: 'staging.shop.example.com' },
    },
  },
});
`,
		);
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

	const state = (stage = STAGE) =>
		JSON.parse(
			readFileSync(join(root, '.gkm', `deploy-${stage}.json`), 'utf8'),
		);

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
		dokploy = {
			projects: [],
			registries: [{ registryId: 'reg_1', registryName: 'GHCR' }],
			domains: [],
			env: {},
			images: {},
			deployed: [],
			failDomains: [],
			defaultEnvironment: STAGE,
			portRefusal: (port) => `Port ${port} is already in use`,
			validity: {},
			savedPorts: [],
		};
		serve();
		out = [];
		vi.spyOn(console, 'log').mockImplementation((...a) => {
			out.push(a.join(' '));
		});
		vi.spyOn(console, 'warn').mockImplementation((...a) => {
			out.push(`WARN ${a.join(' ')}`);
		});
		vi.mocked(execSync).mockReset();
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
			expect.stringContaining('-t ghcr.io/acme/shop-api:v1'),
			'docker push ghcr.io/acme/shop-api:v1',
			expect.stringContaining('-t ghcr.io/acme/shop-web:v1'),
			'docker push ghcr.io/acme/shop-web:v1',
		]);
		expect(docker()[0]).toContain('--platform linux/amd64');

		// The site's build knows where the API answers, before it is built.
		expect(docker()[2]).toContain(
			'--build-arg "NEXT_PUBLIC_API_URL=https://api.shop.example.com"',
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
		});
		// The mobile app ships through its own toolchain.
		expect(said()).toContain('Skipping 1 mobile app(s)');
		// The registry Dokploy already had is remembered for the next deploy.
		expect(await getDokployRegistryId()).toBe('reg_1');
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
		expect(dokploy.images[applications.api]).toBe('ghcr.io/acme/shop-api:v2');
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

	it('forgets a stored registry Dokploy no longer has', async () => {
		await storeDokployRegistryId('reg_gone');

		await deploy();

		expect(said()).toContain('Stored registry not found, clearing...');
		expect(await getDokployRegistryId()).toBe('reg_1');
	});

	it('deploys without a registry when none exists or is configured', async () => {
		dokploy.registries = [];
		workspace({ registry: false });

		const result = await deploy();

		expect(result.successCount).toBe(2);
		expect(said()).toContain('No registry configured');
		// Nothing to push to.
		expect(docker().some((c) => c.startsWith('docker push'))).toBe(false);
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
		vi.mocked(execSync).mockImplementation((command) => {
			if (String(command).includes('shop-api')) throw new Error('no space');
			return Buffer.from('');
		});

		await expect(deploy()).rejects.toThrow(
			'Backend deployment failed for api. Aborting to prevent partial deployment.',
		);
		expect(docker().some((c) => c.includes('shop-web'))).toBe(false);
	});

	it('reports a site that fails and still saves state', async () => {
		vi.mocked(execSync).mockImplementation((command) => {
			if (String(command).includes('shop-web')) throw new Error('OOM');
			return Buffer.from('');
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

			const result = await deploy();

			expect(result.successCount).toBe(1);
			expect(said()).toContain('Encrypted secrets for: api');
			expect(docker()[0]).toContain('--build-arg "GKM_ENCRYPTED_CREDENTIALS=');
			expect(docker()[0]).toContain('--build-arg "GKM_CREDENTIALS_IV=');
			// The plaintext never reaches the build command.
			expect(docker()[0]).not.toContain('sk_live_x');
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
					username: 'acme-bot',
				}),
			]);
			expect(await getDokployRegistryId()).toBe(
				dokploy.registries[0]!.registryId,
			);
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
