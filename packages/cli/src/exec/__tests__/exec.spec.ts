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
import { keystoreProject } from '../../secrets/keystore';
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
		await new FileSecretsStore(
			dir,
			keystoreProject({ name: 'shop', root: dir }),
		).write('dev', {
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

	it('in an image build, hands the command the build args and no secret', async () => {
		vi.stubEnv('HOME', dir);
		vi.stubEnv('NODE_OPTIONS', '');
		writeFileSync(
			join(dir, 'gkm.config.ts'),
			`export default {
  name: 'shop',
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './src/constructs/**/*.ts',
  apps: { web: { type: 'web', path: 'apps/web', port: 3601, framework: 'vite' } },
};
`,
		);
		await new FileSecretsStore(
			dir,
			keystoreProject({ name: 'shop', root: dir }),
		).write('dev', {
			stage: 'dev',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			services: {},
			urls: {},
			custom: { STRIPE_KEY: 'sk_exec', VITE_API_URL: 'http://localhost:1' },
		});
		const web = join(dir, 'apps', 'web');
		mkdirSync(web, { recursive: true });
		writeFileSync(join(web, 'package.json'), JSON.stringify({ name: 'web' }));
		process.chdir(web);
		// What a site's Dockerfile sets: the flag, and its build args.
		vi.stubEnv('GKM_IMAGE_BUILD', '1');
		vi.stubEnv('VITE_API_URL', 'https://api.shop.example.com');

		await execCommand(
			[
				process.execPath,
				'-e',
				`require('fs').writeFileSync('seen.json', JSON.stringify({
					url: process.env.VITE_API_URL,
					secret: process.env.STRIPE_KEY ?? null,
					credentials: globalThis.__gkm_credentials__,
				}))`,
			],
			{ cwd: web },
		);

		const seen = JSON.parse(readFileSync(join(web, 'seen.json'), 'utf-8'));
		expect(seen).toEqual({
			url: 'https://api.shop.example.com',
			secret: null,
			credentials: { VITE_API_URL: 'https://api.shop.example.com' },
		});
		const said = (console.log as unknown as MockInstance).mock.calls
			.flat()
			.join('\n');
		expect(said).toContain('Image build: 1 public value(s)');
		expect(said).not.toMatch(/Loaded \d+ secret\(s\)/);
		expect(exit).not.toHaveBeenCalled();
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
