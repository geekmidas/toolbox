import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { migrationTargets } from '@geekmidas/manifest';
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
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { loadWorkspaceSettings } from '../../config';
import {
	ExternalServicesNotConfigured,
	UnknownDevService,
} from '../../deploy/devServices';
import { SeedFailed } from '../../migrate/databases';
import type { SqlClient } from '../../reconcile/provision';
import { CredentialsInvalid } from '../../secrets/credentialSchemas';
import { FileSecretsStore } from '../../secrets/file';
import { secretsInitCommand, secretsSetCommand } from '../../secrets/index';
import { keystoreProject } from '../../secrets/keystore';
import { StaleStageSecrets } from '../../secrets/stale';
import { initStageSecrets } from '../../secrets/storage';
import { ensureStageSecrets } from '../../setup/index';
import { DeploySeedsFailed } from '../../target/seeds';
import {
	ComposeModeConflict,
	ComposePinNeedsPull,
	ComposePushNeedsBuild,
	composeCommand,
	ImageDigestMismatch,
	ImageDigestMissing,
	ImageTagNotFound,
	RedisClientMissing,
	RegistryRequired,
} from '../index';
import { writeComposeApp } from './__helpers__/composeApp';
import { answering, fakeDigest, fakeDocker } from './__helpers__/fakeDocker';

/** No Postgres is running here: its login is taken as the one it was given. */
const signedIn: NonNullable<Parameters<typeof composeCommand>[1]>['logins'] =
	async ({ login }) => ({ service: 'postgres', status: 'current', login });

/**
 * `gkm compose` with Docker, the registry, Postgres and the
 * health probe replaced by recorders — everything else real: the command runs
 * the compose target through `deploy()`, the workspace is loaded (in its
 * sandbox) and discovered, the stage's secrets and state are its real stores,
 * and the files are written where the command writes them.
 *
 * Each run loads the config in a child process, so the runs get the time a
 * child needs to start.
 */

const RUN_TIMEOUT = 60_000;

let dir: string;

async function project(): Promise<string> {
	const root = realpathSync(await createTempDir('gkm-compose-command-'));
	writeComposeApp(root, { registry: 'registry.example.com/acme' });
	return root;
}

