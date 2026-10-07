/**
 * Where a deploy runs the project's own code.
 *
 * A deploy holds credentials — Dokploy's token, a registry login, an AWS key —
 * and loading `gkm.config.ts`, sniffing an app's environment and building it
 * all execute code from the repository being deployed. On a developer's own
 * laptop that is the developer's code. On a CI job for a fork, or a shared
 * build runner, it is not, and that code should not be able to read the
 * credentials used to deploy it, hang the deploy, or reach outside the
 * checkout.
 *
 * So every step that runs project code goes through a `Sandbox`: one call,
 * with an argument array rather than a shell line, the complete environment
 * the step needs rather than the host's, a timeout it cannot outlive, secrets
 * as files rather than variables, and a working directory inside the project.
 * The steps that need credentials — provisioning, pushing, releasing — are
 * the deploy's own code and never run in one.
 *
 * `LocalSandbox` is the default: a child process on this machine with an
 * allowlisted environment. A host that builds repositories it does not trust
 * passes its own — a container per build, a VM — through `deploy()`'s
 * `sandbox`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Where a command's output goes. */
export type SandboxOutput = 'capture' | 'inherit' | 'stderr' | 'ignore';

export interface SandboxExecOptions {
	/**
	 * Where the command runs: the project root or a directory below it, as an
	 * absolute path or relative to the root. Anywhere else is refused with
	 * {@link SandboxCwdEscape}.
	 */
	cwd: string;
	/**
	 * The command's whole environment. Nothing of the host's is added to it:
	 * start from {@link Sandbox.env} and add what the step needs.
	 */
	env: Readonly<Record<string, string>>;
	/**
	 * How long the command may run before it is killed. Required: a step that
	 * waits forever — a sniffed entry that opens a server, a build stuck on a
	 * prompt — would otherwise hold the deploy, and its lock, forever.
	 */
	timeoutMs: number;
	/**
	 * Files the command can read, by name. Mounted in a directory of their own
	 * — named by `GKM_SECRETS_DIR` in the command's environment — and removed
	 * when it exits. Never set as variables, which every child inherits, a
	 * crash report prints and `/proc/<pid>/environ` shows.
	 */
	secrets?: Readonly<Record<string, string>>;
	/**
	 * `capture` (the default) returns stdout and stderr in the result;
	 * `inherit` gives the command the host's terminal; `stderr` sends both
	 * streams to the host's stderr; `ignore` discards them.
	 */
	output?: SandboxOutput;
	/** Kills the command when aborted; `exec` rejects with the signal's reason. */
	signal?: AbortSignal;
}

/** How a command ended. A non-zero exit is a result, not an error. */
export interface SandboxResult {
	exitCode: number | null;
	signal: string | null;
	/** What it wrote to stdout, when its output was captured. */
	stdout: string;
	/** What it wrote to stderr, when its output was captured. */
	stderr: string;
}

/**
 * Runs a command against the project, and nothing else of the host's.
 *
 * `exec` resolves with the result however the command exited. It rejects
 * with {@link CommandTimedOut} once the timeout passes — after the command is
 * gone — with {@link SandboxCwdEscape} for a directory outside the project,
 * with the signal's reason when aborted, and with the spawn error when the
 * program cannot be started.
 */
export interface Sandbox {
	/** The project: the directory every command runs at or below. */
	readonly root: string;
	/**
	 * Whether the code it runs is kept from the host: its files, its
	 * processes, its memory.
	 *
	 * An isolating sandbox shares nothing but what crosses `exec`, so a config
	 * reaches the deploy as data — a live object in it (a custom state store,
	 * an inline target) cannot cross, and is refused with
	 * `ConfigObjectNotSerializable`. A non-isolating one, like
	 * {@link LocalSandbox}, runs on the host as the host's user; a project
	 * whose config holds live objects is then loaded in-process as before,
	 * because a project trusted to run there is trusted to do that.
	 */
	readonly isolating: boolean;
	/**
	 * The environment a command starts from: what any program needs to run
	 * here — `PATH`, `HOME`, the locale — and no credential.
	 */
	readonly env: Readonly<Record<string, string>>;
	exec(
		command: string,
		args: readonly string[],
		options: SandboxExecOptions,
	): Promise<SandboxResult>;
}

/** The variable naming the directory a command's secrets are mounted in. */
export const SECRETS_DIR_ENV = 'GKM_SECRETS_DIR';

/** A command was asked to run outside the project. */
export class SandboxCwdEscape extends Error {
	constructor(
		readonly cwd: string,
		readonly root: string,
	) {
		super(
			`Refusing to run in '${cwd}': it is outside the project at '${root}'. ` +
				'A sandboxed step only runs inside the project it was given — check ' +
				'the app paths in gkm.config.ts for `..` or an absolute path.',
		);
		this.name = 'SandboxCwdEscape';
	}
}

/** A path with its symlinks resolved where it exists — `/tmp` is `/private/tmp`. */
function real(path: string): string {
	return existsSync(path) ? realpathSync(path) : path;
}

/**
 * `cwd` as an absolute directory inside `root`, or {@link SandboxCwdEscape}.
 *
 * Symlinks are resolved on both sides first, so a link inside the project
 * that points out of it is an escape, and a project reached through a link
 * (`/tmp` on macOS) is still itself. For a sandbox of a host's own to call
 * before it runs anything.
 */
export function confineCwd(root: string, cwd: string): string {
	const absolute = resolve(root, cwd);
	const from = relative(real(resolve(root)), real(absolute));
	if (from === '..' || from.startsWith(`..${sep}`) || isAbsolute(from)) {
		throw new SandboxCwdEscape(cwd, root);
	}
	return absolute;
}

/** A secret's file name: one path segment, so it cannot be written elsewhere. */
export class SecretNameInvalid extends Error {
	constructor(readonly secretName: string) {
		super(
			`'${secretName}' cannot be a secret's name: it becomes a file name in ` +
				'the secrets directory, so it must be one segment of letters, digits, ' +
				"'.', '-' or '_' and not start with '.'.",
		);
		this.name = 'SecretNameInvalid';
	}
}

const SECRET_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** Every secret name, checked before anything is written. */
export function assertSecretNames(
	secrets: Readonly<Record<string, string>> | undefined,
): void {
	for (const name of Object.keys(secrets ?? {})) {
		if (!SECRET_NAME.test(name)) throw new SecretNameInvalid(name);
	}
}

const active = new AsyncLocalStorage<Sandbox>();

/**
 * Run `fn` with `sandbox` as the one its steps use.
 *
 * Per run rather than global, as `withOutput` routes a run's lines: two
 * deploys in one host process each build in their own sandbox. A step deep in
 * the engine — discovering constructs, sniffing an app — asks
 * {@link activeSandbox} rather than every function between `deploy()` and it
 * taking one more parameter.
 */
export function withSandbox<T>(sandbox: Sandbox, fn: () => T): T {
	return active.run(sandbox, fn);
}

/** The sandbox of the run this is part of, if it was started with one. */
export function activeSandbox(): Sandbox | undefined {
	return active.getStore();
}
