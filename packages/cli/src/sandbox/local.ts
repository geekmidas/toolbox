import { type SpawnOptions, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CommandTimedOut } from '../run';
import { allowlistedEnv } from './env';
import {
	assertSecretNames,
	confineCwd,
	type Sandbox,
	type SandboxExecOptions,
	type SandboxOutput,
	type SandboxResult,
	SECRETS_DIR_ENV,
} from './sandbox';

/** How long a timed-out command has to exit on SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 5_000;

export interface LocalSandboxOptions {
	/** The project. Every command runs at or below it. */
	root: string;
	/**
	 * `HOME` for every command. Defaults to the host's, because a build
	 * reuses the caches kept there — the pnpm store, corepack's package
	 * managers, turbo's cache — and a cold one re-downloads all of them.
	 * Point it at an empty directory to keep `~/.aws`, `~/.npmrc` and
	 * `~/.docker` out of reach of an SDK's default lookup — though, sharing
	 * the host's filesystem, a command that goes looking still finds them.
	 */
	home?: string;
	/**
	 * Host variables to pass on beyond the allowlist, by name — a remote
	 * cache's `TURBO_TOKEN`, for a build the host trusts with it.
	 */
	passEnv?: readonly string[];
	/** Where the allowlisted variables are read from. Defaults to `process.env`. */
	hostEnv?: NodeJS.ProcessEnv;
}

/** Where `output` sends a child's streams. */
const STDIO: Record<SandboxOutput, SpawnOptions['stdio']> = {
	capture: ['ignore', 'pipe', 'pipe'],
	inherit: 'inherit',
	stderr: ['ignore', 2, 2],
	ignore: 'ignore',
};

/**
 * A child process on this machine, as this user, with an allowlisted
 * environment.
 *
 * What it withholds from the command: the host's environment beyond
 * {@link SANDBOX_ENV_ALLOWLIST}, a shell, a working directory outside the
 * project, and any time past the timeout. What it does not: the host's
 * filesystem, which the command can read and write as the user running the
 * deploy. So it is not `isolating`, and it is the default for projects the
 * host already trusts — the developer's own, a team's own CI. Code nobody
 * vetted belongs in a sandbox that is.
 *
 * A timed-out command is sent SIGTERM, then SIGKILL; processes it started
 * itself are its to stop.
 */
export class LocalSandbox implements Sandbox {
	readonly root: string;
	readonly isolating = false;
	readonly env: Readonly<Record<string, string>>;

	constructor(options: LocalSandboxOptions) {
		this.root = resolve(options.root);
		this.env = {
			...allowlistedEnv(options.hostEnv ?? process.env, options.passEnv),
			...(options.home
				? { HOME: options.home, USERPROFILE: options.home }
				: {}),
		};
	}

	async exec(
		command: string,
		args: readonly string[],
		options: SandboxExecOptions,
	): Promise<SandboxResult> {
		const cwd = confineCwd(this.root, options.cwd);
		assertSecretNames(options.secrets);
		options.signal?.throwIfAborted();

		const secretsDir = await mountSecrets(options.secrets);
		try {
			return await spawnConfined(command, args, {
				...options,
				cwd,
				env: secretsDir
					? { ...options.env, [SECRETS_DIR_ENV]: secretsDir }
					: options.env,
			});
		} finally {
			if (secretsDir) await rm(secretsDir, { recursive: true, force: true });
		}
	}
}

/**
 * Each secret as a 0600 file in a fresh 0700 directory outside the project —
 * where nothing the build writes, packs or commits will pick it up.
 */
async function mountSecrets(
	secrets: Readonly<Record<string, string>> | undefined,
): Promise<string | undefined> {
	if (!secrets || Object.keys(secrets).length === 0) return undefined;

	const dir = await mkdtemp(join(tmpdir(), 'gkm-secrets-'));
	for (const [name, value] of Object.entries(secrets)) {
		await writeFile(join(dir, name), value, { mode: 0o600 });
	}
	return dir;
}

function spawnConfined(
	command: string,
	args: readonly string[],
	options: SandboxExecOptions,
): Promise<SandboxResult> {
	const { output = 'capture', signal, timeoutMs } = options;

	return new Promise<SandboxResult>((resolvePromise, reject) => {
		const child = spawn(command, [...args], {
			cwd: options.cwd,
			// The whole environment, as given. `spawn` reads `process.env` only
			// when this is left out.
			env: { ...options.env },
			stdio: STDIO[output],
			shell: false,
			...(signal ? { signal } : {}),
		});

		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		let timedOut = false;
		let killer: NodeJS.Timeout | undefined;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGTERM');
			// A command that ignores SIGTERM would otherwise outlive its timeout.
			killer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
			killer.unref?.();
		}, timeoutMs);
		timer.unref?.();

		const settle = () => {
			clearTimeout(timer);
			if (killer) clearTimeout(killer);
		};

		child.on('error', (error) => {
			settle();
			// Node reports an abort as its own `AbortError`; the caller asked
			// with a reason, and that is what it gets back.
			reject(signal?.aborted ? signal.reason : error);
		});

		child.on('close', (code: number | null, killedBy: string | null) => {
			settle();
			if (signal?.aborted) reject(signal.reason);
			else if (timedOut) reject(new CommandTimedOut(command, args, timeoutMs));
			else
				resolvePromise({
					exitCode: code,
					signal: killedBy ?? null,
					stdout,
					stderr,
				});
		});
	});
}
