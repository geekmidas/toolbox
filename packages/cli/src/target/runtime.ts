/**
 * A target's runtime, without loading the target.
 *
 * `gkm dev` and `gkm build` choose a project's backends by it on every start,
 * synchronously, and must not import a deploy plugin to do so — a plugin may
 * pull in a cloud SDK, and a broken one would stop `gkm dev` for a project
 * that is only being developed. So a built-in's runtime is in the table, an
 * inline target carries its own, and a package declares it in its
 * `package.json`:
 *
 * ```json
 * { "name": "@acme/gkm-target", "gkm": { "runtime": "server" } }
 * ```
 */

import { GkmError } from '../errors';
import {
	builtinTarget,
	configurableBuiltins,
	configuredTarget,
	UnknownDeployTarget,
} from './builtins';
import { locatePackage, TargetPackageNotFound } from './package';
import type { DeployRuntime, DeployTargetEntry } from './types';

const RUNTIMES: readonly DeployRuntime[] = ['server', 'aws'];

/** A target package whose `package.json` does not say where it runs. */
export class TargetRuntimeUndeclared extends GkmError {
	constructor(
		readonly target: string,
		readonly packageName: string,
		/** What `gkm.runtime` held instead, when it held anything. */
		readonly found?: unknown,
	) {
		super(
			`The deploy target "${target}" (${packageName}) does not declare its runtime${found === undefined ? '' : ` (gkm.runtime is ${JSON.stringify(found)})`}. Its package.json needs "gkm": { "runtime": "server" } or "aws", so gkm dev and gkm build can choose backends without loading it.`,
		);
		this.name = 'TargetRuntimeUndeclared';
	}
}

/** What a workspace's deploy config is read for here. */
export interface TargetSource {
	/** Where the target packages are installed from. */
	root?: string;
	deploy?:
		| { default?: string; targets?: Record<string, DeployTargetEntry> }
		| undefined;
}

/** The runtime a target package declares in `package.json#gkm.runtime`. */
export function declaredRuntime(
	target: string,
	packageName: string,
	root: string | undefined,
): DeployRuntime {
	const located = root ? locatePackage(packageName, root) : undefined;
	if (!located) {
		throw new TargetPackageNotFound(
			target,
			packageName,
			root ?? 'the workspace',
		);
	}
	const runtime = located.manifest.gkm?.runtime;
	if (!RUNTIMES.includes(runtime as DeployRuntime)) {
		throw new TargetRuntimeUndeclared(target, packageName, runtime);
	}
	return runtime as DeployRuntime;
}

/** The runtime of the target `name`, as the workspace resolves it. */
export function runtimeOf(
	name: string,
	workspace: TargetSource,
): DeployRuntime {
	const builtin = builtinTarget(name);
	if (builtin) return builtin.runtime;

	const entry = configuredTarget(workspace.deploy, name);
	if (entry === undefined) {
		throw new UnknownDeployTarget(name, [
			...configurableBuiltins(),
			...Object.keys(workspace.deploy?.targets ?? {}),
		]);
	}

	const implementation = Array.isArray(entry) ? entry[0] : entry;
	return typeof implementation === 'string'
		? declaredRuntime(name, implementation, workspace.root)
		: (implementation as { runtime: DeployRuntime }).runtime;
}
