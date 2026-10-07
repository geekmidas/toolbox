/**
 * Installing a project's dependencies in a sandbox, with or without their
 * lifecycle scripts.
 *
 * `postinstall` is the oldest way into a build machine: any package in the
 * lockfile — a dependency of a dependency — runs whatever it likes the moment
 * it is installed. For a build the host trusts that is how native modules get
 * built. For one it does not, the scripts are skipped, and the few packages
 * that genuinely need theirs (esbuild's binary, a database driver) are named
 * and rebuilt — with nothing but the sandbox's environment either way.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { detectPackageManager, type PackageManager } from '../docker/templates';
import { CommandFailed } from '../run';
import type { Sandbox, SandboxOutput } from './sandbox';

/** Long enough for a cold install of a large monorepo. */
export const INSTALL_TIMEOUT_MS = 15 * 60_000;

export interface InstallOptions {
	/** The directory to install in. Defaults to the sandbox's root. */
	cwd?: string;
	/** Defaults to the one the lockfile above `cwd` names. */
	packageManager?: PackageManager;
	/**
	 * Skip every lifecycle script — dependencies' and the project's own —
	 * except those of {@link allowScripts}. Defaults to false: scripts run, as
	 * a plain install does.
	 */
	ignoreScripts?: boolean;
	/**
	 * With `ignoreScripts`, the packages whose scripts still run: rebuilt by
	 * name once the install is done.
	 */
	allowScripts?: readonly string[];
	/** Variables the install needs beyond the sandbox's own. */
	env?: Readonly<Record<string, string>>;
	/** Defaults to {@link INSTALL_TIMEOUT_MS}, for each command. */
	timeoutMs?: number;
	/** Where the package manager's output goes. Defaults to `inherit`. */
	output?: SandboxOutput;
	signal?: AbortSignal;
}

/** A name in `allowScripts` that is not a package name. */
export class InstallAllowlistNameInvalid extends Error {
	constructor(readonly packageName: string) {
		super(
			`'${packageName}' is not a package name, so its scripts cannot be ` +
				'allowed. Name the package as it appears in package.json — ' +
				"'esbuild', '@prisma/client'.",
		);
		this.name = 'InstallAllowlistNameInvalid';
	}
}

/** The package manager has no way to run only some packages' scripts. */
export class InstallScriptsAllowlistUnsupported extends Error {
	constructor(
		readonly packageManager: string,
		readonly allowScripts: readonly string[],
	) {
		super(
			`${packageManager} cannot rebuild named packages after an install ` +
				`without scripts, so ${allowScripts.join(', ')} cannot be allowed ` +
				'theirs. Use pnpm, npm or Yarn 2+, or install with every script ' +
				'skipped.',
		);
		this.name = 'InstallScriptsAllowlistUnsupported';
	}
}

/**
 * npm's package-name grammar, less a leading `-`: each name is an argument to
 * `rebuild`, and must never be read as a flag.
 */
const PACKAGE_NAME = /^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/;

/**
 * The commands an install runs, in order. Exported for the tests, which
 * check each package manager's flags without installing with all four.
 */
export function installCommands(
	packageManager: PackageManager,
	cwd: string,
	options: Pick<InstallOptions, 'ignoreScripts' | 'allowScripts'> = {},
): [string, string[]][] {
	const ignore = options.ignoreScripts ?? false;
	const allow = ignore ? [...(options.allowScripts ?? [])] : [];
	for (const name of allow) {
		if (!PACKAGE_NAME.test(name)) throw new InstallAllowlistNameInvalid(name);
	}

	switch (packageManager) {
		case 'pnpm':
			return [
				[
					'pnpm',
					[
						'install',
						'--frozen-lockfile',
						...(ignore ? ['--ignore-scripts'] : []),
					],
				],
				// pnpm 10 builds no dependency it was not told to, even by name;
				// this command names exactly the ones allowed, so it may build
				// what it names.
				...(allow.length > 0
					? [
							[
								'pnpm',
								[
									'rebuild',
									'--config.dangerouslyAllowAllBuilds=true',
									...allow,
								],
							] as [string, string[]],
						]
					: []),
			];
		case 'npm': {
			const locked = existsSync(join(cwd, 'package-lock.json'));
			return [
				[
					'npm',
					[locked ? 'ci' : 'install', ...(ignore ? ['--ignore-scripts'] : [])],
				],
				...(allow.length > 0
					? [['npm', ['rebuild', ...allow]] as [string, string[]]]
					: []),
			];
		}
		case 'yarn': {
			// Yarn 2+ keeps a `.yarnrc.yml`; it skips builds by mode and can
			// rebuild by name. Yarn 1 can only skip them all.
			const berry = existsSync(join(cwd, '.yarnrc.yml'));
			if (berry) {
				return [
					[
						'yarn',
						[
							'install',
							'--immutable',
							...(ignore ? ['--mode=skip-build'] : []),
						],
					],
					...(allow.length > 0
						? [['yarn', ['rebuild', ...allow]] as [string, string[]]]
						: []),
				];
			}
			if (allow.length > 0) {
				throw new InstallScriptsAllowlistUnsupported('Yarn 1', allow);
			}
			return [
				[
					'yarn',
					[
						'install',
						'--frozen-lockfile',
						...(ignore ? ['--ignore-scripts'] : []),
					],
				],
			];
		}
		case 'bun':
			if (allow.length > 0) {
				throw new InstallScriptsAllowlistUnsupported('bun', allow);
			}
			return [
				[
					'bun',
					[
						'install',
						'--frozen-lockfile',
						...(ignore ? ['--ignore-scripts'] : []),
					],
				],
			];
	}
}

/**
 * Install the project's dependencies in `sandbox`.
 *
 * ```ts
 * // A checkout nobody has reviewed: no scripts but esbuild's.
 * await installDependencies(sandbox, {
 *   ignoreScripts: true,
 *   allowScripts: ['esbuild'],
 * });
 * ```
 *
 * @throws {CommandFailed} when the package manager exits unsuccessfully.
 * @throws {InstallScriptsAllowlistUnsupported} for an allowlist the package
 *   manager cannot honour, before anything is installed.
 */
export async function installDependencies(
	sandbox: Sandbox,
	options: InstallOptions = {},
): Promise<void> {
	const cwd = options.cwd ?? sandbox.root;
	const packageManager =
		options.packageManager ?? detectPackageManager(resolve(sandbox.root, cwd));

	for (const [command, args] of installCommands(
		packageManager,
		resolve(sandbox.root, cwd),
		options,
	)) {
		const result = await sandbox.exec(command, args, {
			cwd,
			env: { ...sandbox.env, ...options.env },
			timeoutMs: options.timeoutMs ?? INSTALL_TIMEOUT_MS,
			output: options.output ?? 'inherit',
			...(options.signal ? { signal: options.signal } : {}),
		});
		if (result.exitCode !== 0) {
			throw new CommandFailed(
				command,
				args,
				result.exitCode,
				result.signal as NodeJS.Signals | null,
			);
		}
	}
}
