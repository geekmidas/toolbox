/**
 * Start a program with an argument array, never a shell string.
 *
 * `gkm build`, `gkm docker` and `gkm deploy` pass values that come from the
 * workspace — image refs, tags, build args, package names — to `docker` and
 * `turbo`. Joined into a string and handed to a shell, a package named
 * `x;curl …|sh` or a tag holding `$(…)` became part of the command line, which
 * matters most where the CLI builds a repository it didn't write: a CI job for a
 * fork, a shared build runner. Here every value reaches the program as one
 * `argv` element, whatever it contains.
 */

import { type SpawnOptions, spawn } from 'node:child_process';

/** Long enough for a cold image build; short enough that a hung one ends. */
export const DEFAULT_TIMEOUT_MS = 30 * 60_000;

/** How long a timed-out child has to exit on SIGTERM before it is killed. */
const KILL_GRACE_MS = 5_000;

export interface RunOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	stdio?: SpawnOptions['stdio'];
	/** Kill the child after this long. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
	timeoutMs?: number;
}

/** The command line as a person would read it — for messages, never to run. */
function display(command: string, args: readonly string[]): string {
	return [command, ...args].join(' ');
}

/** The program ran and exited unsuccessfully; its own output said why. */
export class CommandFailed extends Error {
	constructor(
		readonly command: string,
		readonly args: readonly string[],
		readonly exitCode: number | null,
		readonly signal: NodeJS.Signals | null,
	) {
		super(
			`\`${display(command, args)}\` ${exitCode === null ? `was stopped by ${signal ?? 'a signal'}` : `exited with code ${exitCode}`}. Its output above says why; run it by hand to see it again.`,
		);
		this.name = 'CommandFailed';
	}
}

/** The program ran past its timeout and was killed. */
export class CommandTimedOut extends Error {
	constructor(
		readonly command: string,
		readonly args: readonly string[],
		readonly timeoutMs: number,
	) {
		super(
			`\`${display(command, args)}\` was still running after ${Math.round(timeoutMs / 1000)}s and was stopped. Check what it was waiting on — a registry, the Docker daemon, a prompt — and run it again.`,
		);
		this.name = 'CommandTimedOut';
	}
}

/**
 * Run `command` with `args`, resolving when it exits 0.
 *
 * Rejects with {@link CommandFailed} on any other exit, {@link CommandTimedOut}
 * once `timeoutMs` passes (after the child is gone), and with the spawn error
 * itself when the program cannot be started at all — `ENOENT` already names it.
 */
export async function run(
	command: string,
	args: readonly string[],
	options: RunOptions = {},
): Promise<void> {
	await spawnChild(command, args, options, false);
}

/**
 * {@link run}, resolving with what the program wrote to stdout — for a value
 * the CLI reads back, such as the digest `docker inspect` reports. stderr still
 * reaches the terminal, so a failure explains itself the same way.
 */
export function runOutput(
	command: string,
	args: readonly string[],
	options: Omit<RunOptions, 'stdio'> = {},
): Promise<string> {
	return spawnChild(command, args, options, true);
}

function spawnChild(
	command: string,
	args: readonly string[],
	options: RunOptions,
	capture: boolean,
): Promise<string> {
	const { timeoutMs = DEFAULT_TIMEOUT_MS, ...spawnOptions } = options;

	return new Promise<string>((resolve, reject) => {
		const child = spawn(command, [...args], {
			stdio: 'inherit',
			...spawnOptions,
			...(capture ? { stdio: ['ignore', 'pipe', 'inherit'] } : {}),
			shell: false,
		});

		let stdout = '';
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		let timedOut = false;
		let killer: NodeJS.Timeout | undefined;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGTERM');
			// A child that ignores SIGTERM would hold the deploy open forever.
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
			reject(error);
		});

		child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
			settle();
			if (timedOut) reject(new CommandTimedOut(command, args, timeoutMs));
			else if (code === 0) resolve(stdout);
			else reject(new CommandFailed(command, args, code, signal));
		});
	});
}
