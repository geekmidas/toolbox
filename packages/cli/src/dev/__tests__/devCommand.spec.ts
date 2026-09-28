import type { EventEmitter } from 'node:events';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:net';
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
import { writeStageSecrets } from '../../secrets/storage';

/**
 * What `gkm dev` does between reading the config and handing a process to the
 * operating system: build the server, write its entry, start it, watch the
 * constructs, rebuild on change, shut down on a signal.
 *
 * The two things replaced are the boundaries that would outlive the test — the
 * spawned process and the file watcher — and each fake records what it was
 * asked for, so the assertions are about what dev mode *did*, not how.
 */

interface FakeChild extends EventEmitter {
	pid: number;
	command: string;
	args: string[];
	options: { cwd?: string; env?: Record<string, string> };
}

interface FakeWatcher extends EventEmitter {
	paths: string[];
	close: ReturnType<typeof vi.fn>;
}

const fakes = vi.hoisted(() => ({
	spawned: [] as FakeChild[],
	watchers: [] as FakeWatcher[],
}));

vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	const { EventEmitter } = await import('node:events');
	return {
		...actual,
		// `lsof … | xargs kill -9` on the dev port: never on a test machine.
		execSync: vi.fn(() => ''),
		spawn: vi.fn((command: string, args: string[], options: object) => {
			const child = Object.assign(new EventEmitter(), {
				pid: 4_000_000 + fakes.spawned.length,
				command,
				args,
				options,
			});
			fakes.spawned.push(child as FakeChild);
			return child;
		}),
	};
});

vi.mock('chokidar', async () => {
	const { EventEmitter } = await import('node:events');
	return {
		default: {
			watch: vi.fn((paths: string | string[]) => {
				const watcher = Object.assign(new EventEmitter(), {
					paths: [paths].flat(),
					close: vi.fn(async () => {}),
				});
				fakes.watchers.push(watcher as unknown as FakeWatcher);
				return watcher;
			}),
		},
	};
});

const { devCommand } = await import('../index');

/** Resolves once `check` holds, polling — dev mode's steps are all async. */
async function until(check: () => boolean, timeout = 15_000): Promise<void> {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > timeout) throw new Error('timed out waiting');
		await new Promise((r) => setTimeout(r, 25));
	}
}

/** A port nothing is listening on, and one that something is. */
async function occupiedPort(): Promise<{ port: number; server: Server }> {
	const server = createServer();
	// Every interface, the way the dev server's own check binds.
	await new Promise<void>((r) => server.listen(0, r));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('no port');
	return { port: address.port, server };
}

