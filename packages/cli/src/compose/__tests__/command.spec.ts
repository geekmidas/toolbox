import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
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
import {
	ExternalServicesNotConfigured,
	UnknownDevService,
} from '../../deploy/devServices';
import type { SqlClient } from '../../reconcile/provision';
import { decryptSecrets } from '../../secrets/encryption';
import {
	ComposeModeConflict,
	composeCommand,
	ImageTagNotFound,
} from '../index';
import { writeComposeApp } from './__helpers__/composeApp';
import { answering, fakeDocker } from './__helpers__/fakeDocker';

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
			web: 'registry.example.com/acme/compose-app/compose-app-web:v1.4.0-production',
		};
		const { docker, ops } = fakeDocker({ registry: [refs.api] });

		const error = await composeCommand(
			{ cwd: dir, stage: 'production', tag: 'v1.4.0' },
			{ docker },
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ImageTagNotFound);
		expect((error as ImageTagNotFound).refs.sort()).toEqual(
			[refs.auth, refs.web].sort(),
		);
		// Asked, and nothing more: no pull, no build, no container touched.
		expect(new Set(ops())).toEqual(new Set(['lookup']));
		expect(ops()).toHaveLength(3);
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
				migrate,
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
			const result = await composeCommand(
				{ cwd: dir },
				{
					docker: fake.docker,
					probe: answering(fake.calls),
					revision: async () => 'abc1234',
					sql: (port, password) => ({
						async query(_database, sql) {
							statements.push(sql);
							fake.calls.push({ op: 'sql', args: [port, password] });
							return [];
						},
					}),
					migrate: async (options) => {
						fake.calls.push({ op: 'migrate' });
						migrations.push(options);
						return [];
					},
				},
			);
			return { ...fake, statements, migrations, result };
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
				'build',
				'up',
				'copyOut',
				'probe',
			]);
			expect(
				calls.filter((call) => call.op === 'up').map((c) => c.args),
			).toEqual([['postgres'], 'all']);
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

		it("builds each backend with its environment encrypted, as a build secret its env file's key opens", async () => {
			const stack = join(dir, '.gkm', 'compose', 'development');
			const compose = readFileSync(join(stack, 'docker-compose.yml'), 'utf-8');

			expect(compose).toMatch(
				/secrets:\n\s+- source: api_credentials\n\s+target: gkm_credentials/,
			);
			expect(compose).toMatch(
				/api_credentials:\n\s+file: \.\/api\.credentials/,
			);
			expect(compose).toMatch(/GKM_CIPHERTEXT_HASH: [0-9a-f]{16}/);
			expect(statSync(join(stack, 'api.credentials')).mode & 0o777).toBe(0o600);

			const [encrypted, iv] = readFileSync(
				join(stack, 'api.credentials'),
				'utf-8',
			).split('\n');
			const env = readFileSync(join(stack, 'api.env'), 'utf-8');
			const masterKey = /^GKM_MASTER_KEY=([0-9a-f]+)$/m.exec(env)?.[1];
			const secrets = decryptSecrets(encrypted!, iv!, masterKey!);
			expect(secrets.PORT).toBe(/^PORT=(.*)$/m.exec(env)?.[1]);
			// A site embeds nothing.
			expect(existsSync(join(stack, 'web.credentials'))).toBe(false);
		});

		it('creates the roles with the master credential on the published port', async () => {
			const { calls, statements } = ran;

			expect(calls.find((call) => call.op === 'sql')?.args).toEqual([
				55432,
				'geekmidas',
			]);
			expect(statements.join('\n')).toMatch(/CREATE DATABASE "database"/);
			expect(statements.join('\n')).toMatch(/CREATE ROLE "authdatabase"/);
		});

		it("migrates with the owner's URL on the published port", async () => {
			const [options] = ran.migrations;

			expect(options?.env.AUTH_DATABASE_OWNER_URL).toMatch(
				/^postgres:\/\/authdatabase_owner:[^@]+@localhost:55432\/database$/,
			);
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
			{ cwd: dir, dryRun: true },
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
			{ cwd: dir, dryRun: true },
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
		// leaves out every stack's env files and credentials.
		const ignore = readFileSync(join(root, '.dockerignore'), 'utf-8');
		expect(ignore.startsWith('coverage\n')).toBe(true);
		for (const file of ['api.env', 'auth.env', 'api.credentials']) {
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
			{ cwd: dir },
			{
				docker: fake.docker,
				probe: answering(fake.calls),
				revision: async () => 'abc1234',
				sql: () => ({ query: async () => [] }),
				migrate: async () => [],
				buckets: recordingBuckets(fake.calls),
			},
		);

		expect(result?.stack.infra).toEqual(['mailpit', 'minio', 'postgres']);
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
		expect(ops).toContain('buckets [55432,"geekmidas"]');
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
			/MAIL_URL[\s\S]*MAIL_FROM[\s\S]*UPLOADS_URL[\s\S]*AWS_ACCESS_KEY_ID[\s\S]*AWS_SECRET_ACCESS_KEY/,
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
				sql: () => ({ query: async () => [] }),
				migrate: async () => [],
				buckets: recordingBuckets(fake.calls),
			},
		);

		expect(result?.stack.infra).toEqual(['mailpit', 'minio', 'postgres']);
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
			composeCommand({ cwd: dir, allowDevServices: 'minio,redis' }),
		).rejects.toBeInstanceOf(UnknownDevService);
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

		await composeCommand({ cwd: dir, down: true }, { docker });

		expect(calls).toEqual([{ op: 'down', args: 'compose-app-development' }]);
	});
});

it('refuses --build with --pull', async () => {
	await expect(
		composeCommand({ cwd: '/nowhere', build: true, pull: true }),
	).rejects.toBeInstanceOf(ComposeModeConflict);
});
