import type { EventEmitter } from 'node:events';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { readStageSecrets } from '../../secrets/storage';

/**
 * `gkm test` prepares a stage and hands it to Vitest. Everything up to the
 * hand-off is real — config, auto-setup, secrets, the preload it writes — and
 * the Vitest process is the one thing replaced, so what it would have been
 * started with is what is checked.
 */

interface FakeChild extends EventEmitter {
	command: string;
	args: string[];
	options: { cwd?: string; env?: Record<string, string> };
}

const spawned = vi.hoisted(() => [] as FakeChild[]);

vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	const { EventEmitter } = await import('node:events');
	return {
		...actual,
		spawn: vi.fn((command: string, args: string[], options: object) => {
			const child = Object.assign(new EventEmitter(), {
				command,
				args,
				options,
			});
			spawned.push(child as FakeChild);
			return child;
		}),
	};
});

const { NoStageToTest, testCommand } = await import('../index');

async function until(check: () => boolean, timeout = 15_000): Promise<void> {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > timeout) throw new Error('timed out waiting');
		await new Promise((r) => setTimeout(r, 25));
	}
}

describe('testCommand', { timeout: 30_000 }, () => {
	let dir: string;
	let cwd: string;
	let log: MockInstance;

	const output = () => log.mock.calls.flat().join('\n');

	beforeEach(async () => {
		dir = realpathSync(await createTempDir('gkm-test-cmd-'));
		cwd = process.cwd();
		process.chdir(dir);
		vi.stubEnv('HOME', dir);
		// Compose reads this from the environment; anything that reaches it from
		// here gets a project of its own, never a shared one.
		vi.stubEnv('COMPOSE_PROJECT_NAME', `gkm-spec-${Date.now()}`);
		vi.stubEnv('GKM_AUTO_SETUP', '');
		vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=512');
		spawned.length = 0;
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		writeFileSync(
			join(dir, 'gkm.config.ts'),
			`export default {
  name: 'shop',
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './src/constructs/**/*.ts',
};
`,
		);
		writeFileSync(join(dir, '.env'), 'FROM_DOTENV=yes\n');
	});

	afterEach(async () => {
		process.chdir(cwd);
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		await cleanupDir(dir);
	});

	it('generates the stage in CI, and starts vitest with its credentials preloaded', async () => {
		const running = testCommand({
			autoSetup: true,
			run: true,
			coverage: true,
			ui: true,
			pattern: 'users',
		});
		await until(() => spawned.length === 1);

		const [vitest] = spawned;
		expect(vitest!.command).toBe('npx');
		expect(vitest!.args).toEqual([
			'vitest',
			'run',
			'--coverage',
			'--ui',
			'users',
		]);
		expect(vitest!.options.cwd).toBe(dir);
		expect(vitest!.options.env?.NODE_ENV).toBe('test');
		const preload = join(dir, '.gkm', 'test-credentials-preload.ts');
		expect(existsSync(preload)).toBe(true);
		expect(vitest!.options.env?.NODE_OPTIONS).toBe(
			`--max-old-space-size=512 --import=tsx --import=${preload}`,
		);
		expect(vitest!.options.env?.FROM_DOTENV).toBe('yes');

		// Auto-setup minted the local stage from the config.
		expect(await readStageSecrets('dev', dir)).not.toBeNull();
		expect(output()).toContain('Generated fresh dev secrets (auto-setup)');
		expect(output()).toContain('Loaded env: .env');

		vitest!.emit('close', 0);
		await expect(running).resolves.toBeUndefined();
	});

	it('keeps an existing stage, runs in watch mode, and fails when vitest does', async () => {
		vi.stubEnv('GKM_AUTO_SETUP', '1');
		// A first run generates; the second finds it.
		const first = testCommand({});
		await until(() => spawned.length === 1);
		spawned[0]!.emit('close', 0);
		await first;
		log.mockClear();

		const running = testCommand({ watch: true, stage: 'dev' });
		await until(() => spawned.length === 2);

		expect(spawned[1]!.args).toEqual(['vitest', '--watch']);
		expect(output()).not.toContain('auto-setup');

		spawned[1]!.emit('close', 1);
		await expect(running).rejects.toThrow('Tests failed with exit code 1');
	});

	it('writes the credentials the suite reads, and fails when vitest cannot start', async () => {
		const running = testCommand({ stage: 'dev' });
		await until(() => spawned.length === 1);

		const written = JSON.parse(
			readFileSync(join(dir, '.gkm', 'test-secrets.json'), 'utf-8'),
		);
		expect(written).toEqual(
			expect.objectContaining({ PORT: expect.any(String) }),
		);

		spawned[0]!.emit('error', new Error('npx: not found'));
		await expect(running).rejects.toThrow('npx: not found');
	});

	it('refuses to guess a stage with no config and none named', async () => {
		writeFileSync(join(dir, 'gkm.config.ts'), 'export default ;\n');

		await expect(testCommand()).rejects.toBeInstanceOf(NoStageToTest);
		expect(spawned).toEqual([]);
	});
});
