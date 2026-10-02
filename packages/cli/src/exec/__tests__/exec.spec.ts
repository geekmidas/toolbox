import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
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
import { FileSecretsStore } from '../../secrets/file';
import { execCommand, NoCommandSpecified } from '../index';

/**
 * `gkm exec` runs a real command. So does this: a `node -e` that writes down
 * what it was given, which is the only honest way to see what a child process
 * actually receives.
 */
describe('execCommand', () => {
	let dir: string;
	let cwd: string;
	let exit: MockInstance;

	/** A node process that records its environment into `seen.json`. */
	const recorder = [
		process.execPath,
		'-e',
		`require('fs').writeFileSync('seen.json', JSON.stringify({
			PORT: process.env.PORT,
			NODE_OPTIONS: process.env.NODE_OPTIONS,
			FROM_DOTENV: process.env.FROM_DOTENV,
		}))`,
	];

	beforeEach(async () => {
		dir = realpathSync(await createTempDir('gkm-exec-'));
		cwd = process.cwd();
		process.chdir(dir);
		exit = vi
			.spyOn(process, 'exit')
			.mockImplementation((() => undefined) as never);
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(async () => {
		process.chdir(cwd);
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		await cleanupDir(dir);
	});

	it('runs the command with PORT and a credentials preload, minus the parent --import', async () => {
		writeFileSync(join(dir, '.env'), 'FROM_DOTENV=yes\n');
		vi.stubEnv('NODE_OPTIONS', '--import tsx --max-old-space-size=512');

		await execCommand(recorder, { cwd: dir });

		const seen = JSON.parse(readFileSync(join(dir, 'seen.json'), 'utf-8'));
		const preload = join(dir, '.gkm', 'credentials-preload.mjs');
		expect(existsSync(preload)).toBe(true);
		// The parent's tsx loader is gkm's own; the child gets only the preload.
		expect(seen.NODE_OPTIONS).toBe(
			`--max-old-space-size=512 --import=${preload}`,
		);
		expect(seen.PORT).toBe('3000');
		expect(seen.FROM_DOTENV).toBe('yes');
		expect(exit).not.toHaveBeenCalled();
	});

	it('exits with the command’s own failure code', async () => {
		vi.stubEnv('NODE_OPTIONS', '');

		await execCommand([process.execPath, '-e', 'process.exit(3)'], {
			cwd: dir,
		});

		expect(exit).toHaveBeenCalledWith(3);
	});

	it('exits 1 when the command cannot be started', async () => {
		await execCommand(['gkm-no-such-binary-anywhere'], { cwd: dir });

		expect(exit).toHaveBeenCalledWith(1);
	});

	it('runs from the current directory with only the preload when nothing is inherited', async () => {
		vi.stubEnv('NODE_OPTIONS', undefined);

		await execCommand(recorder);

		const seen = JSON.parse(readFileSync(join(dir, 'seen.json'), 'utf-8'));
		expect(seen.NODE_OPTIONS).toBe(
			`--import=${join(dir, '.gkm', 'credentials-preload.mjs')}`,
		);
	});

	it('names the workspace app it runs for, and hands it the stage secrets', async () => {
		vi.stubEnv('HOME', dir);
		vi.stubEnv('NODE_OPTIONS', '');
		writeFileSync(
			join(dir, 'gkm.config.ts'),
			`export default {
  name: 'shop',
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './src/constructs/**/*.ts',
  apps: { api: { type: 'backend', path: 'apps/api', port: 3600 } },
};
`,
		);
		await new FileSecretsStore(dir).write('dev', {
			stage: 'dev',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			services: {},
			urls: {},
			custom: { STRIPE_KEY: 'sk_exec' },
		});
		const api = join(dir, 'apps', 'api');
		mkdirSync(api, { recursive: true });
		writeFileSync(join(api, 'package.json'), JSON.stringify({ name: 'api' }));
		process.chdir(api);

		await execCommand(
			[
				process.execPath,
				'-e',
				"require('fs').writeFileSync('key.txt', process.env.STRIPE_KEY)",
			],
			{ cwd: api },
		);

		expect(readFileSync(join(api, 'key.txt'), 'utf-8')).toBe('sk_exec');
		const said = (console.log as unknown as MockInstance).mock.calls
			.flat()
			.join('\n');
		expect(said).toContain('App: api');
		expect(said).toMatch(/Loaded \d+ secret\(s\)/);
	});

	it('refuses to run nothing', async () => {
		await expect(execCommand([], { cwd: dir })).rejects.toThrow(
			NoCommandSpecified,
		);
		await expect(execCommand([''], { cwd: dir })).rejects.toThrow(
			NoCommandSpecified,
		);
	});
});
