import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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

/**
 * Installing a root certificate is `sudo`, a prompt, and a platform's trust
 * store — none of which a test may touch. Those three are replaced; what is
 * checked is what `gkm trust` decides to run, when it asks, and what it
 * remembers.
 */

const boundary = vi.hoisted(() => ({
	/** Every `execFile` call: [command, args]. */
	calls: [] as [string, string[]][],
	/** Whether the child `fetch` that probes trust succeeds. */
	trusted: false,
	/** The answer the prompt gives. */
	answer: false,
	/** Paths `existsSync` should report as missing, over the real result. */
	missing: new Set<string>(),
	present: new Set<string>(),
}));

vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	return {
		...actual,
		execFile: vi.fn(
			(
				command: string,
				args: string[],
				_options: unknown,
				callback: (error: Error | null, out?: unknown) => void,
			) => {
				boundary.calls.push([command, args]);
				const probe = command === process.execPath;
				if (probe && !boundary.trusted) {
					callback(new Error('self-signed certificate'));
				} else {
					callback(null, { stdout: '', stderr: '' });
				}
			},
		),
	};
});

vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	return {
		...actual,
		existsSync: vi.fn((path: string) => {
			if (boundary.missing.has(path)) return false;
			if (boundary.present.has(path)) return true;
			return actual.existsSync(path);
		}),
	};
});

vi.mock('prompts', () => ({
	default: vi.fn(async () => ({ install: boundary.answer })),
}));

const {
	ensureTrusted,
	exportLocalAuthority,
	isTrusted,
	NoLocalAuthority,
	trustCommand,
	UnsupportedPlatform,
} = await import('../index');

const DEBIAN = '/usr/local/share/ca-certificates';

