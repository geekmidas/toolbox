/**
 * From a target's name to the target.
 *
 * In this order, the first that has the name wins:
 *
 * 1. the host's own targets — what a program calling `deploy()` passes
 * 2. the built-ins — `dokploy`, `sst`
 * 3. `deploy.targets` in gkm.config.ts — a package, an object, or either
 *    with options
 *
 * Built-ins come before the config so that a dependency cannot take over
 * `dokploy` by being listed under its name. A name nothing has is
 * `UnknownDeployTarget`. There is deliberately no fourth step that guesses a
 * package from the name (`acme` → `@acme/gkm-target`): an npm scope nobody
 * has claimed can be claimed by anyone, and a deploy would then run their
 * code with the stage's credentials. A target is installed and named.
 */

import {
	builtinTarget,
	configurableBuiltins,
	configuredTarget,
	DeployTargetNotYetSupported,
	UnknownDeployTarget,
} from './builtins';
import { isDeployTarget } from './define';
import { importPackage } from './package';
import { declaredRuntime } from './runtime';
import type {
	AnyDeployTarget,
	DeployRuntime,
	DeployTargetEntry,
	TargetOptionsIssue,
} from './types';

/** Where a target came from. */
export type TargetSourceKind = 'host' | 'builtin' | 'config';

export interface ResolvedTarget {
	/** The name it was asked for by. */
	name: string;
	target: AnyDeployTarget;
	source: TargetSourceKind;
	/** Its options as written in the config, before its schema parsed them. */
	options: unknown;
}

export interface ResolveTargetOptions {
	/** The workspace whose `deploy.targets` is consulted. */
	workspace: {
		root: string;
		deploy?: { targets?: Record<string, DeployTargetEntry> } | undefined;
	};
	/** The host's targets, consulted first. */
	host?: Record<string, AnyDeployTarget>;
	/** The stage being deployed, for what to do instead of a refused target. */
	stage: string;
}

/** A target package whose default export is not a target. */
export class TargetPackageInvalid extends Error {
	constructor(
		readonly target: string,
		readonly packageName: string,
	) {
		super(
			`deploy.targets.${target} names "${packageName}", whose default export is not a deploy target. A target package exports one as default: export default defineTarget({ … }) from '@geekmidas/cli/target'.`,
		);
		this.name = 'TargetPackageInvalid';
	}
}

/** A `deploy.targets` entry that is not a target, a package name or a pair. */
export class TargetEntryInvalid extends Error {
	constructor(readonly target: string) {
		super(
			`deploy.targets.${target} must be a package name, a target object (defineTarget), or [package or target, options].`,
		);
		this.name = 'TargetEntryInvalid';
	}
}

/** A target whose `runtime` is not the one its package declares. */
export class TargetRuntimeMismatch extends Error {
	constructor(
		readonly target: string,
		readonly packageName: string,
		readonly declared: DeployRuntime,
		readonly actual: DeployRuntime,
	) {
		super(
			`The deploy target "${target}" runs on "${actual}", but ${packageName}'s package.json declares gkm.runtime "${declared}". gkm dev and gkm build chose backends for "${declared}", so the two must agree — fix the package.`,
		);
		this.name = 'TargetRuntimeMismatch';
	}
}

/** Options a target's schema rejected. */
export class InvalidTargetOptions extends Error {
	constructor(
		readonly target: string,
		readonly issues: readonly TargetOptionsIssue[],
	) {
		const lines = issues.map((issue) => {
			const path = (issue.path ?? [])
				.map((segment) =>
					typeof segment === 'object' ? String(segment.key) : String(segment),
				)
				.join('.');
			return `  - ${path ? `${path}: ` : ''}${issue.message}`;
		});
		super(
			`The options for deploy target "${target}" are invalid — fix them in deploy.targets.${target} in gkm.config.ts:\n${lines.join('\n')}`,
		);
		this.name = 'InvalidTargetOptions';
	}
}

/** The built-ins `gkm deploy` deploys through, loaded only when used. */
const BUILTIN_LOADERS: Record<string, () => Promise<AnyDeployTarget>> = {
	dokploy: async () => (await import('./dokploy')).dokployTarget,
	sst: async () => (await import('./sst/index')).sstTarget,
};

/** The target `name` means, in this workspace, for this host. */
export async function resolveTarget(
	name: string,
	{ workspace, host, stage }: ResolveTargetOptions,
): Promise<ResolvedTarget> {
	if (host && Object.hasOwn(host, name)) {
		return { name, target: host[name]!, source: 'host', options: undefined };
	}

	const builtin = builtinTarget(name);
	if (builtin) {
		const load = BUILTIN_LOADERS[name];
		if (builtin.status !== 'available' || !load) {
			throw new DeployTargetNotYetSupported(name, builtin.instead?.(stage));
		}
		return {
			name,
			target: await load(),
			source: 'builtin',
			options: undefined,
		};
	}

	const entry = configuredTarget(workspace.deploy, name);
	if (entry === undefined) {
		throw new UnknownDeployTarget(name, [
			...configurableBuiltins(),
			...Object.keys(workspace.deploy?.targets ?? {}),
		]);
	}

	const [implementation, options] = Array.isArray(entry)
		? (entry as readonly [unknown, unknown])
		: [entry, undefined];

	if (typeof implementation === 'string') {
		// Before the import: a package that does not say where it runs is
		// refused without running any of its code.
		const declared = declaredRuntime(name, implementation, workspace.root);
		const loaded = await importPackage(name, implementation, workspace.root);
		const target = loaded.default;
		if (!isDeployTarget(target)) {
			throw new TargetPackageInvalid(name, implementation);
		}
		if (target.runtime !== declared) {
			throw new TargetRuntimeMismatch(
				name,
				implementation,
				declared,
				target.runtime,
			);
		}
		return { name, target, source: 'config', options };
	}

	if (!isDeployTarget(implementation)) throw new TargetEntryInvalid(name);
	return { name, target: implementation, source: 'config', options };
}

/** The target's options, parsed by its schema. */
export async function parseTargetOptions(
	resolved: ResolvedTarget,
): Promise<unknown> {
	const { name, target, options } = resolved;
	if (!target.options) {
		if (options !== undefined) {
			throw new InvalidTargetOptions(name, [
				{ message: 'this target takes no options' },
			]);
		}
		return undefined;
	}

	const result = await target.options['~standard'].validate(options);
	if (result.issues) throw new InvalidTargetOptions(name, result.issues);
	return result.value;
}
