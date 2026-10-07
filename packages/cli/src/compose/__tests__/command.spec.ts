import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import type { SqlClient } from '../../reconcile/provision';
import type { ComposeDocker, ImageLookup, StackRef } from '../docker';
import {
	ComposeModeConflict,
	composeCommand,
	ImageTagNotFound,
} from '../index';
import { writeComposeApp } from './__helpers__/composeApp';

/**
 * `gkm compose` with Docker, the registry, the bundler and Postgres replaced
 * by recorders — everything else real: the workspace is loaded and discovered,
 * the stage's secrets and state are its real stores, and the files are
 * written where the command writes them.
 */

interface Call {
	op: string;
	args?: unknown;
}

function fakeDocker(options: { registry?: readonly string[] } = {}) {
	const calls: Call[] = [];
	const docker: ComposeDocker = {
		async lookup(ref): Promise<ImageLookup> {
			calls.push({ op: 'lookup', args: ref });
			return options.registry?.includes(ref)
				? { ref, status: 'found' }
				: { ref, status: 'missing' };
		},
		async build(_stack: StackRef, services) {
			calls.push({ op: 'build', args: [...services] });
		},
		async pull(_stack, services) {
			calls.push({ op: 'pull', args: [...services] });
		},
		async up(stack, services) {
			calls.push({ op: 'up', args: services ? [...services] : 'all' });
			void stack;
		},
		async down(stack) {
			calls.push({ op: 'down', args: stack.project });
		},
		async port(_stack, service, inside) {
			calls.push({ op: 'port', args: [service, inside] });
			return 55432;
		},
		async copyOut(_stack, service, from) {
			calls.push({ op: 'copyOut', args: [service, from] });
		},
		async digest(ref) {
			return `sha256:${ref.length.toString(16).padStart(4, '0')}`;
		},
	};
	return { docker, calls, ops: () => calls.map((call) => call.op) };
}

let dir: string;

beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-compose-command-'));
	vi.stubEnv('HOME', dir);
	vi.spyOn(console, 'log').mockImplementation(() => {});
	writeComposeApp(dir, { registry: 'registry.example.com/acme' });
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await cleanupDir(dir);
});

describe('gkm compose --tag', () => {
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
			{ docker, sql, migrate, bundle: vi.fn(), revision: vi.fn() },
		);

		expect(ops()).toContain('pull');
		expect(ops()).not.toContain('build');
		expect(result?.images?.web?.tag).toBe('v1.4.0-production');
	});
});

describe('gkm compose, building from this checkout', () => {
	async function run() {
		const fake = fakeDocker();
		const bundled: string[] = [];
		const statements: string[] = [];
		const migrate = vi.fn(async () => []);
		const result = await composeCommand(
			{ cwd: dir },
			{
				docker: fake.docker,
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
					return migrate(options);
				},
			},
		);
		return { ...fake, bundled, statements, migrate, result };
	}

	it('creates the databases and migrates before any app starts', async () => {
		const { ops, calls } = await run();
		const sequence = ops().filter((op, i, all) => op !== all[i - 1]);

		expect(sequence).toEqual([
			'bundle',
			'build',
			'up',
			'port',
			'sql',
			'migrate',
			'up',
			'copyOut',
		]);
		expect(calls.filter((call) => call.op === 'up').map((c) => c.args)).toEqual(
			[['postgres'], 'all'],
		);
	});

	it('bundles each backend in its own directory, and no site', async () => {
		const { bundled } = await run();

		expect(bundled).toEqual([join(dir, 'apps/api'), join(dir, 'apps/auth')]);
	});

	it('creates the roles with the master credential on the published port', async () => {
		const { calls, statements } = await run();

		expect(calls.find((call) => call.op === 'sql')?.args).toEqual([
			55432,
			'geekmidas',
		]);
		expect(statements.join('\n')).toMatch(/CREATE DATABASE "database"/);
		expect(statements.join('\n')).toMatch(/CREATE ROLE "authdatabase"/);
	});

	it("migrates with the owner's URL on the published port", async () => {
		const { migrate } = await run();
		const [options] = migrate.mock.calls[0] as unknown as [
			{ env: Record<string, string> },
		];

		expect(options.env.AUTH_DATABASE_OWNER_URL).toMatch(
			/^postgres:\/\/authdatabase_owner:[^@]+@localhost:55432\/database$/,
		);
	});

	it('writes the env files for their owner alone', async () => {
		await run();
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
		await run();

		expect(readFileSync(join(dir, '.dockerignore'), 'utf-8')).toMatch(
			/^\.gkm\/compose$/m,
		);
	});

	it("records each app's tag and what it resolved to in the stage's state", async () => {
		const { result } = await run();
		const state = JSON.parse(
			readFileSync(join(dir, '.gkm', 'deploy-development.json'), 'utf-8'),
		);

		expect(state.resources['compose:api']).toMatchObject({
			type: 'compose-image',
			status: 'ready',
			data: {
				ref: 'registry.example.com/acme/compose-app/compose-app-api:abc1234',
				tag: 'abc1234',
				source: 'build',
				digest: result?.images?.api?.digest,
			},
		});
		expect(state.resources['compose:web'].data.tag).toBe('abc1234-development');
	});
});

describe('gkm compose --dry-run', () => {
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

describe('gkm compose --down', () => {
	it("stops the stage's stack by its project", async () => {
		const { docker, calls } = fakeDocker();

		await composeCommand({ cwd: dir, down: true }, { docker });

		expect(calls).toEqual([{ op: 'down', args: 'compose-app-development' }]);
	});
});

it('refuses --build with --pull', async () => {
	await expect(
		composeCommand({ cwd: dir, build: true, pull: true }),
	).rejects.toBeInstanceOf(ComposeModeConflict);
});