describe('gkm trust', () => {
	let dir: string;
	let cwd: string;
	let log: MockInstance;
	const platform = process.platform;
	const isTTY = process.stdin.isTTY;

	const on = (value: NodeJS.Platform) =>
		Object.defineProperty(process, 'platform', { value });
	const output = () => log.mock.calls.flat().join('\n');
	const certificate = () => join(dir, '.gkm', 'caddy-root.crt');

	beforeEach(async () => {
		dir = realpathSync(await createTempDir('gkm-trust-'));
		cwd = process.cwd();
		process.chdir(dir);
		writeFileSync(
			join(dir, 'gkm.config.ts'),
			`export default {
  name: 'shop',
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './src/constructs/**/*.ts',
};
`,
		);
		mkdirSync(join(dir, '.gkm'), { recursive: true });
		writeFileSync(certificate(), '-----BEGIN CERTIFICATE-----\n');
		boundary.calls.length = 0;
		boundary.trusted = false;
		boundary.answer = false;
		boundary.missing.clear();
		boundary.present.clear();
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(async () => {
		on(platform);
		Object.defineProperty(process.stdin, 'isTTY', {
			value: isTTY,
			configurable: true,
		});
		process.chdir(cwd);
		vi.restoreAllMocks();
		await cleanupDir(dir);
	});

	describe('trustCommand', () => {
		it('adds the root to the System keychain on macOS', async () => {
			on('darwin');

			await trustCommand();

			expect(boundary.calls).toEqual([
				[
					'sudo',
					[
						'security',
						'add-trusted-cert',
						'-d',
						'-r',
						'trustRoot',
						'-k',
						'/Library/Keychains/System.keychain',
						certificate(),
					],
				],
			]);
			expect(output()).toContain('the System keychain');
			expect(output()).toContain('Restart your browser');
		});

		it('uses the CA bundle on Debian', async () => {
			on('linux');
			boundary.present.add(DEBIAN);

			await trustCommand();

			expect(boundary.calls).toEqual([
				['sudo', ['cp', certificate(), `${DEBIAN}/gkm-local-ca.crt`]],
				['sudo', ['update-ca-certificates']],
			]);
		});

		it('uses the trust anchors on Fedora', async () => {
			on('linux');
			boundary.missing.add(DEBIAN);

			await trustCommand();

			expect(boundary.calls).toEqual([
				[
					'sudo',
					[
						'cp',
						certificate(),
						'/etc/pki/ca-trust/source/anchors/gkm-local-ca.crt',
					],
				],
				['sudo', ['update-ca-trust']],
			]);
			expect(output()).toContain('the system trust anchors');
		});

		it('prints the commands instead of running them on --dry-run', async () => {
			on('darwin');

			await trustCommand({ dryRun: true });

			expect(boundary.calls).toEqual([]);
			expect(output()).toContain(
				'sudo security add-trusted-cert -d -r trustRoot',
			);
		});

		it('refuses a platform it has no trust store for', async () => {
			on('win32');

			await expect(trustCommand()).rejects.toBeInstanceOf(UnsupportedPlatform);
		});

		it('refuses when the edge has not generated an authority yet', async () => {
			boundary.missing.add(certificate());

			await expect(trustCommand()).rejects.toBeInstanceOf(NoLocalAuthority);
		});
	});

	describe('ensureTrusted', () => {
		const tty = (value: boolean) =>
			Object.defineProperty(process.stdin, 'isTTY', {
				value,
				configurable: true,
			});

		it('does nothing on a machine that already trusts it', async () => {
			boundary.trusted = true;

			await ensureTrusted(dir, 'https://shop.localhost');

			expect(boundary.calls.map(([c]) => c)).toEqual([process.execPath]);
		});

		it('says what to run rather than prompting with no terminal', async () => {
			tty(false);

			await ensureTrusted(dir, 'https://shop.localhost');

			expect(output()).toContain('Run "gkm trust"');
			expect(boundary.calls.some(([c]) => c === 'sudo')).toBe(false);
		});

		it('remembers a "no" and does not ask again', async () => {
			tty(true);
			boundary.answer = false;
			const prompts = (await import('prompts'))
				.default as unknown as MockInstance;

			await ensureTrusted(dir, 'https://shop.localhost');
			expect(
				JSON.parse(readFileSync(join(dir, '.gkm', 'trust.json'), 'utf-8')),
			).toEqual({ declined: true });

			prompts.mockClear();
			await ensureTrusted(dir, 'https://shop.localhost');
			expect(prompts).not.toHaveBeenCalled();
		});

		it('installs on a "yes"', async () => {
			tty(true);
			on('darwin');
			boundary.answer = true;

			await ensureTrusted(dir, 'https://shop.localhost');

			expect(boundary.calls.some(([c]) => c === 'sudo')).toBe(true);
		});

		it('installs without asking under --yes', async () => {
			on('darwin');
			const prompts = (await import('prompts'))
				.default as unknown as MockInstance;
			prompts.mockClear();

			await ensureTrusted(dir, 'https://shop.localhost', { assumeYes: true });

			expect(prompts).not.toHaveBeenCalled();
			expect(boundary.calls.some(([c]) => c === 'sudo')).toBe(true);
		});
	});

	describe('isTrusted', () => {
		it('asks a child without NODE_EXTRA_CA_CERTS to fetch the address', async () => {
			boundary.trusted = true;

			await expect(isTrusted('https://shop.localhost')).resolves.toBe(true);
			const [command, args] = boundary.calls[0]!;
			expect(command).toBe(process.execPath);
			// The system store, where `gkm trust` installs the root. Node's own
			// bundle never contains it, so without this an installed root still
			// read as untrusted.
			expect(args[0]).toBe('--use-system-ca');
			expect(args[2]).toContain('"https://shop.localhost"');

			boundary.trusted = false;
			await expect(isTrusted('https://shop.localhost')).resolves.toBe(false);
		});
	});

	describe('exportLocalAuthority', () => {
		it('copies the root where a tool can read it', async () => {
			const to = join(dir, 'ca.pem');

			await exportLocalAuthority(to);

			expect(readFileSync(to, 'utf-8')).toBe('-----BEGIN CERTIFICATE-----\n');
		});

		it('refuses when there is nothing to export', async () => {
			boundary.missing.add(certificate());

			await expect(exportLocalAuthority(join(dir, 'ca.pem'))).rejects.toThrow(
				NoLocalAuthority,
			);
		});
	});
});
