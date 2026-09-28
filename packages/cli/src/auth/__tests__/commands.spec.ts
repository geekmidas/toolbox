/**
 * `gkm login | logout | whoami` as a person runs them.
 *
 * Credentials live under the home directory, so `HOME` points at a temp
 * directory for every test. Dokploy's API is MSW; the interactive prompts read
 * `process.stdin`, which a test drives by emitting what a person would type.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
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
import {
	getDokployCredentials,
	getHostingerToken,
	storeDokployCredentials,
} from '../credentials';
import { loginCommand, logoutCommand, whoamiCommand } from '../index';

const ENDPOINT = 'https://dokploy.example.com';

/** `process.exit` would end the run; this lets a test observe it. */
class ExitCalled extends Error {
	constructor(readonly code: number | undefined) {
		super(`process.exit(${code})`);
		this.name = 'ExitCalled';
	}
}

const server = setupServer();

describe('login, logout, whoami', () => {
	const stdin = process.stdin as NodeJS.ReadStream & {
		setRawMode?: (mode: boolean) => NodeJS.ReadStream;
	};
	const tty = stdin.isTTY;
	const rawMode = stdin.setRawMode;
	let home: string;
	let out: string[];
	let err: string[];

	/** Tokens the fake Dokploy accepts. */
	const accept = (token: string) =>
		server.use(
			http.get(`${ENDPOINT}/api/project.all`, ({ request }) =>
				request.headers.get('x-api-key') === token
					? HttpResponse.json([])
					: new HttpResponse(null, { status: 401 }),
			),
		);

	/** Makes stdin a terminal, so the prompts ask rather than refuse. */
	const terminal = () => {
		stdin.isTTY = true;
		stdin.setRawMode = vi.fn(() => stdin);
	};

	/** What a person types, one keystroke per chunk, after the prompt is up. */
	const type = (...keys: string[]) =>
		setTimeout(() => {
			for (const key of keys) stdin.emit('data', Buffer.from(key));
		}, 10);

	beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
	afterAll(() => server.close());

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), 'gkm-login-'));
		// Stubbed rather than assigned: `os.homedir()` reads the real
		// environment, which a replaced `process.env` object no longer reaches.
		vi.stubEnv('HOME', home);
		vi.stubEnv('DOKPLOY_API_TOKEN', undefined);
		vi.stubEnv('DOKPLOY_ENDPOINT', undefined);
		vi.stubEnv('HOSTINGER_API_TOKEN', undefined);
		out = [];
		err = [];
		vi.spyOn(console, 'log').mockImplementation((...a) => {
			out.push(a.join(' '));
		});
		vi.spyOn(console, 'error').mockImplementation((...a) => {
			err.push(a.join(' '));
		});
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitCalled(code as number | undefined);
		});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		stdin.isTTY = tty;
		stdin.setRawMode = rawMode;
		stdin.pause();
		server.resetHandlers();
		vi.restoreAllMocks();
		rmSync(home, { recursive: true, force: true });
	});

	describe('gkm login --provider dokploy', () => {
		it('validates the token and stores it with the endpoint', async () => {
			accept('good-token');

			await loginCommand({
				provider: 'dokploy',
				endpoint: `${ENDPOINT}/`,
				token: 'good-token',
			});

			// The trailing slash is dropped before anything is stored.
			expect(await getDokployCredentials()).toMatchObject({
				token: 'good-token',
				endpoint: ENDPOINT,
			});
			expect(out).toContain('\n✓ Successfully logged in to Dokploy!');
		});

		it('refuses a token Dokploy rejects, and stores nothing', async () => {
			accept('good-token');

			await expect(
				loginCommand({
					provider: 'dokploy',
					endpoint: ENDPOINT,
					token: 'bad-token',
				}),
			).rejects.toThrow(ExitCalled);
			expect(err[0]).toContain('Invalid credentials');
			expect(await getDokployCredentials()).toBeNull();
		});

		it('refuses an endpoint that is not a URL', async () => {
			await expect(
				loginCommand({
					provider: 'dokploy',
					endpoint: 'not a url',
					token: 't',
				}),
			).rejects.toThrow(ExitCalled);
			expect(err).toContain('Invalid URL format');
		});

		it('refuses to prompt when nobody is at a terminal', async () => {
			stdin.isTTY = false;

			await expect(loginCommand({ provider: 'dokploy' })).rejects.toThrow(
				'Interactive input required',
			);
		});

		it('asks for the endpoint and the token when neither was given', async () => {
			terminal();
			accept('typed-token');
			// The endpoint is read by readline, a line at a time; the token in
			// raw mode, a keystroke at a time, with a correction on the way.
			setTimeout(() => stdin.emit('data', Buffer.from(`${ENDPOINT}\n`)), 10);
			setTimeout(() => {
				for (const key of ['t', 'y', 'p', 'x', '\u007F', 'e', 'd']) {
					stdin.emit('data', Buffer.from(key));
				}
				for (const key of ['-', 't', 'o', 'k', 'e', 'n', '\r']) {
					stdin.emit('data', Buffer.from(key));
				}
			}, 60);

			await loginCommand({ provider: 'dokploy' });

			expect(await getDokployCredentials()).toMatchObject({
				token: 'typed-token',
				endpoint: ENDPOINT,
			});
			expect(stdin.setRawMode).toHaveBeenCalledWith(true);
			expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
		});

		it('refuses an empty token', async () => {
			terminal();
			type('\n');

			await expect(
				loginCommand({ provider: 'dokploy', endpoint: ENDPOINT }),
			).rejects.toThrow(ExitCalled);
			expect(err).toContain('Token is required');
		});

		it('exits on Ctrl+C at the token prompt', async () => {
			terminal();
			const exited = new Promise<unknown>((resolve) => {
				vi.mocked(process.exit).mockImplementation((code) => {
					resolve(code);
					return undefined as never;
				});
			});
			type('a', '\u0003');

			void loginCommand({ provider: 'dokploy', endpoint: ENDPOINT });

			expect(await exited).toBe(1);
		});

		it('rejects when the terminal errors mid-prompt', async () => {
			terminal();
			setTimeout(() => stdin.emit('error', new Error('terminal gone')), 10);

			await expect(
				loginCommand({ provider: 'dokploy', endpoint: ENDPOINT }),
			).rejects.toThrow('terminal gone');
		});
	});

	describe('gkm login --provider hostinger', () => {
		it('stores the token without validating it', async () => {
			await loginCommand({ provider: 'hostinger', token: 'h-token' });

			expect(await getHostingerToken()).toBe('h-token');
			expect(out).toContain('\n✓ Hostinger token stored.');
		});

		it('asks for the token when none was given', async () => {
			terminal();
			type('h', '2', '\n');

			await loginCommand({ provider: 'hostinger' });

			expect(await getHostingerToken()).toBe('h2');
		});

		it('refuses an empty token', async () => {
			terminal();
			type('\r');

			await expect(loginCommand({ provider: 'hostinger' })).rejects.toThrow(
				ExitCalled,
			);
			expect(err).toContain('Token is required');
		});
	});

	describe('gkm logout', () => {
		it('removes Dokploy credentials by default', async () => {
			await storeDokployCredentials('t', ENDPOINT);

			await logoutCommand({});

			expect(await getDokployCredentials()).toBeNull();
			expect(out).toContain('\n✓ Logged out from Dokploy');
		});

		it('says so when there was nothing to remove', async () => {
			await logoutCommand({ provider: 'dokploy' });

			expect(out).toContain('\nNo Dokploy credentials found');
		});

		it('removes everything with --provider all', async () => {
			await storeDokployCredentials('t', ENDPOINT);

			await logoutCommand({ provider: 'all' });

			expect(await getDokployCredentials()).toBeNull();
			expect(out).toContain('\n✓ Logged out from all services');
		});

		it('says so when --provider all finds nothing', async () => {
			await logoutCommand({ provider: 'all' });

			expect(out).toContain('\nNo stored credentials found');
		});
	});

	describe('gkm whoami', () => {
		it('shows the endpoint and a masked token', async () => {
			await storeDokployCredentials('abcd-secret-wxyz', ENDPOINT);

			await whoamiCommand();

			expect(out).toContain(`    Endpoint: ${ENDPOINT}`);
			expect(out).toContain('    Token: abcd...wxyz');
		});

		it('says when nobody is logged in', async () => {
			await whoamiCommand();

			expect(out).toContain('  Dokploy: Not logged in');
		});
	});
});
