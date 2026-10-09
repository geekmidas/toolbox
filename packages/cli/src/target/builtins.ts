/**
 * The target names the CLI knows without being told, and how a name is
 * looked up.
 *
 * Plain data, so the config schema and `providerOf` — which `gkm dev` and
 * `gkm build` call synchronously on every start — can ask what a name means
 * without importing a deploy engine.
 */

import { GkmError } from '../errors';
import type { DeployRuntime, DeployTargetEntry } from './types';

/**
 * - `available`: `gkm deploy` deploys through it.
 * - `external`: a valid `deploy.default` that builds and runs locally, but is
 *   deployed by its own tool — `gkm deploy` refuses it and says which.
 * - `planned`: reserved, and refused everywhere.
 */
export type BuiltinStatus = 'available' | 'external' | 'planned';

export interface BuiltinTarget {
	readonly runtime: DeployRuntime;
	readonly status: BuiltinStatus;
	/** What to do instead, for a target `gkm deploy` cannot deploy through yet. */
	readonly instead?: (stage: string) => string;
}

export const BUILTIN_TARGETS = {
	dokploy: { runtime: 'server', status: 'available' },
	// One Docker Compose stack behind Caddy, on the machine that runs it.
	compose: { runtime: 'server', status: 'available' },
	sst: { runtime: 'aws', status: 'available' },
	// Neither runs containers the project controls, so both take the managed
	// defaults when they arrive.
	vercel: { runtime: 'aws', status: 'planned' },
	cloudflare: { runtime: 'aws', status: 'planned' },
} as const satisfies Record<string, BuiltinTarget>;

export type BuiltinTargetName = keyof typeof BUILTIN_TARGETS;

/** The built-in target called `name`, if one is. */
export function builtinTarget(name: string): BuiltinTarget | undefined {
	return Object.hasOwn(BUILTIN_TARGETS, name)
		? BUILTIN_TARGETS[name as BuiltinTargetName]
		: undefined;
}

/** Built-in names a config may use. */
export function configurableBuiltins(): string[] {
	return Object.entries(BUILTIN_TARGETS)
		.filter(([, target]) => target.status !== 'planned')
		.map(([name]) => name);
}

/** The `deploy.targets` entry called `name`, if the config has one. */
export function configuredTarget(
	deploy: { targets?: Record<string, DeployTargetEntry> } | undefined,
	name: string,
): DeployTargetEntry | undefined {
	const targets = deploy?.targets;
	return targets && Object.hasOwn(targets, name) ? targets[name] : undefined;
}

/** A target name that is neither built in nor in `deploy.targets`. */
export class UnknownDeployTarget extends GkmError {
	constructor(
		readonly target: string,
		/** The names that would have resolved. */
		readonly known: readonly string[],
	) {
		super(
			`Unknown deploy target "${target}". Use one of ${known.join(', ')}, or name the package that provides it in gkm.config.ts: deploy: { targets: { ${JSON.stringify(target)}: '<package>' } }.`,
		);
		this.name = 'UnknownDeployTarget';
	}
}

/** A built-in target `gkm deploy` cannot deploy through yet. */
export class DeployTargetNotYetSupported extends GkmError {
	constructor(
		readonly target: string,
		/** What to do instead, when there is something. */
		readonly instead?: string,
	) {
		super(
			instead
				? `gkm deploy cannot deploy through "${target}" yet: ${instead}.`
				: `Deploy target "${target}" is not supported yet. Deploy with dokploy, or name a target package in deploy.targets.`,
		);
		this.name = 'DeployTargetNotYetSupported';
	}
}
