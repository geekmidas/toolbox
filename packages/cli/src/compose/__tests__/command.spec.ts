import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
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
import type { SqlClient } from '../../reconcile/provision';
import {
	ComposeModeConflict,
	composeCommand,
	ImageTagNotFound,
} from '../index';
import { writeComposeApp } from './__helpers__/composeApp';
import { answering, fakeDocker } from './__helpers__/fakeDocker';

/**
 * `gkm compose` with Docker, the registry, the bundler, Postgres and the
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
				bundle: vi.fn(),
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
			const bundled: string[] = [];
			const statements: string[] = [];
			const migrations: { env: Record<string, string | undefined> }[] = [];
			const result = await composeCommand(
				{ cwd: dir },
				{
					docker: fake.docker,
					probe: answering(fake.calls),
					bundle: async (appRoot) => {
						bundled.push(appRoot);
						fake.calls.push({ op: 'bundle' });
					},
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
			return { ...fake, bundled, statements, migrations, result };
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
				'bundle',
				'build',
				'up',
				'copyOut',
				'probe',
			]);
			expect(
				calls.filter((call) => call.op === 'up').map((c) => c.args),
			).toEqual([['postgres'], 'all']);
		});

		it('bundles each backend in its own directory, and no site', async () => {
			const { bundled } = ran;

			expect(bundled).toEqual([join(dir, 'apps/api'), join(dir, 'apps/auth')]);
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
				/^\.gkm\/compose$/m,
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
			{ docker, revision: async () => 'abc1234', bundle: vi.fn() },
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
