/**
 * `LocalSandbox` against real `node` children: what each one can see of the
 * host, where it may run, and that its timeout ends it.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandTimedOut } from '../../run';
import {
	allowlistedEnv,
	LocalSandbox,
	SandboxCwdEscape,
	SECRETS_DIR_ENV,
	SecretNameInvalid,
} from '../index';

/** Runs `source` in a node child of `sandbox`, answering on stdout. */
const node = (
	sandbox: LocalSandbox,
	source: string,
	options: Partial<Parameters<LocalSandbox['exec']>[2]> = {},
) =>
	sandbox.exec(process.execPath, ['--input-type=module', '-e', source], {
		cwd: '.',
		env: { ...sandbox.env },
		timeoutMs: 10_000,
		...options,
	});

const isRunning = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe('LocalSandbox', () => {
	let root: string;
	let outside: string;

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-sandbox-')));
		outside = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-sandbox-out-')));
		mkdirSync(join(root, 'apps', 'api'), { recursive: true });
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});

	describe('environment', () => {
		it('passes what a program needs to run, and no credential', async () => {
			vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'aws-secret');
			vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIA-from-parent');
			vi.stubEnv('DOKPLOY_API_TOKEN', 'dokploy-token');
			vi.stubEnv('DOCKER_REGISTRY_PASSWORD', 'registry-password');
			vi.stubEnv('NODE_AUTH_TOKEN', 'npm-token');
			vi.stubEnv('GITHUB_TOKEN', 'gh-token');
			// CI runs the suite with a loader here; a sandboxed step chooses its own.
			vi.stubEnv('NODE_OPTIONS', '--import tsx');
			vi.stubEnv('LC_ALL', 'en_US.UTF-8');

			const sandbox = new LocalSandbox({ root });
			const result = await node(
				sandbox,
				'process.stdout.write(JSON.stringify(process.env))',
			);
			const seen = JSON.parse(result.stdout) as Record<string, string>;

			expect(result.exitCode).toBe(0);
			for (const key of [
				'AWS_SECRET_ACCESS_KEY',
				'AWS_ACCESS_KEY_ID',
				'DOKPLOY_API_TOKEN',
				'DOCKER_REGISTRY_PASSWORD',
				'NODE_AUTH_TOKEN',
				'GITHUB_TOKEN',
				'NODE_OPTIONS',
			]) {
				expect(seen).not.toHaveProperty(key);
			}
			expect(Object.values(seen).join('\n')).not.toMatch(
				/aws-secret|dokploy-token|registry-password|npm-token|gh-token/,
			);
			expect(seen.PATH).toBe(process.env.PATH);
			expect(seen.LC_ALL).toBe('en_US.UTF-8');
		});

		it('is the env it was given, with nothing of the host added', async () => {
			vi.stubEnv('SOMETHING_OF_THE_HOSTS', 'yes');
			const sandbox = new LocalSandbox({ root });

			const result = await node(
				sandbox,
				'process.stdout.write(JSON.stringify(process.env))',
				{ env: { PATH: process.env.PATH!, ONLY: 'this' } },
			);

			// macOS gives every process its text encoding; nothing else is added.
			const { __CF_USER_TEXT_ENCODING: _os, ...seen } = JSON.parse(
				result.stdout,
			);
			expect(seen).toEqual({
				PATH: process.env.PATH,
				ONLY: 'this',
			});
		});

		it('passes a host variable on only when named', () => {
			const hostEnv = { PATH: '/bin', TURBO_TOKEN: 'cache', OTHER: 'x' };

			expect(new LocalSandbox({ root, hostEnv }).env).toEqual({
				PATH: '/bin',
			});
			expect(
				new LocalSandbox({ root, hostEnv, passEnv: ['TURBO_TOKEN'] }).env,
			).toEqual({ PATH: '/bin', TURBO_TOKEN: 'cache' });
		});

		it('gives commands a scratch home when asked', async () => {
			const home = mkdtempSync(join(outside, 'home-'));
			const sandbox = new LocalSandbox({ root, home });

			const result = await node(
				sandbox,
				"import { homedir } from 'node:os'; process.stdout.write(homedir())",
			);

			expect(result.stdout).toBe(home);
		});

		it('allowlists by name, never by a prefix a credential could share', () => {
			expect(
				allowlistedEnv({
					NODE_ENV: 'production',
					NODE_EXTRA_CA_CERTS: '/ca.pem',
					NODE_AUTH_TOKEN: 'x',
					NODE_OPTIONS: '--require ./steal.js',
					LC_CTYPE: 'UTF-8',
					LC_EVIL_TOKEN: 'x',
				}),
			).toEqual({
				NODE_ENV: 'production',
				NODE_EXTRA_CA_CERTS: '/ca.pem',
				LC_CTYPE: 'UTF-8',
			});
		});
	});

	describe('working directory', () => {
		it('runs at or below the project', async () => {
			const sandbox = new LocalSandbox({ root });

			const result = await node(
				sandbox,
				'process.stdout.write(process.cwd())',
				{ cwd: 'apps/api' },
			);

			expect(result.stdout).toBe(join(root, 'apps', 'api'));
		});

		it.each([
			['a parent', '..'],
			['a relative escape', 'apps/../../elsewhere'],
			['an absolute path elsewhere', '/'],
		])('refuses %s, and starts nothing', async (_, cwd) => {
			const sandbox = new LocalSandbox({ root });
			const marker = join(outside, 'ran');

			await expect(
				node(
					sandbox,
					`import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, '')`,
					{
						cwd,
					},
				),
			).rejects.toBeInstanceOf(SandboxCwdEscape);
			expect(existsSync(marker)).toBe(false);
		});

		it('refuses a link inside the project that leads out of it', async () => {
			symlinkSync(outside, join(root, 'apps', 'escape'));
			const sandbox = new LocalSandbox({ root });

			await expect(
				node(sandbox, '', { cwd: 'apps/escape' }),
			).rejects.toMatchObject({
				name: 'SandboxCwdEscape',
				cwd: 'apps/escape',
				root,
			});
		});
	});

	describe('timeout', () => {
		it('kills a command that outlives it', async () => {
			const sandbox = new LocalSandbox({ root });
			const pidFile = join(root, 'pid');

			const started = Date.now();
			await expect(
				node(
					sandbox,
					`import fs from 'node:fs';
					fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
					setInterval(() => {}, 1000);`,
					{ timeoutMs: 1_000 },
				),
			).rejects.toBeInstanceOf(CommandTimedOut);

			expect(Date.now() - started).toBeLessThan(5_000);
			expect(isRunning(Number(readFileSync(pidFile, 'utf8')))).toBe(false);
		});

		it('stops a command when its signal aborts', async () => {
			const sandbox = new LocalSandbox({ root });
			const controller = new AbortController();
			const reason = new Error('deploy cancelled');
			setTimeout(() => controller.abort(reason), 200);

			await expect(
				node(sandbox, 'setInterval(() => {}, 1000)', {
					signal: controller.signal,
				}),
			).rejects.toBe(reason);
		});

		it('reports a failed command as a result, not an error', async () => {
			const sandbox = new LocalSandbox({ root });

			const result = await node(
				sandbox,
				"process.stderr.write('nope'); process.exit(3)",
			);

			expect(result).toMatchObject({ exitCode: 3, stderr: 'nope' });
		});
	});

	describe('secrets', () => {
		it('arrive as files, and never in the environment', async () => {
			const sandbox = new LocalSandbox({ root });

			const result = await node(
				sandbox,
				`import fs from 'node:fs';
				import path from 'node:path';
				const dir = process.env.${SECRETS_DIR_ENV};
				const file = path.join(dir, 'registry-token');
				process.stdout.write(JSON.stringify({
					dir,
					value: fs.readFileSync(file, 'utf8'),
					mode: (fs.statSync(file).mode & 0o777).toString(8),
					inEnv: Object.values(process.env).some((v) => v.includes('s3cr3t')),
				}));`,
				{ secrets: { 'registry-token': 's3cr3t' } },
			);
			const seen = JSON.parse(result.stdout);

			expect(seen).toMatchObject({
				value: 's3cr3t',
				mode: '600',
				inEnv: false,
			});
			// Outside the project, where nothing the build packs picks it up,
			// and gone once the command is.
			expect(seen.dir.startsWith(root)).toBe(false);
			expect(existsSync(seen.dir)).toBe(false);
		});

		it('refuses a name that would write outside their directory', async () => {
			const sandbox = new LocalSandbox({ root });

			await expect(
				node(sandbox, '', { secrets: { '../escape': 'x' } }),
			).rejects.toBeInstanceOf(SecretNameInvalid);
			expect(existsSync(join(tmpdir(), 'escape'))).toBe(false);
		});
	});

	it('is not isolating: it shares the host’s filesystem', () => {
		expect(new LocalSandbox({ root }).isolating).toBe(false);
	});

	it('writes nothing into the project', async () => {
		const sandbox = new LocalSandbox({ root });
		writeFileSync(join(root, 'keep'), '');

		await node(sandbox, '', { secrets: { token: 'x' } });

		expect((await import('node:fs')).readdirSync(root).sort()).toEqual([
			'apps',
			'keep',
		]);
	});
});
