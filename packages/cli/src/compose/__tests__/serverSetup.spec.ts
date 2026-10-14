import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { ADMIN_SCRIPT, SERVER_SCRIPT } from '../serverScript';
import {
	ComposeServerAdminIsDeployUser,
	ComposeServerAdminIsRoot,
	ComposeServerHostKeyMismatch,
	composeServerCommand,
	type Ran,
	type Runner,
	remoteCommand,
	systemRunner,
} from '../serverSetup';
import {
	SERVER_IPV4,
	serveFrom,
	writeComposeApp,
} from './__helpers__/composeApp';

/**
 * `gkm compose:server` sets a stage's server up over SSH as its admin, pins
 * its host key for CI, and logs in as CI will. The server is played by a
 * runner that answers `ssh` and `ssh-keyscan` the way a real one does; the
 * keys and fingerprints are real, made by this machine's `ssh-keygen`.
 */

interface Call {
	command: string;
	args: readonly string[];
	input?: string;
	interactive?: boolean;
}

const ok = (stdout = ''): Ran => ({ code: 0, stdout, stderr: '' });
const refused: Ran = {
	code: 255,
	stdout: '',
	stderr: 'Permission denied (publickey).',
};

describe('gkm compose:server', () => {
	let dir: string;
	let hostKey: string;
	let hostFingerprint: string;

	beforeEach(async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		dir = realpathSync(await createTempDir('gkm-compose-server-setup-'));
		writeComposeApp(dir);
		await serveFrom(dir);
		// The server's host key: a real one, as ssh-keyscan would show it.
		execFileSync('ssh-keygen', [
			'-q',
			'-t',
			'ed25519',
			'-N',
			'',
			'-f',
			join(dir, 'host'),
		]);
		hostKey = readFileSync(join(dir, 'host.pub'), 'utf-8')
			.split(' ')
			.slice(0, 2)
			.join(' ');
		hostFingerprint = execFileSync('ssh-keygen', ['-lf', join(dir, 'host')], {
			encoding: 'utf-8',
		}).split(' ')[1]!;
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await cleanupDir(dir);
	});

	/**
	 * A server as `ssh` finds it: who logs in with a key, what the setup
	 * script reports, and which host key the network shows.
	 */
	function server(options: { logsIn?: string[]; scanned?: string } = {}) {
		const calls: Call[] = [];
		const logsIn = new Set(options.logsIn ?? ['admin']);
		const run: Runner = async (command, args, extra = {}) => {
			calls.push({ command, args, ...extra });
			if (command === 'ssh-keygen') return systemRunner(command, args, extra);
			if (command === 'ssh-keyscan') {
				return ok(`${SERVER_IPV4} ${options.scanned ?? hostKey}\n`);
			}
			if (command === 'ssh-copy-id') return ok();
			const target = args.find((arg) => arg.includes(`@${SERVER_IPV4}`))!;
			const user = target.split('@')[0]!;
			if (args.includes('true')) return logsIn.has(user) ? ok() : refused;
			if (args.some((arg) => arg.includes(ADMIN_B64))) {
				logsIn.add('admin');
				return ok();
			}
			if (args.includes('-t'))
				return ok(`   …\r\nHOSTKEY=${hostFingerprint}\r\n`);
			if (args.includes('docker')) return ok('28.5.1\n');
			if (args.includes('-W')) return ok('SSH-2.0-OpenSSH_9.6\r\n');
			return refused;
		};
		const gh: { args: string[]; input?: string }[] = [];
		return {
			calls,
			gh,
			deps: {
				run,
				gh: (args: string[], input?: string) => {
					gh.push({ args, ...(input === undefined ? {} : { input }) });
					return args[0] === 'repo' ? 'acme/shop' : '';
				},
			},
		};
	}

	const ADMIN_B64 = Buffer.from(ADMIN_SCRIPT).toString('base64');
	const SERVER_B64 = Buffer.from(SERVER_SCRIPT).toString('base64');

	const said = () =>
		vi
			.mocked(console.log)
			.mock.calls.map((call) => String(call[0]))
			.join('\n');

	it('prints the plan and the script on a dry run, and connects to nothing', async () => {
		const fake = server();
		const keyFile = join(dir, 'deploy_key');

		await composeServerCommand(
			{ cwd: dir, stage: 'production', admin: 'admin', keyFile, dryRun: true },
			{ ...fake.deps, ask: vi.fn() },
		);

		expect(said()).toContain(`Server:      ${SERVER_IPV4} (ssh port 22)`);
		expect(said()).toContain('Deploy user: deploy');
		expect(said()).toContain('PermitRootLogin no');
		expect(said()).toContain('--dry-run: nothing changed.');
		expect(fake.calls).toEqual([]);
		expect(existsSync(keyFile)).toBe(false);
	});

	it('asks for the admin when none is named', async () => {
		const fake = server();
		const ask = vi.fn().mockResolvedValue('admin\n');

		const result = await composeServerCommand(
			{
				cwd: dir,
				stage: 'production',
				keyFile: join(dir, 'deploy_key'),
				dryRun: true,
			},
			{ ...fake.deps, ask },
		);

		expect(ask).toHaveBeenCalledWith(expect.stringContaining('(not root)'));
		expect(result.admin).toBe('admin');
	});

	it('refuses root, and the deploy user, as the admin', async () => {
		const fake = server();
		const setup = (admin: string) =>
			composeServerCommand(
				{ cwd: dir, stage: 'production', admin, dryRun: true },
				{ ...fake.deps, ask: vi.fn() },
			).catch((error: unknown) => error);

		expect(await setup('root')).toBeInstanceOf(ComposeServerAdminIsRoot);
		expect(await setup('deploy')).toBeInstanceOf(
			ComposeServerAdminIsDeployUser,
		);
		expect(fake.calls).toEqual([]);
	});

	it('changes nothing when the plan is declined', async () => {
		const fake = server();
		const keyFile = join(dir, 'deploy_key');

		await composeServerCommand(
			{ cwd: dir, stage: 'production', admin: 'admin', keyFile },
			{ ...fake.deps, ask: vi.fn().mockResolvedValue('') },
		);

		expect(fake.calls).toEqual([]);
		expect(fake.gh.filter((call) => call.args[0] !== 'repo')).toEqual([]);
		expect(existsSync(keyFile)).toBe(false);
	});

	it('sets the server up through sudo, pins its host key for CI, and logs in as CI will', async () => {
		const fake = server();
		const keyFile = join(dir, 'deploy_key');

		const result = await composeServerCommand(
			{ cwd: dir, stage: 'production', admin: 'admin', keyFile },
			{ ...fake.deps, ask: vi.fn().mockResolvedValue('y') },
		);

		// The deploy key, made here.
		const publicKey = readFileSync(`${keyFile}.pub`, 'utf-8').trim();
		expect(publicKey).toMatch(
			/^ssh-ed25519 \S+ gkm-compose-app-production-deploy$/,
		);

		// The script, as the admin, through sudo, with the deploy key.
		const setup = fake.calls.find((call) =>
			call.args.some((arg) => arg.includes(SERVER_B64)),
		)!;
		expect(setup.interactive).toBe(true);
		expect(setup.args).toContain(`admin@${SERVER_IPV4}`);
		const command = setup.args.at(-1)!;
		expect(command).toContain('sudo bash "$f"');
		expect(command).toContain(`'admin' 'deploy' '22' '${publicKey}'`);

		// The host key, given to the stage's environment.
		expect(result.knownHosts).toBe(`${SERVER_IPV4} ${hostKey}`);
		expect(fake.gh).toContainEqual({
			args: [
				'variable',
				'set',
				'DEPLOY_KNOWN_HOSTS',
				'--env',
				'production',
				'--repo',
				'acme/shop',
				'--body',
				`${SERVER_IPV4} ${hostKey}`,
			],
		});
		expect(fake.gh).toContainEqual({
			args: [
				'secret',
				'set',
				'DEPLOY_SSH_KEY',
				'--env',
				'production',
				'--repo',
				'acme/shop',
			],
			input: readFileSync(keyFile, 'utf-8'),
		});

		// Docker and the tunnel, as deploy with only the deploy key and the
		// pinned host key.
		const asCi = fake.calls.filter((call) =>
			call.args.includes(`deploy@${SERVER_IPV4}`),
		);
		expect(asCi.map((call) => call.args.includes('-W'))).toEqual([false, true]);
		for (const call of asCi) {
			expect(call.args).toEqual(
				expect.arrayContaining([
					'-i',
					keyFile,
					'IdentitiesOnly=yes',
					'StrictHostKeyChecking=yes',
				]),
			);
		}
		expect(said()).toContain('is ready for "production"');
	});

	it('gives GitHub nothing when the network shows another host key', async () => {
		const fake = server({
			scanned:
				'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
		});

		const error = await composeServerCommand(
			{
				cwd: dir,
				stage: 'production',
				admin: 'admin',
				keyFile: join(dir, 'deploy_key'),
				yes: true,
			},
			{ ...fake.deps, ask: vi.fn() },
		).catch((error: unknown) => error);

		expect(error).toBeInstanceOf(ComposeServerHostKeyMismatch);
		expect(error).toMatchObject({ server: hostFingerprint });
		expect(fake.gh.filter((call) => call.args[0] !== 'repo')).toEqual([]);
	});

	it("creates the admin with root's key on a server only root can log in to", async () => {
		const fake = server({ logsIn: ['root'] });
		const ask = vi.fn().mockResolvedValue('');

		await composeServerCommand(
			{
				cwd: dir,
				stage: 'production',
				admin: 'admin',
				keyFile: join(dir, 'deploy_key'),
				yes: true,
				github: false,
			},
			{ ...fake.deps, ask },
		);

		expect(ask).toHaveBeenCalledWith(
			expect.stringContaining('Create admin as a sudo user'),
		);
		const bootstrap = fake.calls.find((call) =>
			call.args.some((arg) => arg.includes(ADMIN_B64)),
		)!;
		expect(bootstrap.args).toContain(`root@${SERVER_IPV4}`);
		expect(bootstrap.args.at(-1)).not.toContain('sudo');
		expect(bootstrap.interactive).toBe(true);
		// Then the admin runs the setup, and GitHub is left alone.
		expect(
			fake.calls.some((call) =>
				call.args.some((arg) => arg.includes(SERVER_B64)),
			),
		).toBe(true);
		expect(fake.gh).toEqual([]);
	});
});

describe('the server scripts', () => {
	it('are valid bash', () => {
		for (const script of [SERVER_SCRIPT, ADMIN_SCRIPT]) {
			expect(() =>
				execFileSync('bash', ['-n'], { input: script, stdio: 'pipe' }),
			).not.toThrow();
		}
	});

	it('run remotely with every argument intact, and leave no file behind', () => {
		const script = `printf '<%s>\\n' "$@"; echo "$0" >&2`;
		const command = remoteCommand(
			script,
			["it's", 'ssh-ed25519 AAAA key comment'],
			false,
		);

		const ran = spawnSync('bash', ['-c', command], { encoding: 'utf-8' });

		expect(ran.stdout).toBe("<it's>\n<ssh-ed25519 AAAA key comment>\n");
		expect(existsSync(ran.stderr.trim())).toBe(false);
	});
});