beforeEach(() => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('gkm compose --tag', { timeout: RUN_TIMEOUT }, () => {
	beforeEach(async () => {
		dir = await project();
	});
	afterEach(async () => {
		await cleanupDir(dir);
	});

	it('asks the registry for every image and starts nothing when any is missing', async () => {
		const refs = {
			api: 'registry.example.com/acme/compose-app/compose-app-api:v1.4.0',
			auth: 'registry.example.com/acme/compose-app/compose-app-auth:v1.4.0',
			jobs: 'registry.example.com/acme/compose-app/compose-app-jobs:v1.4.0',
			web: 'registry.example.com/acme/compose-app/compose-app-web:v1.4.0-production',
		};
		const { docker, ops } = fakeDocker({ registry: [refs.api] });

		const error = await composeCommand(
			{ cwd: dir, stage: 'production', tag: 'v1.4.0' },
			{ docker },
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ImageTagNotFound);
		expect((error as ImageTagNotFound).refs.sort()).toEqual(
			[refs.auth, refs.jobs, refs.web].sort(),
		);
		// Asked, and nothing more: no pull, no build, no container touched.
		expect(new Set(ops())).toEqual(new Set(['lookup']));
		// The worker's image is a release's too.
		expect(ops()).toHaveLength(4);
		// Nor a file written, nor the stage's secrets generated.
		expect(existsSync(join(dir, '.gkm', 'compose'))).toBe(false);
		expect(existsSync(join(dir, '.gkm', 'secrets', 'production.json'))).toBe(
			false,
		);
	});

	it('pulls the tag and builds nothing when every image is there', async () => {
		const { docker, ops } = fakeDocker({
			registry: [
				'registry.example.com/acme/compose-app/compose-app-api:v1.4.0',
				'registry.example.com/acme/compose-app/compose-app-auth:v1.4.0',
				'registry.example.com/acme/compose-app/compose-app-jobs:v1.4.0',
				'registry.example.com/acme/compose-app/compose-app-web:v1.4.0-production',
			],
		});
		const migrate = vi.fn(async () => []);
		const sql = () => ({ query: async () => [] }) satisfies SqlClient;

		const result = await composeCommand(
			{ cwd: dir, stage: 'production', tag: 'v1.4.0' },
			{
				docker,
				sql,
				logins: signedIn,
				migrate,
				seed: async () => [],
				revision: vi.fn(),
				probe: async () => 200,
			},
		);

		expect(ops()).toContain('pull');
		expect(ops()).not.toContain('build');
		expect(result?.images?.web?.tag).toBe('v1.4.0-production');
	});
});

describe(
	'gkm compose, building from this checkout',
	{
		timeout: RUN_TIMEOUT,
	},
	() => {
		// One run, asserted from every side: it is the slow part.
		let ran: Awaited<ReturnType<typeof run>>;

		beforeAll(async () => {
			dir = await project();
			vi.spyOn(console, 'log').mockImplementation(() => {});
			ran = await run();
		}, RUN_TIMEOUT);

		afterAll(async () => {
			await cleanupDir(dir);
		});

		async function run() {
			const fake = fakeDocker();
			const statements: string[] = [];
			const migrations: { env: Record<string, string | undefined> }[] = [];
			const seeds: {
				env: Record<string, string | undefined>;
				stage: string;
			}[] = [];
			const result = await composeCommand(
				{ cwd: dir, stage: 'development' },
				{
					docker: fake.docker,
					probe: answering(fake.calls),
					revision: async () => 'abc1234',
					logins: signedIn,

					sql: (port, login) => ({
						async query(_database, sql) {
							statements.push(sql);
							fake.calls.push({ op: 'sql', args: [port, login.user] });
							return [];
						},
					}),
					migrate: async (options) => {
						fake.calls.push({ op: 'migrate' });
						migrations.push(options);
						return [];
					},
					seed: async (options) => {
						fake.calls.push({ op: 'seed' });
						seeds.push(options);
						const target = migrationTargets(options.manifest).find(
							(t) => t.id === 'Database',
						)!;
						return [{ target, seeded: ['001_welcome_note'] }];
					},
				},
			);
			const lines = vi
				.mocked(console.log)
				.mock.calls.map((call) => String(call[0]));
			return { ...fake, statements, migrations, seeds, lines, result };
		}

		it('creates the databases and migrates before any app starts', async () => {
			const { ops, calls } = ran;
			const sequence = ops().filter((op, i, all) => op !== all[i - 1]);

			// provision → build → release → verify
			expect(sequence).toEqual([
				'up',
				'port',
				'sql',
				'migrate',
				'seed',
				'build',
				'up',
				'copyOut',
				'probe',
				// The worker has no route: Docker's health check is asked.
				'health',
			]);
			expect(
				calls.filter((call) => call.op === 'up').map((c) => c.args),
			).toEqual([['postgres', 'redis'], 'all']);
		});

		it('builds every image inside Docker, and nothing on this machine first', async () => {
			const stack = join(dir, '.gkm', 'compose', 'development');
			const api = readFileSync(join(stack, 'Dockerfile.api'), 'utf-8');
			const web = readFileSync(join(stack, 'Dockerfile.web'), 'utf-8');

			// The backend is bundled by gkm build in the image, from a pruned
			// slice — the same template `gkm docker` writes.
			expect(api).toContain('prune @compose-app/api --docker');
			expect(api).toContain(
				'node "$GKM_BIN" build --provider server --production',
			);
			expect(web).toContain("run build --filter='@compose-app/web'");
			// No backend was bundled here, so there is no bundle to copy in.
			expect(existsSync(join(dir, 'apps', 'api', '.gkm', 'server'))).toBe(
				false,
			);
		});

		it("builds each backend with nothing of the stage's in it: its env file is read at runtime", async () => {
			const stack = join(dir, '.gkm', 'compose', 'development');
			const compose = readFileSync(join(stack, 'docker-compose.yml'), 'utf-8');

			expect(compose).not.toContain('gkm_credentials');
			expect(compose).not.toContain('GKM_CIPHERTEXT_HASH');
			expect(compose).not.toMatch(/^secrets:/m);
			expect(
				readdirSync(stack).filter((file) => file.endsWith('.credentials')),
			).toEqual([]);
			// Every secret the API reads is in its env file, and no key to
			// decrypt anything is.
			const env = readFileSync(join(stack, 'api.env'), 'utf-8');
			expect(env).toMatch(/^DATABASE_URL=postgres:\/\//m);
			expect(env).not.toContain('GKM_MASTER_KEY');
		});

		it('creates the roles with the master credential on the published port', async () => {
			const { calls, statements } = ran;

			// This machine's generated superuser — the one `gkm dev` uses.
			const [port, user] = calls.find((call) => call.op === 'sql')?.args as [
				number,
				string,
			];
			expect(port).toBe(55432);
			expect(user).toMatch(/_admin$/);
			expect(statements.join('\n')).toMatch(/CREATE DATABASE "database"/);
			expect(statements.join('\n')).toMatch(/CREATE ROLE "authdatabase"/);
		});

		it("migrates with the owner's URL on the published port", async () => {
			const [options] = ran.migrations;

			expect(options?.env.AUTH_DATABASE_OWNER_URL).toMatch(
				/^postgres:\/\/authdatabase_owner:[^@]+@localhost:55432\/database$/,
			);
		});

		it("seeds the stage after migrating, as the owner, with the migrations' URLs", () => {
			const [options] = ran.seeds;

			expect(options?.stage).toBe('development');
			expect(options?.env).toEqual(ran.migrations[0]?.env);
		});

		it('says what it seeded', () => {
			expect(ran.lines).toContain('🌱 db/database/seeds: ran 1');
			expect(ran.lines).toContain('   ✓ 001_welcome_note');
		});

		it('writes the env files for their owner alone', async () => {
			const stack = join(dir, '.gkm', 'compose', 'development');

			expect(statSync(stack).mode & 0o777).toBe(0o700);
			expect(statSync(join(stack, 'api.env')).mode & 0o777).toBe(0o600);
			expect(statSync(join(stack, 'auth.env')).mode & 0o777).toBe(0o600);
			// A site reads nothing at runtime, so it has no file.
			expect(existsSync(join(stack, 'web.env'))).toBe(false);
			expect(readFileSync(join(stack, 'auth.env'), 'utf-8')).toMatch(
				/^AUTH_URL=https:\/\/auth\.compose-app\.localhost$/m,
			);
		});

		it('keeps the stacks out of every image build context', async () => {
			expect(readFileSync(join(dir, '.dockerignore'), 'utf-8')).toMatch(
				/^\*\*\/\.gkm\/compose$/m,
			);
		});

		it("records each app's tag and what it resolved to in the stage's state", async () => {
			const { result } = ran;
			const { state } = JSON.parse(
				readFileSync(join(dir, '.gkm', 'deploy-development.json'), 'utf-8'),
			);

			expect(state.releases.api.current).toMatchObject({
				ref: 'registry.example.com/acme/compose-app/compose-app-api:abc1234',
				tag: 'abc1234',
				digest: result?.images?.api?.digest,
			});
			expect(state.releases.web.current.tag).toBe('abc1234-development');
			expect(state.identity).toBe(result?.deploy.identity);
		});

		it('asks each app through the edge: an API at /health, a site at /', () => {
			const asked = ran.calls
				.filter((call) => call.op === 'probe')
				.map((call) => call.args);

			expect(asked.sort()).toEqual([
				'https://api.compose-app.localhost/health',
				'https://auth.compose-app.localhost/health',
				'https://compose-app.localhost/',
			]);
		});
	},
);

describe('a failing seed', { timeout: RUN_TIMEOUT }, () => {
	beforeEach(async () => {
		dir = await project();
	});
	afterEach(async () => {
		await cleanupDir(dir);
	});

	it('stops the run after the migrations, naming the construct and the seed, and starts no app', async () => {
		const fake = fakeDocker();
		const cause = new Error('relation "roles" does not exist');

		const error = await composeCommand(
			{ cwd: dir, stage: 'development' },
			{
				docker: fake.docker,
				probe: answering(fake.calls),
				revision: async () => 'abc1234',
				logins: signedIn,

				sql: () => ({ query: async () => [] }),
				migrate: async () => {
					fake.calls.push({ op: 'migrate' });
					return [];
				},
				seed: async () => {
					fake.calls.push({ op: 'seed' });
					throw new SeedFailed('Database', '001_welcome_note', cause);
				},
			},
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(DeploySeedsFailed);
		expect(error).toMatchObject({
			stage: 'development',
			construct: 'Database',
			seed: '001_welcome_note',
		});
		expect((error as DeploySeedsFailed).cause).toBeInstanceOf(SeedFailed);
		expect((error as Error).message).toContain(cause.message);

		// Postgres alone came up; nothing was built, and no app started.
		expect(fake.ops()).toEqual(['up', 'port', 'migrate', 'seed']);
		expect(
			fake.calls.filter((call) => call.op === 'up').map((c) => c.args),
		).toEqual([['postgres', 'redis']]);
		expect(existsSync(join(dir, '.gkm', 'deploy-development.json'))).toBe(
			false,
		);
	});
});

describe('gkm compose --dry-run', { timeout: RUN_TIMEOUT }, () => {
	beforeEach(async () => {
		dir = await project();
	});
	afterEach(async () => {
		await cleanupDir(dir);
	});

	it('writes the files and touches nothing else', async () => {
		const { docker, ops } = fakeDocker();

		const result = await composeCommand(
			{ cwd: dir, stage: 'development', dryRun: true },
			{ docker, revision: async () => 'abc1234' },
		);

		expect(ops()).toEqual([]);
		expect(result?.files.map((file) => file.slice(dir.length + 1))).toEqual(
			expect.arrayContaining([
				'.gkm/compose/development/docker-compose.yml',
				'.gkm/compose/development/Caddyfile',
				'.gkm/compose/development/api.env',
				'.gkm/compose/development/auth.env',
				'.gkm/compose/development/Dockerfile.web',
			]),
		);
		expect(existsSync(join(dir, '.gkm', 'deploy-development.json'))).toBe(
			false,
		);
	});

	it('lists the seeds a release would run, and runs none', async () => {
		const { docker } = fakeDocker();
		const seed = vi.fn();

		await composeCommand(
			{ cwd: dir, stage: 'development', dryRun: true },
			{ docker, seed, revision: async () => 'abc1234' },
		);

		const lines = vi
			.mocked(console.log)
			.mock.calls.map((call) => String(call[0]));
		expect(lines).toContain(
			'🌱 db/database/seeds: would run 1 (001_welcome_note)',
		);
		expect(seed).not.toHaveBeenCalled();
	});
});

/**
 * Whether Docker leaves `path` (relative to the context) out of a build,
 * by the `**`, `*` and plain patterns gkm writes: a path is out when it, or a
 * directory above it, matches.
 */
function dockerIgnores(ignore: string, path: string): boolean {
	const patterns = ignore
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
		.map(
			(pattern) =>
				new RegExp(
					`^${pattern
						.replace(/[.+^${}()|[\]\\]/g, '\\$&')
						.replace(/\*\*\//g, '\0')
						.replace(/\*/g, '[^/]*')
						.replace(/\0/g, '(?:.*/)?')}$`,
				),
		);
	const parts = path.split('/');
	return parts.some((_, i) => {
		const prefix = parts.slice(0, i + 1).join('/');
		return patterns.some((pattern) => pattern.test(prefix));
	});
}

describe('a workspace nested in a monorepo', { timeout: RUN_TIMEOUT }, () => {
	let root: string;

	beforeEach(async () => {
		root = realpathSync(await createTempDir('gkm-compose-nested-'));
		writeFileSync(
			join(root, 'package.json'),
			JSON.stringify({ name: 'monorepo', private: true }),
		);
		writeFileSync(
			join(root, 'pnpm-workspace.yaml'),
			'packages:\n  - examples/*\n  - examples/shop/apps/*\n',
		);
		writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
		writeFileSync(join(root, 'turbo.json'), '{}');
		// The project's own ignore file, which says nothing of gkm's stacks.
		writeFileSync(join(root, '.dockerignore'), 'coverage\n');

		dir = join(root, 'examples', 'shop');
		mkdirSync(dir, { recursive: true });
		writeComposeApp(dir);
		// Its packages are the monorepo's: one install, at the root.
		rmSync(join(dir, 'pnpm-workspace.yaml'));
	});
	afterEach(async () => {
		await cleanupDir(root);
	});

	it("builds from the monorepo's root, and keeps the stack's env files out of its context", async () => {
		const { docker } = fakeDocker();

		await composeCommand(
			{ cwd: dir, stage: 'development', dryRun: true },
			{ docker, revision: async () => 'abc1234' },
		);

		const stack = join(dir, '.gkm', 'compose', 'development');
		const compose = readFileSync(join(stack, 'docker-compose.yml'), 'utf-8');
		expect(compose).toContain('context: ../../../../..');
		expect(compose).toContain(
			'dockerfile: examples/shop/.gkm/compose/development/Dockerfile.api',
		);
		expect(readFileSync(join(stack, 'Dockerfile.api'), 'utf-8')).toContain(
			'cd /app/examples/shop/apps/api && GKM_BIN=',
		);

		// The build root's ignore file is the one that applies, and it now
		// leaves out every stack's env files.
		const ignore = readFileSync(join(root, '.dockerignore'), 'utf-8');
		expect(ignore.startsWith('coverage\n')).toBe(true);
		for (const file of ['api.env', 'auth.env']) {
			expect(existsSync(join(stack, file))).toBe(true);
			expect(
				dockerIgnores(ignore, `examples/shop/.gkm/compose/development/${file}`),
			).toBe(true);
		}
		// What the image is built from is not.
		expect(dockerIgnores(ignore, 'examples/shop/apps/api/package.json')).toBe(
			false,
		);
		expect(existsSync(join(dir, '.dockerignore'))).toBe(false);
	});
});

/** The API with an endpoint that sends mail and writes to a bucket. */
function withMailAndStorage(root: string): void {
	writeFileSync(
		join(root, 'constructs', 'storage.ts'),
		`import { Email } from '@geekmidas/constructs/email';
import { ObjectStorage } from '@geekmidas/constructs/object-storage';

export const uploads = new ObjectStorage('Uploads');
export const mail = new Email('Mail', { templates: {} });
`,
	);
	writeFileSync(
		join(root, 'apps', 'api', 'endpoints', 'upload.ts'),
		`import { api } from '../../../constructs/api.js';
import { mail, uploads } from '../../../constructs/storage.js';

export const upload = api
	.post('/upload')
	.dependsOn([uploads, mail])
	.handle(async () => ({ ok: true }));
`,
	);
}

/** A bucket client that records what it was asked to create, and with what. */
function recordingBuckets(calls: { op: string; args?: unknown }[]) {
	return (port: number, credentials?: { user: string; password: string }) => {
		calls.push({ op: 'buckets', args: [port, credentials?.user] });
		return {
			async exists() {
				return false;
			},
			async create(bucket: string) {
				calls.push({ op: 'bucket', args: bucket });
			},
			async policy() {
				return undefined;
			},
			async setPolicy() {},
		};
	};
}

describe('mail and storage', { timeout: RUN_TIMEOUT }, () => {
	beforeEach(async () => {
		dir = await project();
		withMailAndStorage(dir);
	});
	afterEach(async () => {
		await cleanupDir(dir);
	});

	it('runs MinIO and Mailpit on the local stage with no secret, creating the bucket before any app starts', async () => {
		const fake = fakeDocker();

		const result = await composeCommand(
			{ cwd: dir, stage: 'development' },
			{
				docker: fake.docker,
				probe: answering(fake.calls),
				revision: async () => 'abc1234',
				logins: signedIn,

				sql: () => ({ query: async () => [] }),
				migrate: async () => [],
				seed: async () => [],
				buckets: recordingBuckets(fake.calls),
			},
		);

		expect(result?.stack.infra).toEqual([
			'mailpit',
			'minio',
			'postgres',
			'redis',
		]);
		const ops = fake.calls.map((call) =>
			call.op === 'up' || call.op === 'bucket' || call.op === 'buckets'
				? `${call.op} ${JSON.stringify(call.args)}`
				: call.op,
		);
		expect(ops.indexOf('bucket "uploads"')).toBeGreaterThan(
			ops.indexOf('up ["mailpit","minio","postgres"]'),
		);
		expect(ops.indexOf('bucket "uploads"')).toBeLessThan(
			ops.indexOf('up "all"'),
		);
		expect(ops).toContain('buckets [55432,"minio"]');
		const env = readFileSync(
			join(dir, '.gkm', 'compose', 'development', 'api.env'),
			'utf-8',
		);
		expect(env).toContain(
			'UPLOADS_URL=s3://uploads?region=us-east-1&endpoint=http://minio:9000&forcePathStyle=true',
		);
		expect(env).toContain('MAIL_URL=smtp://mailpit:1025');
	});

	it('refuses a deployed stage with neither configured, naming every key, and writes nothing', async () => {
		const fake = fakeDocker();

		const run = composeCommand(
			{ cwd: dir, stage: 'production' },
			{ docker: fake.docker, revision: async () => 'abc1234' },
		);

		await expect(run).rejects.toBeInstanceOf(ExternalServicesNotConfigured);
		await expect(run).rejects.toThrow(
			/MAIL_URL[\s\S]*MAIL_FROM[\s\S]*UPLOADS_URL/,
		);
		expect(fake.ops()).toEqual([]);
		expect(existsSync(join(dir, '.gkm', 'compose', 'production'))).toBe(false);
		expect(existsSync(join(dir, '.gkm', 'secrets', 'production.json'))).toBe(
			false,
		);
	});

	it('runs both on a deployed stage with --allow-dev-services, warning loudly', async () => {
		const warned: string[] = [];
		vi.spyOn(console, 'warn').mockImplementation((...a) => {
			warned.push(a.join(' '));
		});
		const fake = fakeDocker();

		const result = await composeCommand(
			{ cwd: dir, stage: 'production', allowDevServices: 'minio,mailpit' },
			{
				docker: fake.docker,
				probe: answering(fake.calls),
				revision: async () => 'abc1234',
				logins: signedIn,

				sql: () => ({ query: async () => [] }),
				migrate: async () => [],
				seed: async () => [],
				buckets: recordingBuckets(fake.calls),
			},
		);

		expect(result?.stack.infra).toEqual([
			'mailpit',
			'minio',
			'postgres',
			'redis',
		]);
		expect(fake.calls).toContainEqual({
			op: 'buckets',
			args: [55432, 'compose-app-minio'],
		});
		expect(fake.calls).toContainEqual({
			op: 'bucket',
			args: 'uploads-production',
		});
		expect(warned.join('\n')).toMatch(
			/DEV SERVICE ON A DEPLOYED STAGE \(production\): Mailpit[\s\S]*delivers NO mail/,
		);
		expect(warned.join('\n')).toMatch(
			/DEV SERVICE ON A DEPLOYED STAGE \(production\): MinIO/,
		);
		expect(result?.deploy.stage).toBe('production');
	});

	it('refuses a value that is not a dev service', async () => {
		await expect(
			composeCommand({
				cwd: dir,
				stage: 'production',
				allowDevServices: 'minio,redis',
			}),
		).rejects.toBeInstanceOf(UnknownDevService);
	});
});

describe("a stage's third-party credentials", { timeout: RUN_TIMEOUT }, () => {
	let home: string;

	beforeEach(async () => {
		dir = await project();
		home = realpathSync(await createTempDir('gkm-compose-home-'));
		vi.stubEnv('GKM_HOME', home);
		writeFileSync(
			join(dir, 'constructs', 'shipping.ts'),
			`import { ExternalApi } from '@geekmidas/constructs/external-api';
import { z } from 'zod';

export const shipping = new ExternalApi('Shipping', {
  url: 'https://api.carrier.example',
  credentials: z.object({ apiKey: z.string() }),
  client: () => ({}),
});
`,
		);
	});
	afterEach(async () => {
		vi.unstubAllEnvs();
		await cleanupDir(dir);
		await cleanupDir(home);
	});

	it("refuses a stored value its construct's schema refuses, before anything is built", async () => {
		await new FileSecretsStore(
			dir,
			keystoreProject(await loadWorkspaceSettings(dir), home),
		).write('production', {
			...initStageSecrets('production'),
			custom: { SHIPPING_CREDENTIALS: '{"apikey":"wrong-field-value"}' },
		});
		const fake = fakeDocker();

		const error = await composeCommand(
			{ cwd: dir, stage: 'production' },
			{ docker: fake.docker, revision: async () => 'abc1234' },
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(CredentialsInvalid);
		expect((error as CredentialsInvalid).invalid).toEqual([
			{
				key: 'SHIPPING_CREDENTIALS',
				issues: [
					{
						path: 'apiKey',
						message: 'Invalid input: expected string, received undefined',
					},
				],
			},
		]);
		expect((error as Error).message).toContain(
			'SHIPPING_CREDENTIALS.apiKey: Invalid input',
		);
		expect((error as Error).message).not.toContain('wrong-field-value');
		expect(fake.ops()).toEqual([]);
		expect(existsSync(join(dir, '.gkm', 'compose', 'production'))).toBe(false);
	});
});

/**
 * A stage's secrets started the way a user starts them — `gkm secrets:init`,
 * then `gkm secrets:set` — and the stack composed from them. Initialising
 * used to store a `localhost` URL for each app's database under the key a
 * tenant now provides, and a stored key wins over a derived one: the auth
 * server was handed a database where nothing answers.
 */
describe("a stage's addresses", { timeout: RUN_TIMEOUT }, () => {
	let home: string;
	let cwd: string;

	beforeEach(async () => {
		dir = await project();
		home = realpathSync(await createTempDir('gkm-compose-home-'));
		vi.stubEnv('GKM_HOME', home);
		cwd = process.cwd();
		process.chdir(dir);
	});
	afterEach(async () => {
		process.chdir(cwd);
		vi.unstubAllEnvs();
		await cleanupDir(dir);
		await cleanupDir(home);
	});

	const store = async () =>
		new FileSecretsStore(
			dir,
			keystoreProject(await loadWorkspaceSettings(dir), home),
		);
	const envFile = (app: string) =>
		Object.fromEntries(
			readFileSync(
				join(dir, '.gkm', 'compose', 'development', `${app}.env`),
				'utf-8',
			)
				.split('\n')
				.filter((line) => line.includes('='))
				.map((line) => [
					line.slice(0, line.indexOf('=')),
					line.slice(line.indexOf('=') + 1),
				]),
		);
	const dryRun = () =>
		composeCommand(
			{ cwd: dir, stage: 'development', dryRun: true },
			{ docker: fakeDocker().docker, revision: async () => 'abc1234' },
		);

	/** No key of a construct's address, stored. */
	const addressKeys = (custom: Record<string, string> = {}) =>
		Object.keys(custom).filter((key) =>
			/_(DATABASE_URL|DB_PASSWORD)$|^(AUTH|WEB)_URL$/.test(key),
		);

	it("hands the auth server its tenant's derived URL after secrets:init and secrets:set", async () => {
		await secretsInitCommand({ stage: 'development' });
		await secretsSetCommand('SOME_KEY', 'x', { stage: 'development' });

		const stored = await (await store()).read('development');
		expect(stored?.custom.SOME_KEY).toBe('x');
		// The workspace's own secrets were generated.
		expect(stored?.custom.JWT_SECRET).toBeTruthy();
		expect(addressKeys(stored?.custom)).toEqual([]);

		await dryRun();

		expect(envFile('auth').AUTH_DATABASE_URL).toMatch(
			/^postgres:\/\/authdatabase:[^@]+@postgres:5432\/database$/,
		);
	});

	// `gkm test --auto-setup` and `gkm setup` start a stage knowing its
	// containers — and with a Postgres among them, they stored a URL and a
	// password for every backend app.
	it("hands the auth server its tenant's derived URL after gkm test's auto-setup", async () => {
		expect(await ensureStageSecrets('development', dir)).toBe(true);
		await secretsSetCommand('SOME_KEY', 'x', { stage: 'development' });

		const stored = await (await store()).read('development');
		expect(stored?.custom.JWT_SECRET).toBeTruthy();
		expect(addressKeys(stored?.custom)).toEqual([]);

		await dryRun();

		expect(envFile('auth').AUTH_DATABASE_URL).toMatch(
			/^postgres:\/\/authdatabase:[^@]+@postgres:5432\/database$/,
		);
	});

	it('refuses a stage holding a localhost URL for a tenant, naming the command that removes it', async () => {
		await (await store()).write('development', {
			...initStageSecrets('development'),
			custom: {
				AUTH_DATABASE_URL:
					'postgresql://auth:k3x9@localhost:5432/compose_app_dev',
				AUTH_DB_PASSWORD: 'k3x9',
			},
		});

		const error = await dryRun().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(StaleStageSecrets);
		expect((error as StaleStageSecrets).stale).toEqual([
			{
				key: 'AUTH_DATABASE_URL',
				construct: 'AuthDatabase',
				host: 'localhost',
			},
		]);
		expect((error as Error).message).toContain(
			'gkm secrets:unset AUTH_DATABASE_URL --stage development',
		);
		// Never the password it holds.
		expect((error as Error).message).not.toContain('k3x9');
		expect(existsSync(join(dir, '.gkm', 'compose', 'development'))).toBe(false);
	});

	it('keeps a managed database the stage set, as before', async () => {
		const managed = 'postgres://auth:pw@db.managed.example:5432/auth';
		await (await store()).write('development', {
			...initStageSecrets('development'),
			custom: { AUTH_DATABASE_URL: managed },
		});

		await dryRun();

		expect(envFile('auth').AUTH_DATABASE_URL).toBe(managed);
	});
});

describe('telemetry, self-hosted by default', { timeout: RUN_TIMEOUT }, () => {
	let home: string;
	const registry = [
		'registry.example.com/acme/compose-app/compose-app-api:v1.4.0',
		'registry.example.com/acme/compose-app/compose-app-auth:v1.4.0',
		'registry.example.com/acme/compose-app/compose-app-jobs:v1.4.0',
		'registry.example.com/acme/compose-app/compose-app-web:v1.4.0-production',
	];

	beforeEach(async () => {
		dir = realpathSync(await createTempDir('gkm-compose-logs-'));
		// A Telemetry construct, and a deployed stage that names no provider.
		writeComposeApp(dir, {
			registry: 'registry.example.com/acme',
			telemetry: true,
		});
		home = realpathSync(await createTempDir('gkm-compose-home-'));
		vi.stubEnv('GKM_HOME', home);
	});
	afterEach(async () => {
		vi.unstubAllEnvs();
		await cleanupDir(dir);
		await cleanupDir(home);
	});

	const store = async () =>
		new FileSecretsStore(
			dir,
			keystoreProject(await loadWorkspaceSettings(dir), home),
		);

	const release = async () => {
		const said: string[] = [];
		vi.spyOn(console, 'log').mockImplementation((...a) => {
			said.push(a.join(' '));
		});
		const fake = fakeDocker({ registry });
		const result = await composeCommand(
			{ cwd: dir, stage: 'production', tag: 'v1.4.0' },
			{
				docker: fake.docker,
				probe: answering(fake.calls),
				revision: async () => 'abc1234',
				logins: signedIn,

				sql: () => ({ query: async () => [] }),
				migrate: async () => [],
				seed: async () => [],
			},
		);
		return { ...fake, result, said: said.join('\n') };
	};

	it('generates the root password once, keeps it in the stage, and reads it back every run', async () => {
		const first = await release();
		const stored = (await (await store()).read('production'))?.custom
			.ZO_ROOT_USER_PASSWORD;

		expect(stored).toBeTruthy();
		expect(first.said).toContain('ZO_ROOT_USER_PASSWORD');
		const file = join(dir, '.gkm', 'compose', 'production', 'openobserve.env');
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(readFileSync(file, 'utf-8')).toContain(
			`ZO_ROOT_USER_PASSWORD=${stored}`,
		);

		const second = await release();
		expect(
			(await (await store()).read('production'))?.custom.ZO_ROOT_USER_PASSWORD,
		).toBe(stored);
		expect(second.result?.stack.logs?.password).toBe(stored);
		// Never printed: the access line points at secrets:show instead.
		expect(second.said).not.toContain(stored);
		expect(second.said).toContain(
			'gkm secrets:show --stage production --reveal → ZO_ROOT_USER_PASSWORD',
		);
	});

	it('starts it with the infrastructure, checks it in verify, and says how to open it', async () => {
		const { calls, said } = await release();

		expect(calls.find((call) => call.op === 'up')?.args).toEqual([
			'openobserve',
			'postgres',
			'redis',
		]);
		expect(calls).toContainEqual({ op: 'health', args: 'openobserve' });
		expect(said).toContain(
			'📜 Logs (OpenObserve) on 127.0.0.1:5080 — from your computer:',
		);
		expect(said).toMatch(/ssh -N -L 5080:localhost:5080 \S+@\S+/);
		expect(said).toContain('Docker-published ports bypass ufw');
	});
});

describe(
	"the project's own docker-compose.<stage>.yml",
	{ timeout: RUN_TIMEOUT },
	() => {
		beforeEach(async () => {
			dir = await project();
			writeFileSync(
				join(dir, 'docker-compose.development.yml'),
				'services:\n  api:\n    logging:\n      driver: local\n',
			);
		});
		afterEach(async () => {
			await cleanupDir(dir);
		});

		it('is merged over the stack, and stopped with it', async () => {
			const refs: unknown[] = [];
			const fake = fakeDocker();
			const docker = {
				...fake.docker,
				async up(
					ref: Parameters<typeof fake.docker.up>[0],
					services?: readonly string[],
				) {
					refs.push(ref.overrides);
					return fake.docker.up(ref, services);
				},
				async down(ref: Parameters<typeof fake.docker.down>[0]) {
					refs.push(ref.overrides);
					return fake.docker.down(ref);
				},
			};

			await composeCommand(
				{ cwd: dir, stage: 'development' },
				{
					docker,
					probe: answering(fake.calls),
					revision: async () => 'abc1234',
					logins: signedIn,

					sql: () => ({ query: async () => [] }),
					migrate: async () => [],
					seed: async () => [],
				},
			);
			await composeCommand(
				{ cwd: dir, stage: 'development', down: true },
				{ docker },
			);

			const override = join(dir, 'docker-compose.development.yml');
			expect(refs).toEqual([[override], [override], [override]]);
		});
	},
);

describe("the stack's Redis", { timeout: RUN_TIMEOUT }, () => {
	let home: string;
	const registry = [
		'registry.example.com/acme/compose-app/compose-app-api:v1.4.0',
		'registry.example.com/acme/compose-app/compose-app-auth:v1.4.0',
		'registry.example.com/acme/compose-app/compose-app-jobs:v1.4.0',
		'registry.example.com/acme/compose-app/compose-app-web:v1.4.0-production',
	];

	beforeEach(async () => {
		dir = await project();
		home = realpathSync(await createTempDir('gkm-compose-home-'));
		vi.stubEnv('GKM_HOME', home);
	});
	afterEach(async () => {
		vi.unstubAllEnvs();
		await cleanupDir(dir);
		await cleanupDir(home);
	});

	const store = async () =>
		new FileSecretsStore(
			dir,
			keystoreProject(await loadWorkspaceSettings(dir), home),
		);

	const release = async () => {
		const said: string[] = [];
		vi.spyOn(console, 'log').mockImplementation((...a) => {
			said.push(a.join(' '));
		});
		const fake = fakeDocker({ registry });
		const result = await composeCommand(
			{ cwd: dir, stage: 'production', tag: 'v1.4.0' },
			{
				docker: fake.docker,
				probe: answering(fake.calls),
				revision: async () => 'abc1234',
				logins: signedIn,

				sql: () => ({ query: async () => [] }),
				migrate: async () => [],
				seed: async () => [],
			},
		);
		return { ...fake, result, said: said.join('\n') };
	};

	const stackFile = (name: string) =>
		join(dir, '.gkm', 'compose', 'production', name);

	it('generates its password once, keeps it in the stage, and reads it back every run', async () => {
		const first = await release();
		const stored = (await (await store()).read('production'))?.custom
			.REDIS_PASSWORD;

		expect(stored).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(first.said).toContain('REDIS_PASSWORD');
		expect(first.result?.stack.infra).toContain('redis');
		expect(first.calls.find((call) => call.op === 'up')?.args).toContain(
			'redis',
		);

		// Its own env file, and the API's URL, both the owner's alone.
		for (const name of ['redis.env', 'api.env']) {
			expect(statSync(stackFile(name)).mode & 0o777).toBe(0o600);
		}
		expect(readFileSync(stackFile('redis.env'), 'utf-8')).toContain(
			`REDIS_PASSWORD=${stored}\n`,
		);
		expect(readFileSync(stackFile('api.env'), 'utf-8')).toContain(
			`SESSIONS_URL=redis://:${stored}@redis:6379/0\n`,
		);
		// Never in the compose file.
		expect(
			readFileSync(stackFile('docker-compose.yml'), 'utf-8'),
		).not.toContain(stored);

		const second = await release();
		expect(
			(await (await store()).read('production'))?.custom.REDIS_PASSWORD,
		).toBe(stored);
		expect(second.result?.stack.redis?.password).toBe(stored);
		expect(second.said).not.toContain('REDIS_PASSWORD');
		expect(readFileSync(stackFile('api.env'), 'utf-8')).toContain(
			`SESSIONS_URL=redis://:${stored}@redis:6379/0\n`,
		);
	});

	it("runs no Redis and generates no password where the stage set the cache's URL", async () => {
		const managed = 'rediss://default:token@cache.example.com:6380';
		await (await store()).write('production', {
			...initStageSecrets('production'),
			custom: { SESSIONS_URL: managed },
		});

		const { result, calls } = await release();

		expect(result?.stack.infra).not.toContain('redis');
		expect(calls.find((call) => call.op === 'up')?.args).not.toContain('redis');
		expect(existsSync(stackFile('redis.env'))).toBe(false);
		expect(readFileSync(stackFile('api.env'), 'utf-8')).toContain(
			`SESSIONS_URL=${managed}\n`,
		);
		expect(
			(await (await store()).read('production'))?.custom,
		).not.toHaveProperty('REDIS_PASSWORD');
	});

	it('refuses to build a stack with a cache for apps that cannot resolve ioredis, before anything is touched', async () => {
		writeFileSync(
			join(dir, 'package.json'),
			JSON.stringify({ name: 'compose-app', private: true, type: 'module' }),
		);
		const fake = fakeDocker();

		const error = await composeCommand(
			{ cwd: dir, stage: 'development' },
			{ docker: fake.docker, revision: async () => 'abc1234' },
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(RedisClientMissing);
		expect((error as RedisClientMissing).apps).toEqual(['api', 'auth']);
		expect(fake.ops()).toEqual([]);
	});
});

describe('gkm compose --down', { timeout: RUN_TIMEOUT }, () => {
	beforeEach(async () => {
		dir = await project();
	});
	afterEach(async () => {
		await cleanupDir(dir);
	});

	it("stops the stage's stack by its project", async () => {
		const { docker, calls } = fakeDocker();

		await composeCommand(
			{ cwd: dir, stage: 'development', down: true },
			{ docker },
		);

		expect(calls).toEqual([{ op: 'down', args: 'compose-app-development' }]);
	});
});

it('refuses --build with --pull', async () => {
	await expect(
		composeCommand({
			cwd: '/nowhere',
			stage: 'development',
			build: true,
			pull: true,
		}),
	).rejects.toBeInstanceOf(ComposeModeConflict);
});

describe('gkm compose --build --push', { timeout: RUN_TIMEOUT }, () => {
	const REGISTRY = 'registry.example.com/acme/compose-app';
	const refs = {
		api: `${REGISTRY}/compose-app-api:v2`,
		auth: `${REGISTRY}/compose-app-auth:v2`,
		jobs: `${REGISTRY}/compose-app-jobs:v2`,
		web: `${REGISTRY}/compose-app-web:v2-production`,
	};

	beforeEach(async () => {
		dir = await project();
	});
	afterEach(async () => {
		await cleanupDir(dir);
	});

	it('builds and pushes every image — backends, the worker, the site at <tag>-<stage> — and starts nothing', async () => {
		const { docker, calls, ops } = fakeDocker();
		const sql = vi.fn();
		const migrate = vi.fn();
		const seed = vi.fn();
		const probe = vi.fn();

		const result = await composeCommand(
			{
				cwd: dir,
				stage: 'production',
				build: true,
				push: true,
				tag: 'v2',
				digestsFile: 'release/digests.json',
			},
			{ docker, sql, migrate, seed, probe },
		);

		expect(ops()).toEqual(['build', 'push', 'push', 'push', 'push']);
		expect(calls[0]?.args).toEqual(['api', 'auth', 'web', 'jobs']);
		expect(
			calls.filter((call) => call.op === 'push').map((call) => call.args),
		).toEqual([refs.api, refs.auth, refs.web, refs.jobs]);
		// Nothing provisioned, migrated or asked.
		expect(sql).not.toHaveBeenCalled();
		expect(migrate).not.toHaveBeenCalled();
		expect(seed).not.toHaveBeenCalled();
		expect(probe).not.toHaveBeenCalled();
		expect(result?.images?.api).toEqual({
			ref: refs.api,
			tag: 'v2',
			digest: fakeDigest(refs.api),
		});

		// The digests file: each image as <ref>@sha256:…, for the deploy step.
		const digests = JSON.parse(
			readFileSync(join(dir, 'release', 'digests.json'), 'utf-8'),
		);
		expect(digests).toEqual(
			Object.fromEntries(
				Object.entries(refs).map(([app, ref]) => [
					app,
					`${ref}@${fakeDigest(ref)}`,
				]),
			),
		);
	});

	it('records nothing, keeps none of the secrets it generated, and reads no env file', async () => {
		const { docker } = fakeDocker();

		await composeCommand(
			{ cwd: dir, stage: 'production', build: true, push: true, tag: 'v2' },
			{ docker },
		);

		expect(existsSync(join(dir, '.gkm', 'deploy-production.json'))).toBe(false);
		expect(existsSync(join(dir, '.gkm', 'secrets', 'production.json'))).toBe(
			false,
		);
		const stack = join(dir, '.gkm', 'compose', 'production');
		expect(readdirSync(stack).filter((file) => file.endsWith('.env'))).toEqual(
			[],
		);
		const compose = readFileSync(join(stack, 'docker-compose.yml'), 'utf-8');
		expect(compose).not.toContain('env_file');
		// The site is built with the stage's public URLs.
		expect(compose).toContain('VITE_API_URL: https://api.shop.example.com');
		// The same Dockerfiles a deploy builds: the backends register the
		// stack's Redis cache driver.
		for (const backend of ['api', 'jobs']) {
			expect(
				readFileSync(join(stack, `Dockerfile.${backend}`), 'utf-8'),
			).toContain('--cache redis');
		}
		// Nor is the Redis password written: nothing reads an env file.
		expect(existsSync(join(stack, 'redis.env'))).toBe(false);
	});

	it('takes no lock: a push runs while the stage is being deployed', async () => {
		const { docker } = fakeDocker();
		const { createStateStore } = await import('../../deploy/StateStore');
		const store = await createStateStore({
			config: undefined,
			workspaceRoot: dir,
			workspaceName: 'compose-app',
		});
		const lock = await store.lock('production', { operation: 'deploy' });

		try {
			await expect(
				composeCommand(
					{ cwd: dir, stage: 'production', build: true, push: true, tag: 'v2' },
					{ docker },
				),
			).resolves.toBeDefined();
		} finally {
			await lock.release();
		}
	});

	it('refuses --push without --build, and with --pull, before anything runs', async () => {
		await expect(
			composeCommand({ cwd: '/nowhere', stage: 'production', push: true }),
		).rejects.toBeInstanceOf(ComposePushNeedsBuild);
		await expect(
			composeCommand({
				cwd: '/nowhere',
				stage: 'production',
				push: true,
				pull: true,
			}),
		).rejects.toBeInstanceOf(ComposePushNeedsBuild);
		await expect(
			composeCommand({
				cwd: '/nowhere',
				stage: 'production',
				push: true,
				tag: 'v2',
			}),
		).rejects.toBeInstanceOf(ComposePushNeedsBuild);
	});

	it('refuses a digests file on a build that neither pushes nor pulls', async () => {
		await expect(
			composeCommand({
				cwd: '/nowhere',
				stage: 'production',
				build: true,
				digestsFile: 'digests.json',
			}),
		).rejects.toBeInstanceOf(ComposePinNeedsPull);
	});
});

describe('with no deploy.registry', { timeout: RUN_TIMEOUT }, () => {
	beforeEach(async () => {
		dir = realpathSync(await createTempDir('gkm-compose-command-'));
		writeComposeApp(dir);
	});
	afterEach(async () => {
		await cleanupDir(dir);
	});

	it('refuses to push, before anything is built or contacted', async () => {
		const { docker, ops } = fakeDocker();

		const error = await composeCommand(
			{ cwd: dir, stage: 'production', build: true, push: true, tag: 'v2' },
			{ docker },
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(RegistryRequired);
		expect((error as RegistryRequired).operation).toBe('push');
		// The Docker Hub name it would have had.
		expect((error as RegistryRequired).ref).toMatch(
			/^compose-app\/compose-app-[a-z]+:v2$/,
		);
		expect((error as Error).message).toContain('deploy.registry');
		expect(ops()).toEqual([]);
		expect(existsSync(join(dir, '.gkm', 'compose'))).toBe(false);
	});

	it('refuses to pull a tag, or --pull, before the registry is asked', async () => {
		for (const options of [{ tag: 'v2' }, { pull: true }]) {
			const { docker, ops } = fakeDocker();
			const error = await composeCommand(
				{ cwd: dir, stage: 'production', ...options },
				{ docker },
			).catch((e: unknown) => e);

			expect(error).toBeInstanceOf(RegistryRequired);
			expect((error as RegistryRequired).operation).toBe('pull');
			expect(ops()).toEqual([]);
		}
	});

	it('still builds and runs here with no tag, as it always has', async () => {
		const { docker, ops } = fakeDocker();

		await composeCommand(
			{ cwd: dir, stage: 'development' },
			{
				docker,
				revision: async () => 'abc1234',
				logins: signedIn,

				sql: () => ({ query: async () => [] }) satisfies SqlClient,
				migrate: async () => [],
				seed: async () => [],
				probe: async () => 200,
			},
		);

		expect(ops()).toContain('build');
		expect(ops()).not.toContain('push');
	});
});

describe('gkm compose --tag --digests-file', { timeout: RUN_TIMEOUT }, () => {
	const REGISTRY = 'registry.example.com/acme/compose-app';
	const refs = {
		api: `${REGISTRY}/compose-app-api:v2`,
		auth: `${REGISTRY}/compose-app-auth:v2`,
		jobs: `${REGISTRY}/compose-app-jobs:v2`,
		web: `${REGISTRY}/compose-app-web:v2-production`,
	};
	const pinned = Object.fromEntries(
		Object.entries(refs).map(([app, ref]) => [
			app,
			`${ref}@${fakeDigest(ref)}`,
		]),
	);

	beforeEach(async () => {
		dir = await project();
	});
	afterEach(async () => {
		await cleanupDir(dir);
	});

	it('pulls and runs each image at its digest, and records it', async () => {
		writeFileSync(join(dir, 'digests.json'), JSON.stringify(pinned));
		const { docker, calls } = fakeDocker({ registry: Object.values(pinned) });

		await composeCommand(
			{
				cwd: dir,
				stage: 'production',
				tag: 'v2',
				digestsFile: 'digests.json',
			},
			{
				docker,
				revision: vi.fn(),
				logins: signedIn,

				sql: () => ({ query: async () => [] }) satisfies SqlClient,
				migrate: async () => [],
				seed: async () => [],
				probe: async () => 200,
			},
		);

		expect(
			calls.filter((call) => call.op === 'lookup').map((call) => call.args),
		).toEqual(expect.arrayContaining(Object.values(pinned)));
		const compose = readFileSync(
			join(dir, '.gkm', 'compose', 'production', 'docker-compose.yml'),
			'utf-8',
		);
		expect(compose).toContain(`image: ${pinned.api}`);
		expect(compose).toContain(`image: ${pinned.web}`);

		const { state } = JSON.parse(
			readFileSync(join(dir, '.gkm', 'deploy-production.json'), 'utf-8'),
		);
		expect(state.releases.api.current.ref).toBe(pinned.api);
		expect(state.releases.api.current.tag).toBe('v2');
	});

	it('refuses a file missing an app, or pinning another image, before the registry is asked', async () => {
		const { api: _, ...noApi } = pinned;
		writeFileSync(join(dir, 'digests.json'), JSON.stringify(noApi));
		const { docker, ops } = fakeDocker({ registry: Object.values(pinned) });

		const missing = await composeCommand(
			{ cwd: dir, stage: 'production', tag: 'v2', digestsFile: 'digests.json' },
			{ docker },
		).catch((e: unknown) => e);
		expect(missing).toBeInstanceOf(ImageDigestMissing);
		expect((missing as ImageDigestMissing).apps).toEqual(['api']);

		// Written by a push of another tag.
		writeFileSync(
			join(dir, 'digests.json'),
			JSON.stringify({ ...pinned, web: pinned.web!.replace(':v2-', ':v1-') }),
		);
		const mismatch = await composeCommand(
			{ cwd: dir, stage: 'production', tag: 'v2', digestsFile: 'digests.json' },
			{ docker },
		).catch((e: unknown) => e);
		expect(mismatch).toBeInstanceOf(ImageDigestMismatch);
		expect(ops()).toEqual([]);
	});
});