// Starting a server waits a second for it, as the real one does.
describe('devCommand', { timeout: 30_000 }, () => {
	let dir: string;
	let cwd: string;
	let signals: Record<string, () => void>;
	let exit: MockInstance;
	let kill: MockInstance;
	let log: MockInstance;
	let warn: MockInstance;
	let error: MockInstance;
	const originalOn = process.on.bind(process);

	const output = (spy: MockInstance) => spy.mock.calls.flat().join('\n');

	beforeEach(async () => {
		// Resolved, because the process sees the real path and macOS's temp
		// directory is behind a symlink.
		dir = realpathSync(await createTempDir('gkm-dev-'));
		cwd = process.cwd();
		process.chdir(dir);
		// Stage keys live under the home directory.
		vi.stubEnv('HOME', dir);
		// Compose reads this from the environment; anything that reaches it from
		// here gets a project of its own, never a shared one.
		vi.stubEnv('COMPOSE_PROJECT_NAME', `gkm-spec-${Date.now()}`);
		fakes.spawned.length = 0;
		fakes.watchers.length = 0;
		signals = {};
		vi.spyOn(process, 'on').mockImplementation(((
			event: string,
			handler: () => void,
		) => {
			if (event === 'SIGINT' || event === 'SIGTERM') {
				signals[event] = handler;
				return process;
			}
			return originalOn(event, handler);
		}) as typeof process.on);
		exit = vi
			.spyOn(process, 'exit')
			.mockImplementation((() => undefined) as never);
		kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		error = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(async () => {
		process.chdir(cwd);
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		await cleanupDir(dir);
	});

	/** A single-app project: a config, an env file, and an empty construct glob. */
	function singleApp(extra = '') {
		writeFileSync(
			join(dir, 'gkm.config.ts'),
			`import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  name: 'shop',
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './src/constructs/**/*.ts',
  env: ['.env.local', '.env.missing'],
  ${extra}
});
`,
		);
		writeFileSync(join(dir, '.env.local'), 'SHOP_FLAG=on\n');
		mkdirSync(join(dir, 'src', 'constructs'), { recursive: true });
		writeFileSync(join(dir, 'src', 'constructs', 'noop.ts'), 'export {};\n');
	}

	describe('a single app', () => {
		it('builds, starts the server entry, rebuilds on a change, and stops on a signal', async () => {
			singleApp(`telescope: true,
  studio: true,
  hooks: { server: './src/hooks' },`);
			writeFileSync(
				join(dir, 'src', 'hooks.ts'),
				'export function afterSetup() {}\n',
			);

			await devCommand({});

			// Built into the app root, and the entry it starts is written there.
			const [server] = fakes.spawned;
			expect(server!.command).toBe('npx');
			expect(server!.args.slice(0, 2)).toEqual([
				'tsx',
				join(dir, '.gkm', 'server', 'server.ts'),
			]);
			expect(server!.args[2]).toBe('--port');
			expect(existsSync(join(dir, '.gkm', 'server', 'server.ts'))).toBe(true);
			expect(server!.options.env?.NODE_ENV).toBe('development');

			const said = output(log);
			expect(said).toContain('Loaded env: .env.local');
			expect(output(warn)).toContain('Missing env files: .env.missing');
			expect(said).toContain('Telescope enabled at /__telescope');
			expect(said).toContain('Studio enabled at /__studio');
			expect(said).toContain('Server hooks enabled from ./src/hooks');
			expect(said).toContain('✓ Ready');

			// Watches the constructs it loads, and the hooks file.
			const [watcher] = fakes.watchers;
			expect(watcher!.paths).toContain('src/constructs/noop.ts');
			expect(watcher!.paths).toContain('src/constructs');
			watcher!.emit('ready');
			watcher!.emit('error', new Error('EMFILE'));
			expect(output(error)).toContain('Watcher error');

			// A change is debounced into one rebuild and one restart.
			watcher!.emit('change', 'src/constructs/noop.ts');
			watcher!.emit('change', 'src/constructs/noop.ts');
			await until(() => fakes.spawned.length === 2);
			expect(output(log)).toContain('Rebuild complete, restarting server');
			// The old server is killed as a process group before the new one starts.
			expect(kill).toHaveBeenCalledWith(-server!.pid, 'SIGKILL');

			signals.SIGINT!();
			signals.SIGINT!(); // a second signal is ignored
			await until(() => exit.mock.calls.length > 0);
			expect(watcher!.close).toHaveBeenCalledTimes(1);
			expect(exit).toHaveBeenCalledWith(0);
		});

		it('reports a server that exits with an error, and a failed rebuild', async () => {
			singleApp();

			await devCommand({});

			const [server] = fakes.spawned;
			server!.emit('error', new Error('spawn npx ENOENT'));
			server!.emit('exit', 1, null);
			expect(output(error)).toContain('Server error');
			expect(output(error)).toContain('Server exited with code 1');

			// A build that cannot write its output fails the rebuild, not the
			// process: the server keeps running what it last built.
			rmSync(join(dir, '.gkm', 'server'), { recursive: true, force: true });
			writeFileSync(join(dir, '.gkm', 'server'), 'not a directory');
			fakes.watchers[0]!.emit('change', 'src/constructs/noop.ts');
			await until(() => output(error).includes('Rebuild failed'));
			expect(fakes.spawned).toHaveLength(1);
		});

		it('refuses an explicit port that is taken', async () => {
			singleApp();
			const { port, server } = await occupiedPort();

			try {
				await expect(devCommand({ port, portExplicit: true })).rejects.toThrow(
					`Port ${port} is already in use`,
				);
				expect(fakes.spawned).toEqual([]);
			} finally {
				server.close();
			}
		});

		it('moves off a default port that is taken, and says so', async () => {
			singleApp();
			const { port, server } = await occupiedPort();

			try {
				await devCommand({ port });
				const args = fakes.spawned[0]!.args;
				expect(Number(args[args.indexOf('--port') + 1])).not.toBe(port);
				expect(output(log)).toContain(`Port ${port} was in use`);
			} finally {
				server.close();
			}
		});
	});

	describe('an entry file', () => {
		it('runs it with tsx, restarts it on a change, and stops on a signal', async () => {
			writeFileSync(join(dir, 'main.ts'), 'console.log("hi");\n');
			const { port, server } = await occupiedPort();
			server.close();

			// Never resolves: it keeps the process alive, like the real command.
			void devCommand({ entry: 'main.ts', port, portExplicit: true });
			await until(() => fakes.spawned.length === 1);

			const [entry] = fakes.spawned;
			expect(entry!.args).toEqual([
				'tsx',
				join(dir, '.gkm', 'entry-wrapper.ts'),
			]);
			expect(entry!.options.env?.PORT).toBe(String(port));
			expect(
				readFileSync(join(dir, '.gkm', 'entry-wrapper.ts'), 'utf-8'),
			).toContain(join(dir, 'main.ts'));
			await until(() => output(log).includes('✓ Ready'));

			entry!.emit('error', new Error('boom'));
			entry!.emit('exit', 2);
			expect(output(error)).toContain('Process exited with code 2');

			// Exited, so the restart has nothing to stop and starts it again.
			fakes.watchers[0]!.emit('change', 'main.ts');
			await until(() => fakes.spawned.length === 2);

			signals.SIGTERM!();
			expect(fakes.watchers[0]!.close).toHaveBeenCalled();
			expect(kill).toHaveBeenCalledWith(-fakes.spawned[1]!.pid, 'SIGTERM');
			expect(exit).toHaveBeenCalledWith(0);
		});

		it('falls back to the pid when the process group cannot be signalled', async () => {
			writeFileSync(join(dir, 'main.ts'), 'export {};\n');
			kill.mockImplementation((pid: number) => {
				if (pid < 0) throw new Error('ESRCH');
				return true;
			});

			void devCommand({ entry: 'main.ts', watch: false });
			await until(() => fakes.spawned.length === 1);
			await until(() => signals.SIGINT !== undefined);

			signals.SIGINT!();
			expect(kill).toHaveBeenCalledWith(fakes.spawned[0]!.pid, 'SIGTERM');
			expect(fakes.watchers).toEqual([]);
		});

		it('refuses an entry file that does not exist', async () => {
			await expect(devCommand({ entry: 'nope.ts' })).rejects.toThrow(
				'Entry file not found',
			);
		});
	});

	describe('a workspace', () => {
		/** A workspace with a backend, a Next.js site and a mobile app. */
		function workspace(apps: string, extra = '') {
			writeFileSync(
				join(dir, 'gkm.config.ts'),
				`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  stages: { local: 'dev', deployed: ['prod'] },
  secrets: { enabled: true },
  apps: {
${apps}
  },
  ${extra}
});
`,
			);
		}

		const api = `    api: { type: 'backend', path: 'apps/api', port: 3310 },`;
		const web = `    web: { type: 'web', path: 'apps/web', port: 3311, framework: 'nextjs', dependencies: ['api'] },`;
		const mobile = `    app: { type: 'mobile', path: 'apps/app', port: 3312, framework: 'expo' },`;

		function nextApp() {
			mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
			writeFileSync(
				join(dir, 'apps', 'web', 'package.json'),
				JSON.stringify({
					name: 'web',
					dependencies: { next: '16.0.0' },
					scripts: { dev: 'next dev' },
				}),
			);
			writeFileSync(join(dir, 'apps', 'web', 'next.config.ts'), 'export {};\n');
		}

		it('runs every app through turbo with the dependency URLs, and exits with it', async () => {
			workspace([api, web, mobile].join('\n'));
			nextApp();

			const running = devCommand({});
			await until(() => fakes.spawned.length === 1);

			const [turbo] = fakes.spawned;
			expect(turbo!.command).toBe('pnpm');
			expect(turbo!.args).toEqual(['turbo', 'run', 'dev']);
			expect(turbo!.options.cwd).toBe(dir);
			expect(turbo!.options.env?.API_URL).toBe('http://localhost:3310');
			expect(turbo!.options.env?.GKM_CONFIG_PATH).toBe(
				join(dir, 'gkm.config.ts'),
			);
			const said = output(log);
			expect(said).toContain('1 backend, 1 web, 1 mobile app(s)');
			expect(said).toContain('Frontend apps validated');
			expect(said).toContain('web → http://localhost:3311 (depends on: api)');
			expect(output(warn)).toContain('no "dev" secrets found');

			turbo!.emit('exit', 0);
			await expect(running).resolves.toBeUndefined();
		});

		it('filters turbo to one app, and fails when turbo does', async () => {
			workspace(api);

			const running = devCommand({ app: 'api' });
			await until(() => fakes.spawned.length === 1);
			expect(fakes.spawned[0]!.args).toEqual([
				'turbo',
				'run',
				'dev',
				'--filter',
				'api',
			]);

			fakes.spawned[0]!.emit('exit', 1);
			await expect(running).rejects.toThrow('Turbo exited with code 1');
		});

		it('passes a custom filter, and rejects on a spawn error', async () => {
			workspace(api);

			const running = devCommand({ filter: './apps/*' });
			await until(() => fakes.spawned.length === 1);
			expect(fakes.spawned[0]!.args.slice(-2)).toEqual([
				'--filter',
				'./apps/*',
			]);

			fakes.spawned[0]!.emit('error', new Error('pnpm: not found'));
			await expect(running).rejects.toThrow('pnpm: not found');
			expect(output(error)).toContain('Turbo error');
		});

		it('kills turbo on a signal, and forces it after the grace period', async () => {
			workspace(api);
			kill.mockImplementation((pid: number) => {
				if (pid < 0) throw new Error('ESRCH');
				return true;
			});

			void devCommand({});
			await until(() => fakes.spawned.length === 1);
			const pid = fakes.spawned[0]!.pid;

			vi.useFakeTimers();
			try {
				signals.SIGINT!();
				signals.SIGINT!(); // ignored
				expect(kill).toHaveBeenCalledWith(pid, 'SIGTERM');
				vi.advanceTimersByTime(3000);
				expect(kill).toHaveBeenCalledWith(pid, 'SIGKILL');
				expect(exit).toHaveBeenCalledWith(0);
			} finally {
				vi.useRealTimers();
			}
		});

		it('refuses two apps on one port', async () => {
			workspace(
				[
					api,
					`    worker: { type: 'backend', path: 'apps/w', port: 3310 },`,
				].join('\n'),
			);

			await expect(devCommand({})).rejects.toThrow('Port conflicts detected');
			expect(output(error)).toContain(
				'Apps "api" and "worker" both use port 3310',
			);
			expect(fakes.spawned).toEqual([]);
		});

		it('refuses a frontend app that is not set up', async () => {
			workspace([api, web].join('\n'));
			mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
			writeFileSync(
				join(dir, 'apps', 'web', 'package.json'),
				JSON.stringify({ name: 'web' }),
			);

			await expect(devCommand({})).rejects.toThrow(
				'Frontend app validation failed',
			);
			expect(output(error)).toContain('Next.js config file not found');
		});

		it('refuses an app it does not have', async () => {
			workspace(api);

			await expect(devCommand({ app: 'nope' })).rejects.toThrow(
				'App "nope" not found. Available apps: api',
			);
		});
	});

	/** Local secrets for the \`dev\` stage, written the way \`gkm setup\` does. */
	async function secrets(root: string, custom: Record<string, string>) {
		await writeStageSecrets(
			{
				stage: 'dev',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
				services: {},
				urls: {},
				custom,
			},
			root,
		);
	}

	/** A workspace config at the root, and an app directory to run from. */
	function workspaceWithApp(apps: string, app: string) {
		writeFileSync(
			join(dir, 'gkm.config.ts'),
			`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  stages: { local: 'dev', deployed: ['prod'] },
  secrets: { enabled: true },
  constructs: './src/constructs/**/*.ts',
  apps: {
${apps}
  },
});
`,
		);
		mkdirSync(join(dir, 'src', 'constructs'), { recursive: true });
		writeFileSync(join(dir, 'src', 'constructs', 'noop.ts'), 'export {};\n');
		const root = join(dir, 'apps', app);
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, 'package.json'), JSON.stringify({ name: app }));
		return root;
	}

	describe('run from inside a workspace app', () => {
		it('runs an app that names its own entry, with the stage secrets', async () => {
			const auth = workspaceWithApp(
				`    auth: { type: 'backend', path: 'apps/auth', port: 3320, entry: './src/main.ts' },`,
				'auth',
			);
			mkdirSync(join(auth, 'src'), { recursive: true });
			writeFileSync(join(auth, 'src', 'main.ts'), 'export {};\n');
			writeFileSync(join(auth, '.env'), 'AUTH_FLAG=1\n');
			await secrets(dir, { AUTH_SECRET: 'shh' });
			process.chdir(auth);

			void devCommand({});
			await until(() => fakes.watchers.length === 1);

			expect(fakes.spawned[0]!.args).toEqual([
				'tsx',
				join(auth, '.gkm', 'entry-wrapper.ts'),
			]);
			expect(fakes.spawned[0]!.options.env?.PORT).toBe('3320');
			const said = output(log);
			expect(said).toContain('Using entry point: ./src/main.ts');
			expect(said).toContain('App: auth (port 3320)');
			expect(said).toMatch(/Loaded \d+ secret\(s\) \+ PORT/);

			// A clean exit and a SIGTERM are not errors; a restart debounces.
			fakes.spawned[0]!.emit('exit', 143);
			fakes.spawned[0]!.emit('exit', null);
			expect(output(error)).not.toContain('Process exited');
			fakes.watchers[0]!.emit('change', 'src/main.ts');
			fakes.watchers[0]!.emit('change', 'src/main.ts');
			await until(() => fakes.spawned.length === 2);
			signals.SIGINT!();
			signals.SIGINT!();
			expect(exit).toHaveBeenCalledTimes(1);
		});

		it('serves an app on its workspace port, with its secrets written for it', async () => {
			const api = workspaceWithApp(
				[
					`    api: { type: 'backend', path: 'apps/api', port: 3321 },`,
					`    web: { type: 'web', path: 'apps/web', port: 3322, framework: 'nextjs', dependencies: ['api'] },`,
				].join('\n'),
				'api',
			);
			await secrets(dir, { STRIPE_KEY: 'sk_dev' });
			process.chdir(api);

			await devCommand({});

			const args = fakes.spawned[0]!.args;
			expect(args[args.indexOf('--port') + 1]).toBe('3321');
			const written = JSON.parse(
				readFileSync(join(dir, '.gkm', 'dev-secrets-api.json'), 'utf-8'),
			);
			expect(written.STRIPE_KEY).toBe('sk_dev');
			expect(output(log)).toContain('Running app: api on port 3321');
		});

		it('falls back to the whole workspace from a directory that is not an app', async () => {
			const tools = workspaceWithApp(
				`    api: { type: 'backend', path: 'apps/api', port: 3323 },`,
				'tools',
			);
			await secrets(dir, { SHARED: 'yes' });
			process.chdir(tools);

			const running = devCommand({});
			await until(() => fakes.spawned.length === 1);

			expect(fakes.spawned[0]!.command).toBe('pnpm');
			expect(fakes.spawned[0]!.options.env?.SHARED).toBe('yes');
			expect(output(log)).toContain('Loading secrets from stage: dev');
			fakes.spawned[0]!.emit('exit', 0);
			await running;
		});
	});

	it('writes a Bun entry, and advertises only what is enabled', async () => {
		writeFileSync(
			join(dir, 'gkm.config.ts'),
			`import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  name: 'shop',
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: ['./src/constructs/**/*.ts'],
  runtime: 'bun',
  telescope: false,
  studio: false,
  openapi: false,
  hooks: { server: './src/hooks.ts' },
});
`,
		);
		// No surface: one would plan the local edge, which is a container.
		mkdirSync(join(dir, 'src', 'constructs'), { recursive: true });
		writeFileSync(join(dir, 'src', 'constructs', 'noop.ts'), 'export {};\n');
		writeFileSync(join(dir, 'src', 'hooks.ts'), 'export {};\n');

		await devCommand({});

		const entry = readFileSync(
			join(dir, '.gkm', 'server', 'server.ts'),
			'utf-8',
		);
		expect(entry).toContain('Bun.serve');
		const said = output(log);
		expect(said).not.toContain('Telescope');
		expect(said).not.toContain('API Docs');
		expect(fakes.watchers[0]!.paths).toContain('src/hooks.ts');
	});
});
